/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PREFIX_RE = /^(FJ|HYX|NMC|VO)/i;
const REPORTS_DIR = path.join(process.cwd(), 'reports');

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

function stripHtmlToText(input) {
  return normalizeText(
    String(input ?? '')
      .replace(/<\s*br\s*\/?>/gi, ' ')
      .replace(/<\s*\/p\s*>/gi, ' ')
      .replace(/<\s*\/li\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function toMlPlainText(input) {
  return normalizeText(
    String(input ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u2082/g, '2')
      .replace(/[•·▪●◦]/g, '-')
      .replace(/\s+/g, ' ')
  );
}

function replaceCharAt(str, index, replacement) {
  if (index < 0 || index >= str.length) return str;
  return str.slice(0, index) + replacement + str.slice(index + 1);
}

function parsePlainTextReferences(errorData) {
  const causes = Array.isArray(errorData?.cause) ? errorData.cause : [];
  const refs = [];
  for (const c of causes) {
    const rs = Array.isArray(c?.references) ? c.references : [];
    for (const r of rs) {
      const m = String(r || '').match(/^plain_text\[(\d+)\]$/);
      if (m) refs.push(Number(m[1]));
    }
  }
  return Array.from(new Set(refs)).sort((a, b) => a - b);
}

function safeReplacementForChar(ch) {
  if (!ch) return ' ';
  const cp = ch.codePointAt(0);
  if (cp <= 0x1f || cp === 0x7f) return ' ';
  if (/[\u200B-\u200D\uFEFF]/.test(ch)) return '';
  if (ch === '\u2082') return '2';
  if (/[•·▪●◦]/.test(ch)) return '-';
  return ' ';
}

function tokenize(s) {
  return new Set(normalize(s).split(' ').filter((w) => w.length >= 3));
}

function jaccard(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function escapeCsv(value) {
  const v = String(value ?? '');
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function writeJson(fileName, data) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, fileName), JSON.stringify(data, null, 2));
}

function writeCsv(fileName, rows) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  if (!rows.length) {
    fs.writeFileSync(path.join(REPORTS_DIR, fileName), 'ml_item_id,sku_ml,sku_local,issues\n');
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(','));
  }
  fs.writeFileSync(path.join(REPORTS_DIR, fileName), lines.join('\n'));
}

function readItemFile(filePath) {
  if (!filePath) return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const ids = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',')[0].trim())
    .filter((id) => id && id !== 'ml_item_id');
  return new Set(ids);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return [408, 409, 424, 429, 500, 502, 503, 504].includes(Number(status || 0));
}

