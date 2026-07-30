/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const DEFAULT_AUDIT_DIR = path.join(
  process.cwd(),
  'reports',
  'auditoria-anuncios-hayamax-2026-07-24',
);

function argValue(name, fallback = null) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const headers = Object.keys(rows[0] || {});
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => csvValue(row[header])).join(','),
    ),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function getSellerSku(item) {
  const attributes = Array.isArray(item?.attributes) ? item.attributes : [];
  const attribute = attributes.find(
    (row) => String(row?.id || '').toUpperCase() === 'SELLER_SKU',
  );
  return String(attribute?.value_name || attribute?.value_id || '').trim();
}

function loadCandidates(auditDir) {
  const files = fs
    .readdirSync(auditDir)
    .filter((file) => /^lote-\d{3}\.json$/.test(file))
    .sort();
  const rows = files.flatMap((file) => {
    const payload = JSON.parse(fs.readFileSync(path.join(auditDir, file), 'utf8'));
    return Array.isArray(payload.items) ? payload.items : [];
  });

  return rows
    .map((row) => {
      const item = row.ml_item || {};
      return {
        sequence: Number(row.sequence),
        batch: Number(row.batch),
        ml_item_id: String(item.id || row.ad?.ml_item_id || '').trim(),
        old_seller_sku: getSellerSku(item),
        old_seller_custom_field: String(item.seller_custom_field || '').trim(),
        target_seller_sku: String(row.product?.sku || '').trim(),
        ad_sku: String(row.ad?.sku || '').trim(),
        product_id: String(row.product?.id || '').trim(),
      };
    })
    .filter((row) => /^HYX/i.test(row.old_seller_sku));
}

