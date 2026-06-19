/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const PREFIX_RE = /^(FJ|HYX|NMC|VO)/i;

function argHas(flag) {
  return process.argv.includes(flag);
}
function argValue(prefix, fallback = null) {
  const raw = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return raw ? raw.slice(prefix.length + 1) : fallback;
}
function normalize(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function normalizeText(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}
function writeJson(fileName, data) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, fileName), JSON.stringify(data, null, 2));
}
function writeCsv(fileName, rows) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  if (!rows.length) {
    fs.writeFileSync(path.join(REPORTS_DIR, fileName), 'empty\n');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = String(row[h] ?? '');
          return v.includes(',') || v.includes('"') || v.includes('\n')
            ? `"${v.replace(/"/g, '""')}"`
            : v;
        })
        .join(',')
    );
  }
  fs.writeFileSync(path.join(REPORTS_DIR, fileName), lines.join('\n'));
}
function shouldRetry(status) {
  return [408, 409, 424, 429, 500, 502, 503, 504].includes(Number(status || 0));
}
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apply = argHas('--apply');
  const onlyCritical = !argHas('--include-same-domain') || argHas('--only-critical');
  const singleItem = argValue('--item', null);
  const limit = Number(argValue('--limit', '0') || 0);
  const concurrency = Math.max(1, Math.min(2, Number(argValue('--concurrency', '2') || 2)));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');

  const sb = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  async function getMLIntegration() {
    const { data, error } = await sb
      .from('integracoes')
      .select('access_token, refresh_token, token_expires_at, client_id, client_secret')
      .eq('tipo', 'mercadolivre')
      .maybeSingle();
    if (error || !data) throw new Error(`Integração ML indisponível: ${error?.message || 'sem registro'}`);
    return data;
  }

  async function refreshToken(integ) {
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: integ.client_id || '',
        client_secret: integ.client_secret || '',
        refresh_token: integ.refresh_token || '',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload?.access_token) {
      throw new Error(`Falha no refresh ML: HTTP ${res.status} ${payload?.error || payload?.message || ''}`);
    }
    await assertAllowedMercadoLivreToken(payload.access_token, 'fix-ml-categories');
    const expiresAt = new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString();
    await sb
      .from('integracoes')
      .update({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || integ.refresh_token,
        token_expires_at: expiresAt,
        last_refresh_at: new Date().toISOString(),
      })
      .eq('tipo', 'mercadolivre');
    return payload.access_token;
  }

  let cachedToken = null;
  async function getToken(force = false) {
    if (!force && cachedToken) return cachedToken;
    const integ = await getMLIntegration();
    const exp = integ.token_expires_at ? new Date(integ.token_expires_at).getTime() : 0;
    if (!force && integ.access_token && exp > Date.now() + 60_000) {
      await assertAllowedMercadoLivreToken(integ.access_token, 'fix-ml-categories:cached');
      cachedToken = integ.access_token;
      return cachedToken;
    }
    cachedToken = await refreshToken(integ);
    return cachedToken;
  }

  async function mlRequest(pathname, options = {}, attempt = 1) {
    const token = await getToken(options._forceRefresh === true);
    const res = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (res.status === 401 && attempt === 1) {
      await getToken(true);
      return mlRequest(pathname, { ...options, _forceRefresh: true }, 2);
    }
    if (!res.ok && shouldRetry(res.status) && attempt < 3) {
      await sleep(300 * attempt);
      return mlRequest(pathname, options, attempt + 1);
    }
    return { ok: res.ok, status: res.status, data, text };
  }

  const { data: anuncios, error: anunciosError } = await sb
    .from('anuncios_ml')
    .select('id,ml_item_id,sku,titulo,produto_id,status,vendidos')
    .eq('status', 'ativo')
    .not('ml_item_id', 'is', null);
  if (anunciosError) throw new Error(`Erro buscando anuncios_ml: ${anunciosError.message}`);

  const produtos = [];
  for (let from = 0, size = 1000; ; from += size) {
    const { data, error } = await sb
      .from('produtos')
      .select('id,sku,nome,marca,gtin')
      .range(from, from + size - 1);
    if (error) throw new Error(`Erro buscando produtos: ${error.message}`);
    if (!data?.length) break;
    produtos.push(...data);
    if (data.length < size) break;
  }

  const byId = new Map(produtos.map((p) => [String(p.id), p]));
  const bySku = new Map();
  const byBase = new Map();
  for (const p of produtos) {
    const sku = String(p.sku || '');
    bySku.set(sku, (bySku.get(sku) || []).concat([p]));
    const base = sku.replace(PREFIX_RE, '');
    if (base) byBase.set(base, (byBase.get(base) || []).concat([p]));
  }

  const categoryMeta = new Map();
  async function getCategoryMeta(categoryId) {
    if (!categoryId) return null;
    if (categoryMeta.has(categoryId)) return categoryMeta.get(categoryId);
    const res = await mlRequest(`/categories/${categoryId}`);
    const meta = res.ok ? { id: categoryId, domain_id: res.data?.domain_id || null, name: res.data?.name || null } : null;
    categoryMeta.set(categoryId, meta);
    return meta;
  }

  async function predictByTitle(title) {
    const q = encodeURIComponent(title || '');
    if (!q) return null;
    const res = await mlRequest(`/sites/MLB/domain_discovery/search?q=${q}&limit=1`);
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return null;
    const p = res.data[0] || {};
    return {
      category_id: p.category_id || null,
      category_name: p.category_name || null,
      domain_id: p.domain_id || null,
      domain_name: p.domain_name || null,
    };
  }

  const discovered = [];
  for (const a of anuncios) {
    if (singleItem && String(a.ml_item_id) !== String(singleItem)) continue;

    const itemRes = await mlRequest(`/items/${a.ml_item_id}`);
    if (!itemRes.ok) continue;
    const item = itemRes.data || {};

    const sku = String(a.sku || '');
    const base = sku.replace(PREFIX_RE, '');
    const local = (a.produto_id && byId.get(String(a.produto_id)))
      || ((bySku.get(sku) || []).length === 1 ? bySku.get(sku)[0] : null)
      || ((byBase.get(base) || []).length === 1 ? byBase.get(base)[0] : null)
      || null;

    const currentCategory = String(item.category_id || '');
    const currentDomain = String(item.domain_id || '') || (await getCategoryMeta(currentCategory))?.domain_id || '';
    const titleMl = String(item.title || a.titulo || '');
    const titleLocal = String(local?.nome || '').trim();

    const predMl = await predictByTitle(titleMl);
    const predLocal = titleLocal ? await predictByTitle(titleLocal) : null;

    if (!predMl?.category_id) continue;

    const sameCategory = predMl.category_id === currentCategory;
    if (sameCategory) continue;

    const sameDomain = Boolean(predMl.domain_id && currentDomain && predMl.domain_id === currentDomain);

    discovered.push({
      anuncio_id: String(a.id),
      ml_item_id: String(a.ml_item_id),
      sku,
      vendidos: Number(a.vendidos || 0),
      title_ml: titleMl,
      title_local: titleLocal || null,
      current_category: currentCategory || null,
      current_domain: currentDomain || null,
      predicted_ml_category: predMl.category_id,
      predicted_ml_domain: predMl.domain_id || null,
      predicted_local_category: predLocal?.category_id || null,
      predicted_local_domain: predLocal?.domain_id || null,
      same_domain: sameDomain,
      critical: !sameDomain,
      local_produto_id: local ? String(local.id) : null,
      local_marca: local?.marca || null,
      local_gtin: local?.gtin || null,
      permalink: item.permalink || null,
    });
  }

  const critical = discovered.filter((d) => d.critical);
  const sameDomain = discovered.filter((d) => !d.critical);

  writeCsv('ml-category-same-domain-review.csv', sameDomain.map((r) => ({
    ml_item_id: r.ml_item_id,
    sku: r.sku,
    current_category: r.current_category,
    predicted_category: r.predicted_ml_category,
    current_domain: r.current_domain,
    predicted_domain: r.predicted_ml_domain,
    vendidos: r.vendidos,
  })));

  let targets = onlyCritical ? critical : discovered;
  if (limit > 0) targets = targets.slice(0, limit);

  const validations = [];
  const failures = [];

  for (const t of targets) {
    let targetCategory = null;
    let targetDomain = null;
    let targetSource = null;

    if (t.predicted_local_category && t.predicted_ml_category && t.predicted_local_category === t.predicted_ml_category) {
      targetCategory = t.predicted_ml_category;
      targetDomain = t.predicted_ml_domain || t.predicted_local_domain || null;
      targetSource = 'ml_and_local_agree';
    } else if (!t.predicted_local_category) {
      targetCategory = t.predicted_ml_category;
      targetDomain = t.predicted_ml_domain || null;
      targetSource = 'ml_only';
    } else {
      validations.push({ ...t, target_category: null, target_domain: null, target_source: null, viability: 'needs_manual_choice', missing_required: [], patch_attributes: [] });
      failures.push({ phase: 'target_selection', ml_item_id: t.ml_item_id, sku: t.sku, error: 'needs_manual_choice' });
      continue;
    }

    const itemRes = await mlRequest(`/items/${t.ml_item_id}?include_attributes=all`);
    if (!itemRes.ok) {
      validations.push({ ...t, target_category: targetCategory, target_domain: targetDomain, target_source: targetSource, viability: 'blocked', missing_required: [], patch_attributes: [] });
      failures.push({ phase: 'validate', ml_item_id: t.ml_item_id, sku: t.sku, error: `item_http_${itemRes.status}` });
      continue;
    }

    const attrs = Array.isArray(itemRes.data?.attributes) ? itemRes.data.attributes : [];
    const attrMap = new Map(attrs.map((a) => [String(a.id || '').toUpperCase(), a]));

    const catAttrsRes = await mlRequest(`/categories/${targetCategory}/attributes`);
    if (!catAttrsRes.ok || !Array.isArray(catAttrsRes.data)) {
      validations.push({ ...t, target_category: targetCategory, target_domain: targetDomain, target_source: targetSource, viability: 'blocked', missing_required: [], patch_attributes: [] });
      failures.push({ phase: 'validate', ml_item_id: t.ml_item_id, sku: t.sku, error: `cat_attrs_http_${catAttrsRes.status}` });
      continue;
    }

    const required = catAttrsRes.data.filter((a) => (a?.tags?.required || a?.tags?.catalog_required) && !a?.tags?.fixed && !a?.tags?.hidden);
    const missing = [];
    const patch = [];

    for (const req of required) {
      const id = String(req.id || '').toUpperCase();
      const cur = attrMap.get(id);
      const hasCurrent = Boolean(cur && (normalizeText(cur.value_name) || normalizeText(cur.value_id)));
      if (hasCurrent) continue;

      // patchable minimal set
      if (id === 'BRAND' && normalizeText(t.local_marca)) {
        if (Array.isArray(req.values) && req.values.length) {
          const match = req.values.find((v) => normalize(v.name) === normalize(t.local_marca));
          if (match?.id) patch.push({ id: req.id, value_id: match.id, value_name: match.name });
          else missing.push(req.id);
        } else {
          patch.push({ id: req.id, value_name: normalizeText(t.local_marca) });
        }
      } else if (id === 'GTIN' && normalizeText(String(t.local_gtin || '')).replace(/\D+/g, '')) {
        const gtin = String(t.local_gtin).replace(/\D+/g, '');
        if (gtin.length >= 8 && gtin.length <= 14) patch.push({ id: req.id, value_name: gtin });
        else missing.push(req.id);
      } else if (id === 'SELLER_SKU' && normalizeText(t.sku)) {
        patch.push({ id: req.id, value_name: normalizeText(t.sku) });
      } else if (id === 'MODEL' && normalizeText(t.title_local || t.title_ml)) {
        patch.push({ id: req.id, value_name: normalizeText((t.title_local || t.title_ml)).slice(0, 60) });
      } else {
        missing.push(req.id);
      }
    }

    const viability = missing.length === 0 ? (patch.length ? 'can_switch_with_patch' : 'can_switch') : 'blocked';
    validations.push({
      ...t,
      target_category: targetCategory,
      target_domain: targetDomain,
      target_source: targetSource,
      viability,
      missing_required: missing,
      patch_attributes: patch,
    });
  }

  writeJson('ml-category-fix-before.json', {
    generated_at_utc: new Date().toISOString(),
    totals: {
      total_active: anuncios.length,
      divergent_categories: discovered.length,
      critical_domain_diff: critical.length,
      same_domain_diff: sameDomain.length,
      selected_targets: targets.length,
    },
    discovered,
    validations,
  });

  writeCsv('ml-category-fix-targets.csv', validations.map((v) => ({
    ml_item_id: v.ml_item_id,
    sku: v.sku,
    current_category: v.current_category,
    current_domain: v.current_domain,
    target_category: v.target_category || '',
    target_domain: v.target_domain || '',
    target_source: v.target_source || '',
    viability: v.viability,
    missing_required: (v.missing_required || []).join('|'),
    patch_attributes: (v.patch_attributes || []).map((a) => a.id).join('|'),
  })));

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      totals: {
        total_active: anuncios.length,
        divergent_categories: discovered.length,
        critical_domain_diff: critical.length,
        same_domain_diff: sameDomain.length,
        selected_targets: targets.length,
      },
      reports: {
        before: 'reports/ml-category-fix-before.json',
        targets: 'reports/ml-category-fix-targets.csv',
        same_domain_review: 'reports/ml-category-same-domain-review.csv',
      },
    }, null, 2));
    return;
  }

  const queue = validations.filter((v) => v.viability === 'can_switch' || v.viability === 'can_switch_with_patch');
  const applyStats = {
    attempted: queue.length,
    switched: 0,
    switched_with_patch: 0,
    blocked_manual: validations.filter((v) => v.viability === 'blocked' || v.viability === 'needs_manual_choice').length,
    failures: 0,
  };

  async function processOne(v) {
    const body = { category_id: v.target_category };
    if (v.patch_attributes?.length) body.attributes = v.patch_attributes;

    const res = await mlRequest(`/items/${v.ml_item_id}`, { method: 'PUT', body });
    if (!res.ok) {
      applyStats.failures += 1;
      failures.push({ phase: 'apply', ml_item_id: v.ml_item_id, sku: v.sku, status: res.status, error: res.data?.message || res.text || 'ml_error' });
      return;
    }

    const check = await mlRequest(`/items/${v.ml_item_id}`);
    if (!check.ok) {
      applyStats.failures += 1;
      failures.push({ phase: 'post_check', ml_item_id: v.ml_item_id, sku: v.sku, status: check.status, error: check.data?.message || check.text || 'post_check_failed' });
      return;
    }

    const finalCategory = String(check.data?.category_id || '');
    if (finalCategory !== String(v.target_category)) {
      applyStats.failures += 1;
      failures.push({ phase: 'post_check', ml_item_id: v.ml_item_id, sku: v.sku, error: 'category_not_changed', expected: v.target_category, got: finalCategory });
      return;
    }

    applyStats.switched += 1;
    if (v.patch_attributes?.length) applyStats.switched_with_patch += 1;
  }

  const workers = new Array(concurrency).fill(null).map(async () => {
    while (queue.length) {
      const job = queue.shift();
      if (!job) break;
      await processOne(job);
    }
  });
  await Promise.all(workers);

  writeCsv('ml-category-fix-failures.csv', failures.map((f) => ({
    phase: f.phase,
    ml_item_id: f.ml_item_id,
    sku: f.sku || '',
    status: f.status || '',
    error: f.error || '',
    expected: f.expected || '',
    got: f.got || '',
  })));

  const recheck = { critical_domain_diff: 0, same_domain_diff: 0 };
  for (const v of validations) {
    const itemRes = await mlRequest(`/items/${v.ml_item_id}`);
    if (!itemRes.ok) continue;
    const currCat = String(itemRes.data?.category_id || '');
    const currDomain = String(itemRes.data?.domain_id || '');
    const pred = await predictByTitle(String(itemRes.data?.title || v.title_ml || ''));
    if (!pred?.category_id || pred.category_id === currCat) continue;
    if (pred.domain_id && currDomain && pred.domain_id === currDomain) recheck.same_domain_diff += 1;
    else recheck.critical_domain_diff += 1;
  }

  writeJson('ml-category-fix-after.json', {
    generated_at_utc: new Date().toISOString(),
    apply_stats: applyStats,
    failures_count: failures.length,
    recheck,
  });

  console.log(JSON.stringify({
    ok: true,
    mode: 'apply',
    apply_stats: applyStats,
    failures_count: failures.length,
    recheck,
    reports: {
      before: 'reports/ml-category-fix-before.json',
      targets: 'reports/ml-category-fix-targets.csv',
      failures: 'reports/ml-category-fix-failures.csv',
      after: 'reports/ml-category-fix-after.json',
      same_domain_review: 'reports/ml-category-same-domain-review.csv',
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