async function main() {
  const apply = argHas('--apply');
  const limit = Number(argValue('--limit', '0') || 0);
  const only = (argValue('--only', '') || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const onlySet = new Set(only);
  const singleItem = argValue('--item', null);
  const itemFile = argValue('--item-file', null);
  const concurrency = Math.max(1, Math.min(5, Number(argValue('--concurrency', '3') || 3)));
  const itemFilterSet = readItemFile(itemFile);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }

  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
    const expiresAt = new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString();
    await sb
      .from('integracoes')
      .update({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || integ.refresh_token,
        token_expires_at: expiresAt,
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
        last_refresh_error_code: null,
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
      cachedToken = integ.access_token;
      return cachedToken;
    }
    cachedToken = await refreshToken(integ);
    return cachedToken;
  }

  async function mlRequest(pathname, options = {}, attempt = 1) {
    const token = await getToken(attempt > 1 && options._forceRefresh === true);
    const method = options.method || 'GET';
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (res.status === 401 && attempt === 1) {
      await getToken(true);
      return mlRequest(pathname, { ...options, _forceRefresh: true }, 2);
    }

    if (!res.ok && shouldRetry(res.status) && attempt < 3) {
      await sleep(400 * attempt);
      return mlRequest(pathname, options, attempt + 1);
    }

    return { ok: res.ok, status: res.status, data: json, text, attempts: attempt };
  }

  async function fetchAllProdutos() {
    const out = [];
    const size = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from('produtos')
        .select('id,sku,nome,descricao,gtin,marca,ml_item_id')
        .range(from, from + size - 1);
      if (error) throw new Error(`Erro buscando produtos: ${error.message}`);
      if (!data?.length) break;
      out.push(...data);
      if (data.length < size) break;
      from += size;
    }
    return out;
  }

  const { data: anuncios, error: anunciosError } = await sb
    .from('anuncios_ml')
    .select('id,ml_item_id,sku,titulo,status,produto_id')
    .eq('status', 'ativo')
    .not('ml_item_id', 'is', null);
  if (anunciosError) throw new Error(`Erro buscando anuncios_ml: ${anunciosError.message}`);

  const produtos = await fetchAllProdutos();
  const bySku = new Map();
  const byBase = new Map();
  const byId = new Map();
  for (const p of produtos) {
    const sku = String(p.sku || '');
    bySku.set(sku, (bySku.get(sku) || []).concat([p]));
    const baseSku = sku.replace(PREFIX_RE, '');
    if (baseSku) byBase.set(baseSku, (byBase.get(baseSku) || []).concat([p]));
    byId.set(String(p.id), p);
  }

  const summary = {
    total_ativos: anuncios.length,
    sem_vinculo: 0,
    descricao_vazia: 0,
    descricao_html_literal: 0,
    titulo_divergente: 0,
    marca_divergente: 0,
    gtin_ausente_ml_com_gtin_local: 0,
    gtin_divergente: 0,
  };

  const targets = [];
  const failures = [];

  for (const anuncio of anuncios) {
    if (singleItem && String(anuncio.ml_item_id) !== String(singleItem)) continue;
    if (itemFilterSet && !itemFilterSet.has(String(anuncio.ml_item_id))) continue;

    const skuMl = String(anuncio.sku || '');
    const baseSku = skuMl.replace(PREFIX_RE, '');

    let matched = null;
    let matchStrategy = null;
    let matchCandidates = [];

    if (anuncio.produto_id && byId.has(String(anuncio.produto_id))) {
      matched = byId.get(String(anuncio.produto_id));
      matchStrategy = 'produto_id';
      matchCandidates = [matched];
    }

    if (!matched) {
      const direct = bySku.get(skuMl) || [];
      if (direct.length === 1) {
        matched = direct[0];
        matchStrategy = 'sku';
      }
      matchCandidates = direct;
    }

    if (!matched) {
      const fallback = byBase.get(baseSku) || [];
      if (fallback.length === 1) {
        matched = fallback[0];
        matchStrategy = 'base_sku';
      }
      if (matchCandidates.length === 0) matchCandidates = fallback;
    }

    const itemRes = await mlRequest(`/items/${anuncio.ml_item_id}?include_attributes=all`);
    const descRes = await mlRequest(`/items/${anuncio.ml_item_id}/description`);

    if (!itemRes.ok) {
      failures.push({ phase: 'audit', ml_item_id: anuncio.ml_item_id, error: `item_http_${itemRes.status}` });
      continue;
    }

    const mlTitle = String(itemRes.data?.title || anuncio.titulo || '');
    const mlDescription = String(descRes.data?.plain_text || '').trim();
    const mlDescriptionStatus = !mlDescription
      ? 'empty'
      : /<[^>]+>/.test(mlDescription)
        ? 'html_literal'
        : 'ok';

    const attrs = Array.isArray(itemRes.data?.attributes) ? itemRes.data.attributes : [];
    const findAttr = (id) => attrs.find((a) => String(a.id || '').toUpperCase() === id) || null;
    const brandAttr = findAttr('BRAND');
    const gtinAttr = findAttr('GTIN');

    const brandMl = normalizeText(brandAttr?.value_name || brandAttr?.value_id || '');
    const gtinMl = String(gtinAttr?.value_name || gtinAttr?.value_id || '').replace(/\D+/g, '');

    const localTitle = normalizeText(matched?.nome || '');
    const localBrand = normalizeText(matched?.marca || '');
    const localDescription = stripHtmlToText(matched?.descricao || '');
    const localGtin = String(matched?.gtin || '').replace(/\D+/g, '');

    const titleScore = matched ? jaccard(mlTitle, localTitle) : 0;
    const descScore = matched && mlDescription ? jaccard(mlDescription.slice(0, 600), `${localTitle} ${localDescription}`) : 0;

    const issues = [];

    if (!matched) {
      summary.sem_vinculo += 1;
      issues.push('unlinked');
    }

    if (mlDescriptionStatus === 'empty') {
      summary.descricao_vazia += 1;
      issues.push('description');
    }
    if (mlDescriptionStatus === 'html_literal') {
      summary.descricao_html_literal += 1;
      if (!issues.includes('description')) issues.push('description');
    }

    if (matched && titleScore < 0.45) {
      summary.titulo_divergente += 1;
      issues.push('title');
    }

    if (matched && localBrand && brandMl && normalize(localBrand) !== normalize(brandMl)) {
      summary.marca_divergente += 1;
      issues.push('brand');
    }

    if (matched && localGtin && !gtinMl) {
      summary.gtin_ausente_ml_com_gtin_local += 1;
      issues.push('gtin');
    }
    if (matched && localGtin && gtinMl && localGtin !== gtinMl) {
      summary.gtin_divergente += 1;
      issues.push('gtin');
    }

    if (matched && mlDescriptionStatus === 'ok' && descScore < 0.08) {
      issues.push('description');
    }

    if (!issues.length) continue;

    targets.push({
      ml_item_id: String(anuncio.ml_item_id),
      anuncio_id: String(anuncio.id),
      sku_ml: skuMl,
      produto_id_local: matched ? String(matched.id) : null,
      sku_local: matched?.sku || null,
      nome_local: matched?.nome || null,
      local_description: localDescription,
      local_brand: localBrand,
      local_gtin: localGtin,
      ml_title: mlTitle,
      ml_description_status: mlDescriptionStatus,
      ml_brand: brandMl,
      ml_gtin: gtinMl,
      title_score: Number(titleScore.toFixed(2)),
      desc_score: Number(descScore.toFixed(2)),
      match_strategy: matchStrategy,
      match_candidates_count: matchCandidates.length,
      issues: Array.from(new Set(issues)),
      category_id: itemRes.data?.category_id || null,
      permalink: itemRes.data?.permalink || null,
    });
  }

  const issueOrder = ['unlinked', 'description', 'title', 'brand', 'gtin'];
  targets.sort((a, b) => {
    const pa = Math.min(...a.issues.map((x) => issueOrder.indexOf(x)).filter((n) => n >= 0));
    const pb = Math.min(...b.issues.map((x) => issueOrder.indexOf(x)).filter((n) => n >= 0));
    return pa - pb;
  });

  const frozenTargets = limit > 0 ? targets.slice(0, limit) : targets;

  writeJson('ml-fix-before.json', {
    generated_at_utc: new Date().toISOString(),
    summary,
    total_targets: frozenTargets.length,
    targets: frozenTargets,
  });

  writeJson('ml-fix-targets.json', frozenTargets);
  writeCsv('ml-fix-targets.csv', frozenTargets.map((t) => ({
    ml_item_id: t.ml_item_id,
    sku_ml: t.sku_ml,
    sku_local: t.sku_local || '',
    issues: t.issues.join('|'),
    title_score: t.title_score,
    desc_status: t.ml_description_status,
    match_strategy: t.match_strategy || '',
  })));

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      summary,
      total_targets: frozenTargets.length,
      reports: {
        before: 'reports/ml-fix-before.json',
        targets_json: 'reports/ml-fix-targets.json',
        targets_csv: 'reports/ml-fix-targets.csv',
      },
    }, null, 2));
    return;
  }

  function enabled(kind) {
    return onlySet.size === 0 || onlySet.has(kind);
  }

  const applyStats = {
    linked_updated: 0,
    descriptions_updated: 0,
    titles_updated: 0,
    brands_updated: 0,
    gtins_updated: 0,
    skipped_manual_conflict: 0,
    skipped_no_local_value: 0,
    api_failures: 0,
  };
  const correctionSuccess = [];
  const correctionFailures = [];
  const correctionSkips = [];
  const plainTextDebug = [];

  function classifyFailureCode(status, error) {
    if (status === 401) return 'auth_error';
    if (status === 429) return 'rate_limit';
    if (String(error || '').toLowerCase().includes('blocked')) return 'policy_blocked';
    if (status >= 400 && status < 500) return 'validation_error';
    if (status >= 500) return 'transient_network';
    return 'unknown_error';
  }

  async function processOne(target) {
    const localId = target.produto_id_local;

    if (enabled('unlinked') && target.issues.includes('unlinked')) {
      if (!localId || target.match_candidates_count !== 1) {
        applyStats.skipped_manual_conflict += 1;
        failures.push({ phase: 'link', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: 'ambiguous_or_missing_match' });
      } else {
        const { error: e1 } = await sb
          .from('anuncios_ml')
          .update({ produto_id: localId })
          .eq('id', target.anuncio_id);
        if (e1) {
          applyStats.api_failures += 1;
          failures.push({ phase: 'link', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: e1.message });
        } else {
          const { error: e2 } = await sb
            .from('produtos')
            .update({ ml_item_id: target.ml_item_id })
            .eq('id', localId)
            .or('ml_item_id.is.null,ml_item_id.eq.');
          if (e2) {
            failures.push({ phase: 'link', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: e2.message });
          }
          applyStats.linked_updated += 1;
        }
      }
    }

    if (enabled('description') && target.issues.includes('description')) {
      if (!target.local_description) {
        applyStats.skipped_no_local_value += 1;
        failures.push({ phase: 'description', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: 'local_description_empty' });
        correctionSkips.push({
          ml_item_id: target.ml_item_id,
          sku_ml: target.sku_ml,
          before_status: target.ml_description_status,
          after_status: target.ml_description_status,
          reason: 'local_description_empty',
        });
      } else {
        const originalPlainText = toMlPlainText(target.local_description);
        let plainText = originalPlainText;
        if (!plainText) {
          applyStats.skipped_no_local_value += 1;
          failures.push({ phase: 'description', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: 'local_description_empty_after_sanitize' });
          correctionSkips.push({
            ml_item_id: target.ml_item_id,
            sku_ml: target.sku_ml,
            before_status: target.ml_description_status,
            after_status: target.ml_description_status,
            reason: 'local_description_empty_after_sanitize',
          });
          return;
        }
        let lastRes = null;
        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const body = { plain_text: plainText };
          const res = await mlRequest(`/items/${target.ml_item_id}/description?api_version=2`, { method: 'PUT', body });
          lastRes = res;
          if (res.ok) break;

          const refs = parsePlainTextReferences(res.data);
          const causes = Array.isArray(res.data?.cause) ? res.data.cause : [];
          if (res.status !== 400 || refs.length === 0) {
            plainTextDebug.push({
              ml_item_id: target.ml_item_id,
              attempt,
              error_code: causes.map((c) => c.code).filter(Boolean).join('|') || classifyFailureCode(res.status, res.data?.message || res.text),
              references: refs,
              char_at_index: null,
              replacement_applied: null,
              diff_summary: { changed_chars: originalPlainText !== plainText ? 1 : 0, length_before: originalPlainText.length, length_after: plainText.length },
            });
            break;
          }

          let changed = false;
          for (const idx of refs) {
            const ch = plainText[idx] || '';
            const replacement = safeReplacementForChar(ch);
            const next = replaceCharAt(plainText, idx, replacement);
            changed = changed || next !== plainText;
            plainText = next;
            plainTextDebug.push({
              ml_item_id: target.ml_item_id,
              attempt,
              error_code: causes.map((c) => c.code).filter(Boolean).join('|') || 'validation_error',
              references: refs,
              char_at_index: { index: idx, char: ch, codepoint: ch ? `U+${ch.codePointAt(0).toString(16).toUpperCase()}` : null },
              replacement_applied: replacement,
              diff_summary: { changed_chars: 1, length_before: originalPlainText.length, length_after: plainText.length },
            });
          }
          if (!changed) break;
        }

        if (!lastRes?.ok) {
          applyStats.api_failures += 1;
          failures.push({ phase: 'description', ml_item_id: target.ml_item_id, sku: target.sku_ml, status: lastRes?.status, error: lastRes?.data?.message || lastRes?.text || 'ml_error' });
          correctionFailures.push({
            ml_item_id: target.ml_item_id,
            sku_ml: target.sku_ml,
            before_status: target.ml_description_status,
            after_status: target.ml_description_status,
            attempts: lastRes?.attempts || 1,
            status: lastRes?.status || null,
            error_code: classifyFailureCode(lastRes?.status, lastRes?.data?.message || lastRes?.text),
            error_message: lastRes?.data?.message || lastRes?.text || 'ml_error',
          });
        } else {
          const verifyRes = await mlRequest(`/items/${target.ml_item_id}/description`);
          const desc = String(verifyRes.data?.plain_text || '').trim();
          const afterStatus = !desc ? 'empty' : (/<[^>]+>/.test(desc) ? 'html_literal' : 'ok');
          applyStats.descriptions_updated += 1;
          correctionSuccess.push({
            ml_item_id: target.ml_item_id,
            sku_ml: target.sku_ml,
            before_status: target.ml_description_status,
            after_status: afterStatus,
            attempts: 1,
          });
        }
      }
    }

    if (enabled('title') && target.issues.includes('title')) {
      if (!target.nome_local) {
        applyStats.skipped_no_local_value += 1;
        failures.push({ phase: 'title', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: 'local_title_empty' });
      } else {
        const res = await mlRequest(`/items/${target.ml_item_id}`, { method: 'PUT', body: { title: target.nome_local } });
        if (!res.ok) {
          applyStats.api_failures += 1;
          failures.push({ phase: 'title', ml_item_id: target.ml_item_id, sku: target.sku_ml, status: res.status, error: res.data?.message || res.text || 'ml_error' });
        } else {
          applyStats.titles_updated += 1;
        }
      }
    }

    if (enabled('brand') && target.issues.includes('brand')) {
      if (!target.local_brand) {
        applyStats.skipped_no_local_value += 1;
        failures.push({ phase: 'brand', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: 'local_brand_empty' });
      } else {
        let payloadAttr = { id: 'BRAND', value_name: target.local_brand };

        if (target.category_id) {
          const catAttrs = await mlRequest(`/categories/${target.category_id}/attributes`);
          if (catAttrs.ok && Array.isArray(catAttrs.data)) {
            const brandDef = catAttrs.data.find((a) => String(a.id || '').toUpperCase() === 'BRAND');
            const allowed = Array.isArray(brandDef?.values) ? brandDef.values : [];
            if (allowed.length) {
              const exact = allowed.find((v) => normalize(v.name) === normalize(target.local_brand));
              if (exact?.id) {
                payloadAttr = { id: 'BRAND', value_id: exact.id, value_name: exact.name };
              } else {
                applyStats.skipped_manual_conflict += 1;
                failures.push({
                  phase: 'brand',
                  ml_item_id: target.ml_item_id,
                  sku: target.sku_ml,
                  error: 'brand_not_in_allowed_values',
                  category_id: target.category_id,
                });
                payloadAttr = null;
              }
            }
          }
        }

        if (payloadAttr) {
          const res = await mlRequest(`/items/${target.ml_item_id}`, { method: 'PUT', body: { attributes: [payloadAttr] } });
          if (!res.ok) {
            applyStats.api_failures += 1;
            failures.push({ phase: 'brand', ml_item_id: target.ml_item_id, sku: target.sku_ml, status: res.status, error: res.data?.message || res.text || 'ml_error' });
          } else {
            applyStats.brands_updated += 1;
          }
        }
      }
    }

    if (enabled('gtin') && target.issues.includes('gtin')) {
      const gtin = String(target.local_gtin || '').replace(/\D+/g, '');
      if (!gtin) {
        applyStats.skipped_no_local_value += 1;
        failures.push({ phase: 'gtin', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: 'local_gtin_empty' });
      } else if (gtin.length < 8 || gtin.length > 14) {
        applyStats.skipped_manual_conflict += 1;
        failures.push({ phase: 'gtin', ml_item_id: target.ml_item_id, sku: target.sku_ml, error: 'invalid_gtin_length', gtin });
      } else {
        const res = await mlRequest(`/items/${target.ml_item_id}`, { method: 'PUT', body: { attributes: [{ id: 'GTIN', value_name: gtin }] } });
        if (!res.ok) {
          applyStats.api_failures += 1;
          failures.push({ phase: 'gtin', ml_item_id: target.ml_item_id, sku: target.sku_ml, status: res.status, error: res.data?.message || res.text || 'ml_error' });
        } else {
          applyStats.gtins_updated += 1;
        }
      }
    }
  }

  const queue = [...frozenTargets];
  const workers = new Array(concurrency).fill(null).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      await processOne(item);
    }
  });

  await Promise.all(workers);

  writeJson('ml-fix-failures.json', failures);
  writeCsv('ml-fix-failures.csv', failures.map((f) => ({
    phase: f.phase,
    ml_item_id: f.ml_item_id,
    sku: f.sku || '',
    status: f.status || '',
    error: f.error || '',
  })));
  writeJson('ml-description-correction-success.json', correctionSuccess);
  writeJson('ml-description-correction-failures.json', correctionFailures);
  writeJson('ml-description-plaintext-debug.json', plainTextDebug);
  writeJson('ml-description-correction-summary.json', {
    generated_at_utc: new Date().toISOString(),
    total_target_count: frozenTargets.length,
    item_file: itemFile || null,
    success_count: correctionSuccess.length,
    failure_count: correctionFailures.length,
    skip_count: correctionSkips.length,
    apply_stats: applyStats,
  });
  writeCsv('ml-description-correction-targets.csv', frozenTargets
    .filter((t) => t.issues.includes('description'))
    .map((t) => ({
      ml_item_id: t.ml_item_id,
      sku_ml: t.sku_ml,
      sku_local: t.sku_local || '',
      before_status: t.ml_description_status,
      issues: t.issues.join('|'),
    })));

  // Reaudit compacta
  const { data: anunciosAfter, error: eAfter } = await sb
    .from('anuncios_ml')
    .select('id,ml_item_id,sku,titulo,status,produto_id')
    .eq('status', 'ativo')
    .not('ml_item_id', 'is', null);
  if (eAfter) throw new Error(`Erro na reauditoria: ${eAfter.message}`);

  const afterSummary = {
    total_ativos: anunciosAfter.length,
    sem_vinculo: 0,
    descricao_vazia: 0,
    descricao_html_literal: 0,
    titulo_divergente: 0,
    marca_divergente: 0,
    gtin_ausente_ml_com_gtin_local: 0,
  };

  for (const a of anunciosAfter) {
    const skuMl = String(a.sku || '');
    const baseSku = skuMl.replace(PREFIX_RE, '');
    const p = (a.produto_id && byId.get(String(a.produto_id)))
      || (bySku.get(skuMl)?.length === 1 ? bySku.get(skuMl)[0] : null)
      || (byBase.get(baseSku)?.length === 1 ? byBase.get(baseSku)[0] : null)
      || null;

    if (!p) afterSummary.sem_vinculo += 1;

    const itemRes = await mlRequest(`/items/${a.ml_item_id}?include_attributes=all`);
    const descRes = await mlRequest(`/items/${a.ml_item_id}/description`);
    if (!itemRes.ok) continue;

    const desc = String(descRes.data?.plain_text || '').trim();
    if (!desc) afterSummary.descricao_vazia += 1;
    if (/<[^>]+>/.test(desc)) afterSummary.descricao_html_literal += 1;

    if (p) {
      const titleScore = jaccard(String(itemRes.data?.title || ''), String(p.nome || ''));
      if (titleScore < 0.45) afterSummary.titulo_divergente += 1;

      const attrs = Array.isArray(itemRes.data?.attributes) ? itemRes.data.attributes : [];
      const brand = attrs.find((x) => String(x.id || '').toUpperCase() === 'BRAND');
      const gtin = attrs.find((x) => String(x.id || '').toUpperCase() === 'GTIN');

      const brandMl = normalizeText(brand?.value_name || brand?.value_id || '');
      if (p.marca && brandMl && normalize(p.marca) !== normalize(brandMl)) afterSummary.marca_divergente += 1;

      const gtinLocal = String(p.gtin || '').replace(/\D+/g, '');
      const gtinMl = String(gtin?.value_name || gtin?.value_id || '').replace(/\D+/g, '');
      if (gtinLocal && !gtinMl) afterSummary.gtin_ausente_ml_com_gtin_local += 1;
    }
  }

  writeJson('ml-fix-after.json', {
    generated_at_utc: new Date().toISOString(),
    before_summary: summary,
    after_summary: afterSummary,
    apply_stats: applyStats,
    failures_count: failures.length,
  });

  console.log(JSON.stringify({
    ok: true,
    mode: 'apply',
    target_count: frozenTargets.length,
    before_summary: summary,
    after_summary: afterSummary,
    apply_stats: applyStats,
    failures_count: failures.length,
    reports: {
      before: 'reports/ml-fix-before.json',
      targets_json: 'reports/ml-fix-targets.json',
      targets_csv: 'reports/ml-fix-targets.csv',
      failures_json: 'reports/ml-fix-failures.json',
      failures_csv: 'reports/ml-fix-failures.csv',
      after: 'reports/ml-fix-after.json',
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