async function main() {
  const apply = hasFlag('--apply');
  const auditDir = path.resolve(argValue('--audit-dir', DEFAULT_AUDIT_DIR));
  const inputArg = String(argValue('--input', '') || '').trim();
  const inputPath = inputArg ? path.resolve(inputArg) : null;
  const requestedBatch = Number(argValue('--batch', 0));
  const requestedItem = String(argValue('--item', '') || '').trim();
  const limit = Math.max(0, Number(argValue('--limit', 0)));
  const outputDir = path.join(auditDir, 'sku-hyx');
  fs.mkdirSync(outputDir, { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios',
    );
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function getIntegration() {
    const { data, error } = await supabase
      .from('integracoes')
      .select(
        'access_token,refresh_token,token_expires_at,client_id,client_secret',
      )
      .eq('tipo', 'mercadolivre')
      .maybeSingle();
    if (error || !data) {
      throw new Error(
        `Integração ML indisponível: ${error?.message || 'sem registro'}`,
      );
    }
    return data;
  }

  async function refreshToken(integration) {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: integration.client_id || '',
        client_secret: integration.client_secret || '',
        refresh_token: integration.refresh_token || '',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Falha no refresh ML: HTTP ${response.status} ${
          payload.error || payload.message || ''
        }`,
      );
    }

    await assertAllowedMercadoLivreToken(
      payload.access_token,
      'fix-hayamax-listing-skus:refresh',
    );
    const expiresAt = new Date(
      Date.now() + Number(payload.expires_in || 10800) * 1000,
    ).toISOString();
    const { error } = await supabase
      .from('integracoes')
      .update({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || integration.refresh_token,
        token_expires_at: expiresAt,
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
        last_refresh_error_code: null,
      })
      .eq('tipo', 'mercadolivre');
    if (error) {
      throw new Error(`Falha ao persistir token ML: ${error.message}`);
    }
    return payload.access_token;
  }

  let token = null;
  async function getToken(forceRefresh = false) {
    if (token && !forceRefresh) return token;
    const integration = await getIntegration();
    const expiresAt = new Date(integration.token_expires_at || 0).getTime();
    if (
      !forceRefresh &&
      integration.access_token &&
      expiresAt > Date.now() + 60000
    ) {
      await assertAllowedMercadoLivreToken(
        integration.access_token,
        'fix-hayamax-listing-skus:cached',
      );
      token = integration.access_token;
      return token;
    }
    token = await refreshToken(integration);
    return token;
  }

  async function mlRequest(pathname, options = {}, attempt = 1) {
    const accessToken = await getToken(attempt > 1 && options.refreshToken);
    const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (response.status === 401 && attempt === 1) {
      return mlRequest(
        pathname,
        { ...options, refreshToken: true },
        attempt + 1,
      );
    }
    if (
      [408, 429, 500, 502, 503, 504].includes(response.status) &&
      attempt < 3
    ) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      return mlRequest(pathname, options, attempt + 1);
    }
    return { ok: response.ok, status: response.status, data, text };
  }

  let candidates = inputPath
    ? (JSON.parse(fs.readFileSync(inputPath, 'utf8')).sku_updates || []).map(
        (row) => ({
          sequence: Number(row.sequence || 0),
          batch: Number(row.batch || 0),
          ml_item_id: String(row.ml_item_id || '').trim(),
          old_seller_sku: String(row.old_seller_sku || '').trim(),
          old_seller_custom_field: '',
          target_seller_sku: String(row.sku || '').trim(),
          ad_sku: String(row.sku || '').trim(),
          product_id: String(row.product_id || '').trim(),
        }),
      )
    : loadCandidates(auditDir);
  const invalid = candidates.filter(
    (row) =>
      !row.ml_item_id ||
      !/^VTK\d+$/i.test(row.target_seller_sku) ||
      row.target_seller_sku !== row.ad_sku,
  );
  if (invalid.length) {
    throw new Error(
      `Execução bloqueada: ${invalid.length} vínculo(s) ambíguo(s) ou inválido(s)`,
    );
  }

  const targetCounts = new Map();
  for (const row of candidates) {
    targetCounts.set(
      row.target_seller_sku,
      (targetCounts.get(row.target_seller_sku) || 0) + 1,
    );
  }
  const targetsByItem = new Map();
  for (const row of candidates) {
    const targets = targetsByItem.get(row.ml_item_id) || new Set();
    targets.add(row.target_seller_sku);
    targetsByItem.set(row.ml_item_id, targets);
  }
  const conflictingItems = [...targetsByItem.entries()].filter(
    ([, targets]) => targets.size > 1,
  );
  if (conflictingItems.length) {
    throw new Error(
      `Execução bloqueada: ${conflictingItems.length} anúncio(s) com SKUs destino conflitantes`,
    );
  }

  writeCsv(
    path.join(outputDir, 'mapeamento.csv'),
    candidates.map((row) => ({
      sequence: row.sequence,
      batch: row.batch,
      ml_item_id: row.ml_item_id,
      sku_anterior: row.old_seller_sku,
      sku_novo: row.target_seller_sku,
      seller_custom_field_anterior: row.old_seller_custom_field,
    })),
  );

  if (requestedBatch > 0) {
    candidates = candidates.filter((row) => row.batch === requestedBatch);
  }
  if (requestedItem) {
    candidates = candidates.filter((row) => row.ml_item_id === requestedItem);
  }
  if (limit > 0) candidates = candidates.slice(0, limit);

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'dry-run',
          total_candidates: candidates.length,
          total_hyx_in_manifest: targetCounts.size,
          output: path.join(outputDir, 'mapeamento.csv'),
        },
        null,
        2,
      ),
    );
    return;
  }

  const results = [];
  for (const [index, candidate] of candidates.entries()) {
    const itemPath = `/items/${encodeURIComponent(
      candidate.ml_item_id,
    )}?include_internal_attributes=true`;
    const before = await mlRequest(itemPath);
    if (!before.ok) {
      results.push({
        ...candidate,
        status: 'error_before',
        http_status: before.status,
        error: before.data?.message || before.text || 'Falha ao consultar item',
      });
      continue;
    }

    const liveSku = getSellerSku(before.data);
    const liveCustomField = String(
      before.data?.seller_custom_field || '',
    ).trim();
    if (liveSku === candidate.target_seller_sku) {
      results.push({
        ...candidate,
        live_sku_before: liveSku,
        status: 'already_updated',
        http_status: 200,
        error: '',
      });
      continue;
    }
    const expectedOldSku = String(candidate.old_seller_sku || '').trim();
    if (
      !/^HYX/i.test(liveSku) &&
      (!expectedOldSku || liveSku !== expectedOldSku)
    ) {
      results.push({
        ...candidate,
        live_sku_before: liveSku,
        status: 'blocked_live_conflict',
        http_status: 409,
        error: `SKU ao vivo diverge do valor anterior esperado: ${
          liveSku || '(vazio)'
        }`,
      });
      continue;
    }

    const updateBody = {
      attributes: [
        {
          id: 'SELLER_SKU',
          value_name: candidate.target_seller_sku,
        },
      ],
      ...((/^HYX/i.test(liveCustomField) ||
      (expectedOldSku && liveCustomField === expectedOldSku))
        ? { seller_custom_field: candidate.target_seller_sku }
        : {}),
    };
    const update = await mlRequest(
      `/items/${encodeURIComponent(candidate.ml_item_id)}`,
      { method: 'PUT', body: updateBody },
    );
    if (!update.ok) {
      results.push({
        ...candidate,
        live_sku_before: liveSku,
        status: 'error_update',
        http_status: update.status,
        error: update.data?.message || update.text || 'Falha no PUT',
      });
      continue;
    }

    const verify = await mlRequest(itemPath);
    const verifiedSku = verify.ok ? getSellerSku(verify.data) : '';
    const verifiedCustomField = verify.ok
      ? String(verify.data?.seller_custom_field || '').trim()
      : '';
    const customFieldOk =
      !/^HYX/i.test(liveCustomField) &&
      (!expectedOldSku || liveCustomField !== expectedOldSku) ||
      verifiedCustomField === candidate.target_seller_sku;
    const verified =
      verify.ok &&
      verifiedSku === candidate.target_seller_sku &&
      customFieldOk;
    results.push({
      ...candidate,
      live_sku_before: liveSku,
      live_sku_after: verifiedSku,
      seller_custom_field_after: verifiedCustomField,
      status: verified ? 'success' : 'error_verify',
      http_status: verify.status,
      error: verified
        ? ''
        : verify.data?.message ||
          verify.text ||
          'Mercado Livre não persistiu todos os campos',
    });

    console.log(
      `[${index + 1}/${candidates.length}] ${candidate.ml_item_id} ${
        candidate.old_seller_sku
      } -> ${candidate.target_seller_sku}: ${results.at(-1).status}`,
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultJson = path.join(outputDir, `resultado-${timestamp}.json`);
  const resultCsv = path.join(outputDir, `resultado-${timestamp}.csv`);
  fs.writeFileSync(
    resultJson,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        apply: true,
        total: results.length,
        counts: results.reduce((counts, row) => {
          counts[row.status] = (counts[row.status] || 0) + 1;
          return counts;
        }, {}),
        results,
      },
      null,
      2,
    )}\n`,
  );
  writeCsv(
    resultCsv,
    results.map((row) => ({
      sequence: row.sequence,
      batch: row.batch,
      ml_item_id: row.ml_item_id,
      sku_anterior: row.old_seller_sku,
      sku_novo: row.target_seller_sku,
      sku_verificado: row.live_sku_after || row.live_sku_before || '',
      seller_custom_field_verificado: row.seller_custom_field_after || '',
      status: row.status,
      http_status: row.http_status,
      error: row.error,
    })),
  );

  console.log(
    JSON.stringify(
      {
        ok: results.every((row) =>
          ['success', 'already_updated'].includes(row.status),
        ),
        total: results.length,
        counts: results.reduce((counts, row) => {
          counts[row.status] = (counts[row.status] || 0) + 1;
          return counts;
        }, {}),
        result_json: resultJson,
        result_csv: resultCsv,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
