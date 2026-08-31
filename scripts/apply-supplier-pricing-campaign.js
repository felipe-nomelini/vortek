/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { calculateExactMarginPrice } = require('../src/services/pricing.ts');
const { loadPricingTaxRate } = require('./lib/pricing-tax-context');

dotenv.config({ path: '.env.local', quiet: true });

const DEFENSIVE_MARGIN = 0.25;
const OFFENSIVE_MARGIN = 0.08;
const PAGE_SIZE = 1000;
let pricingTaxRate = null;
const BKR1_CRITICAL_SKUS = [
  'VTK000411',
  'VTK012247',
  'VTK003684',
  'VTK003764',
  'VTK012173',
  'VTK003761',
  'VTK012250',
  'VTK012032',
];
const BKR1_MARGIN_OVERRIDES = new Map([
  ['VTK000411', 0.3],
  ['VTK012032', 0.06],
]);
const BKR1_PROVIDED_EXAMPLES = new Map([
  ['VTK000411', { cost: 45.7, mlFee: 0.14, shipping: 7.85, target: 104.9 }],
  ['VTK012247', { cost: 74.4, mlFee: 0.19, shipping: 16.45, target: 178.13 }],
  ['VTK003684', { cost: 37.4, mlFee: 0.14, shipping: 7.75, target: 80.62 }],
  ['VTK003764', { cost: 29.7, mlFee: 0.14, shipping: 7.75, target: 66.87 }],
  ['VTK012173', { cost: 2.97, mlFee: 0.14, shipping: 12.35, target: 20.98 }],
  ['VTK003761', { cost: 19, mlFee: 0.14, shipping: 12.35, target: 42.94 }],
  ['VTK012250', { cost: 19.97, mlFee: 0.14, shipping: 13.85, target: 46.32 }],
  ['VTK012032', { cost: 9.2, mlFee: 0.14, shipping: 12.35, target: 28.73 }],
]);
const VANRAL_CRITICAL_SKUS = [
  'VTK009696',
  'VTK009709',
  'VTK009708',
  'VTK009838',
  'VTK009736',
  'VTK009765',
  'VTK009673',
];
const VANRAL_MARGIN_OVERRIDES = new Map([
  ['VTK009696', 0.3],
  ['VTK009709', 0.3],
  ['VTK009708', 0.3],
  ['VTK009838', 0.1],
  ['VTK009736', 0.1],
  ['VTK009765', 0.1],
  ['VTK009673', 0.1],
]);
const VANRAL_PROVIDED_EXAMPLES = new Map([
  ['VTK009696', { cost: 1064.96, mlFee: 0.165, shipping: 106.95, target: 2416.3 }],
  ['VTK009709', { cost: 1064.96, mlFee: 0.115, shipping: 106.95, target: 2189.55 }],
  ['VTK009708', { cost: 1064.96, mlFee: 0.165, shipping: 107.05, target: 2416.51 }],
  ['VTK009838', { cost: 614.03, mlFee: 0.165, shipping: 106.95, target: 1052.52 }],
  ['VTK009736', { cost: 467.84, mlFee: 0.145, shipping: 23.65, target: 697.14 }],
  ['VTK009765', { cost: 467.84, mlFee: 0.165, shipping: 70.25, target: 785.53 }],
  ['VTK009673', { cost: 111.8, mlFee: 0.145, shipping: 23.65, target: 192.12 }],
]);
const EVOLUSOM_CRITICAL_SKUS = [
  'VTK000192',
  'VTK002333',
  'VTK018925',
  'VTK000678',
  'VTK018988',
  'VTK017609',
  'VTK005420',
  'VTK000616',
  'VTK000456',
  'VTK006351',
];
const EVOLUSOM_OFFENSIVE_CRITICAL_SKUS = new Set([
  'VTK017609',
  'VTK005420',
  'VTK000616',
  'VTK000456',
  'VTK006351',
]);
const EVOLUSOM_MARGIN_OVERRIDES = new Map([
  ['VTK000192', 0.3],
  ['VTK017609', 0.08],
  ['VTK005420', 0.08],
  ['VTK000616', 0.08],
  ['VTK000456', 0.08],
  ['VTK006351', 0.08],
]);
const EVOLUSOM_PROVIDED_EXAMPLES = new Map([
  ['VTK000192', { cost: 179.9, mlFee: 0.11, shipping: 68.65, target: 460.27 }],
  ['VTK002333', { cost: 82.5, mlFee: 0.18, shipping: 19.25, target: 195.67 }],
  ['VTK018925', { cost: 424.9, mlFee: 0.16, shipping: 24.65, target: 832.5 }],
  ['VTK000678', { cost: 209.9, mlFee: 0.16, shipping: 26.25, target: 437.31 }],
  ['VTK018988', { cost: 574.9, mlFee: 0.15, shipping: 68.65, target: 1170.09 }],
  ['VTK017609', { cost: 419.9, mlFee: 0.13, shipping: 24.65, target: 600.74 }],
  ['VTK005420', { cost: 349.9, mlFee: 0.16, shipping: 112.43, target: 651.16 }],
  ['VTK000616', { cost: 69.95, mlFee: 0.18, shipping: 18.45, target: 128.11 }],
  ['VTK000456', { cost: 124.9, mlFee: 0.16, shipping: 68.65, target: 272.6 }],
  ['VTK006351', { cost: 189.9, mlFee: 0.16, shipping: 20.95, target: 296.97 }],
]);

function argValue(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateTarget({ cost, shipping, fixedFee, mlFee, margin }) {
  if (pricingTaxRate === null) throw new Error('Alíquota tributária indisponível');
  return calculateExactMarginPrice({
    cost: Number(cost),
    shipping: Number(shipping),
    fixedFee: Number(fixedFee || 0),
    mlFee: Number(mlFee),
    margin: Number(margin),
    taxRate: pricingTaxRate,
  });
}

function normalizeMlStatus(status) {
  if (status === 'ativo') return 'active';
  if (status === 'pausado') return 'paused';
  return String(status || '').toLowerCase();
}

function standardPrice(payload) {
  const prices = Array.isArray(payload?.prices) ? payload.prices : [];
  const standard =
    prices.find(
      (price) =>
        price?.type === 'standard' &&
        !(price?.conditions?.context_restrictions || []).length,
    ) ||
    prices.find(
      (price) =>
        price?.type === 'standard' &&
        (price?.conditions?.context_restrictions || []).includes(
          'channel_marketplace',
        ) &&
        !(price?.conditions?.context_restrictions || []).includes(
          'user_type_business',
        ),
    ) ||
    prices.find((price) => price?.type === 'standard');
  const amount = Number(standard?.amount);
  return Number.isFinite(amount) ? roundMoney(amount) : null;
}

function sellerSku(item) {
  const attribute = (item?.attributes || []).find(
    (row) => String(row?.id || '').toUpperCase() === 'SELLER_SKU',
  );
  return String(
    item?.seller_sku ||
      attribute?.value_name ||
      attribute?.value_id ||
      item?.seller_custom_field ||
      '',
  ).trim();
}

function jsonError(result) {
  return (
    result?.data?.message ||
    result?.data?.error ||
    result?.text ||
    `HTTP ${result?.status || 0}`
  );
}

function isBkr1BatteryProduct(product) {
  const name = String(product?.nome || '');
  const category = String(product?.categoria || '');
  const explicitName =
    /\b(?:pilhas?|baterias?)\b/i.test(name) ||
    /\b(?:cr|lr|sr)\s*[- ]?\s*\d{2,5}\b/i.test(name) ||
    /\b(?:a23|a27|23a|27a|6f22|mn\d{3,5})\b/i.test(name);
  const batteryCategory =
    /pilhas(?:\s+e\s+carregadores)?\s*>\s*pilhas|pilhas alcalinas|pilhas auditivas|baterias especiais|energia[^>]*>\s*baterias/i.test(
      category,
    );
  const excludedAccessory = /\b(?:carregador|lanterna)\b/i.test(name);
  return explicitName || (batteryCategory && !excludedAccessory);
}

function buildSafeInputRows(results, primaryEventName, linkedEventName) {
  const rowsByProductId = new Map();
  for (const row of results) {
    const productId = String(row.produto_id || '');
    const rows = rowsByProductId.get(productId) || [];
    rows.push(row);
    rowsByProductId.set(productId, rows);
  }
  const safeRows = [];
  for (const [productId, rows] of rowsByProductId.entries()) {
    const primary = rows.find(
      (row) => row.event === primaryEventName && row.front,
    );
    const hasIssue = rows.some(
      (row) =>
        ['failed', 'changed_ml_local_failed'].includes(row.result) ||
        (row.result === 'skipped' &&
          !(
            row.event === linkedEventName &&
            row.reason === 'linked_ml_status_not_editable'
          )),
    );
    if (primary && !hasIssue) {
      safeRows.push({
        result: 'planned',
        produto_id: productId,
        sku: primary.sku,
      });
    }
  }
  return safeRows;
}

async function main() {
  const profile = argValue('--profile', null);
  const isBkr1 = profile === 'bkr1-batteries';
  const isVanral = profile === 'vanral-instruments';
  const isEvolusom = profile === 'evolusom-cash-tourniquet';
  if (
    ![
      'bkr1-batteries',
      'vanral-instruments',
      'evolusom-cash-tourniquet',
    ].includes(profile)
  ) {
    throw new Error(
      '--profile deve ser bkr1-batteries, vanral-instruments ou evolusom-cash-tourniquet',
    );
  }
  const criticalSkus = isEvolusom
    ? EVOLUSOM_CRITICAL_SKUS
    : isVanral
    ? VANRAL_CRITICAL_SKUS
    : BKR1_CRITICAL_SKUS;
  const providedExamples = isEvolusom
    ? EVOLUSOM_PROVIDED_EXAMPLES
    : isVanral
    ? VANRAL_PROVIDED_EXAMPLES
    : BKR1_PROVIDED_EXAMPLES;
  const primaryEventName = isEvolusom
    ? 'evolusom_cash_tourniquet_price'
    : isVanral
    ? 'vanral_instrument_dynamic_price'
    : 'bkr1_battery_dynamic_price';
  const linkedEventName = isEvolusom
    ? 'evolusom_cash_tourniquet_linked_listing_price'
    : isVanral
    ? 'vanral_instrument_linked_listing_price'
    : 'bkr1_battery_linked_listing_price';
  const scope = argValue('--scope', 'critical');
  const apply = process.argv.includes('--apply');
  const syncMlFee = process.argv.includes('--sync-ml-fee');
  const inputEvents = argValue('--input-events', null);
  const inputReason = argValue('--input-reason', null);
  const outputDir = path.resolve(
    argValue(
      '--output-dir',
      path.join(
        'reports',
        isEvolusom
          ? 'evolusom-cash-tourniquet'
          : isVanral
          ? 'vanral-instrument-pricing'
          : 'bkr1-battery-pricing',
        new Date().toISOString().replace(/[:.]/g, '-'),
      ),
    ),
  );
  if (!['critical', 'all'].includes(scope)) {
    throw new Error('--scope deve ser critical ou all');
  }
  const rebuildSafeInputFrom = argValue('--rebuild-safe-input-from', null);
  if (rebuildSafeInputFrom) {
    const rebuiltResults = fs
      .readFileSync(path.resolve(rebuildSafeInputFrom), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    let safeRows = buildSafeInputRows(
      rebuiltResults,
      primaryEventName,
      linkedEventName,
    );
    const excludeProductsFrom = argValue('--exclude-products-from', null);
    if (excludeProductsFrom) {
      const excludedProductIds = new Set(
        fs
          .readFileSync(path.resolve(excludeProductsFrom), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((row) => row.event === primaryEventName)
          .map((row) => String(row.produto_id || '')),
      );
      safeRows = safeRows.filter(
        (row) => !excludedProductIds.has(String(row.produto_id || '')),
      );
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const safeInputPath = path.join(outputDir, 'safe-input.ndjson');
    fs.writeFileSync(
      safeInputPath,
      safeRows.map((row) => JSON.stringify(row)).join('\n') +
        (safeRows.length ? '\n' : ''),
    );
    console.log(
      JSON.stringify({ safe_products: safeRows.length, safe_input: safeInputPath }),
    );
    return;
  }

  const supabaseUrl =
    process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error('URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ({ taxRate: pricingTaxRate } = await loadPricingTaxRate(supabase));

  fs.mkdirSync(outputDir, { recursive: true });
  const eventsPath = path.join(outputDir, 'events.ndjson');
  const appendEvent = (event) => {
    const priceLogFields =
      event.sku &&
      event.front &&
      Number.isFinite(Number(event.old_price)) &&
      Number.isFinite(Number(event.new_price))
        ? {
            SKU: event.sku,
            Preco_Antigo: Number(event.old_price),
            Novo_Preco: Number(event.new_price),
            Tipo_de_Frente: event.front,
          }
        : {};
    const row = {
      timestamp_utc: new Date().toISOString(),
      ...event,
      ...priceLogFields,
    };
    fs.appendFileSync(eventsPath, `${JSON.stringify(row)}\n`);
    console.log(JSON.stringify(row));
    return row;
  };

  async function fetchAll(queryFactory) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await queryFactory().range(
        from,
        from + PAGE_SIZE - 1,
      );
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async function getIntegration() {
    const { data, error } = await supabase
      .from('integracoes')
      .select(
        'access_token,refresh_token,token_expires_at,client_id,client_secret',
      )
      .eq('tipo', 'mercadolivre')
      .order('updated_at', { ascending: false })
      .limit(1)
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
      'apply-supplier-pricing-campaign:refresh',
    );
    const { error } = await supabase
      .from('integracoes')
      .update({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || integration.refresh_token,
        token_expires_at: new Date(
          Date.now() + Number(payload.expires_in || 10800) * 1000,
        ).toISOString(),
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
        last_refresh_error_code: null,
      })
      .eq('tipo', 'mercadolivre');
    if (error) throw new Error(`Falha ao persistir token ML: ${error.message}`);
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
        'apply-supplier-pricing-campaign:cached',
      );
      token = integration.access_token;
      return token;
    }
    token = await refreshToken(integration);
    return token;
  }

  async function mlRequest(pathname, options = {}, attempt = 1) {
    const accessToken = await getToken(attempt > 1 && options.refreshToken);
    let response;
    try {
      response = await fetch(`https://api.mercadolibre.com${pathname}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(options.headers || {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (
        ['AbortError', 'TimeoutError'].includes(String(error?.name || '')) &&
        attempt < 3
      ) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
        return mlRequest(pathname, options, attempt + 1);
      }
      return {
        ok: false,
        status: 0,
        data: null,
        text: error?.message || 'Falha de rede',
      };
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (response.status === 401 && attempt === 1) {
      return mlRequest(
        pathname,
        { ...options, refreshToken: true },
        attempt + 1,
      );
    }
    if (
      [408, 409, 424, 429, 500, 502, 503, 504].includes(response.status) &&
      attempt < 3
    ) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      return mlRequest(pathname, options, attempt + 1);
    }
    return { ok: response.ok, status: response.status, data, text };
  }

  const account = await mlRequest('/users/me');
  if (!account.ok || !account.data?.id) {
    throw new Error(`Falha ao validar conta ML: ${jsonError(account)}`);
  }

  async function fetchAutomatedItemIds(userId) {
    const ids = new Set();
    for (let offset = 0; ; offset += 100) {
      const result = await mlRequest(
        `/pricing-automation/users/${encodeURIComponent(
          userId,
        )}/items?offset=${offset}&limit=100`,
      );
      if (!result.ok) {
        throw new Error(
          `Falha ao consultar automações ML: ${jsonError(result)}`,
        );
      }
      for (const itemId of result.data?.items || []) ids.add(String(itemId));
      const total = Number(result.data?.paging?.total || 0);
      if (offset + 100 >= total) break;
    }
    return ids;
  }

  const automatedItemIds = await fetchAutomatedItemIds(String(account.data.id));

  let productQuery = () => {
    let query = supabase
      .from('produtos')
      .select(
        'id,sku,nome,categoria,fornecedor,custo,ml_fee,ml_shipping,custom_price,ml_item_id,ml_status,ativo',
      )
      .eq('ativo', true)
      .not('ml_item_id', 'is', null)
      .in('ml_status', ['ativo', 'pausado'])
      .order('sku', { ascending: true });
    query = isEvolusom
      ? query.ilike('fornecedor', 'EVOLUSOM-PR')
      : isVanral
      ? query.ilike('fornecedor', 'VANRAL')
      : query.ilike('fornecedor', 'BKR1');
    return query;
  };
  if (scope === 'critical') {
    productQuery = () =>
      supabase
        .from('produtos')
        .select(
          'id,sku,nome,categoria,fornecedor,custo,ml_fee,ml_shipping,custom_price,ml_item_id,ml_status,ativo',
        )
        .in('sku', criticalSkus)
        .order('sku', { ascending: true });
  }
  let products = await fetchAll(productQuery);
  if (isBkr1) {
    products = products.filter(isBkr1BatteryProduct);
  }
  if (inputEvents) {
    const correctionProductIds = new Set(
      fs
        .readFileSync(path.resolve(inputEvents), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((row) =>
          inputReason
            ? row.event === primaryEventName &&
              row.reason === inputReason
            : ['ml_fee_contract_mismatch', 'live_sku_mismatch'].includes(
                row.reason,
              ) ||
              row.reason === 'ml_status_not_editable' ||
              row.result === 'planned',
        )
        .map((row) => String(row.produto_id || '').trim())
        .filter(Boolean),
    );
    products = products.filter((product) => correctionProductIds.has(product.id));
  }

  const ads = [];
  for (let index = 0; index < products.length; index += 200) {
    const productIds = products
      .slice(index, index + 200)
      .map((product) => product.id)
      .filter(Boolean);
    if (productIds.length === 0) continue;
    const { data, error } = await supabase
      .from('anuncios_ml')
      .select('id,produto_id,sku,ml_item_id,preco_ml,vendidos,visitas,status')
      .in('produto_id', productIds);
    if (error) throw new Error(error.message);
    ads.push(...(data || []));
  }
  const adByItemId = new Map(ads.map((ad) => [String(ad.ml_item_id), ad]));
  const adsByProductId = new Map();
  for (const ad of ads) {
    const rows = adsByProductId.get(String(ad.produto_id)) || [];
    rows.push(ad);
    adsByProductId.set(String(ad.produto_id), rows);
  }

  const orderedProducts = [...products].sort((left, right) => {
    const leftIndex = criticalSkus.indexOf(left.sku);
    const rightIndex = criticalSkus.indexOf(right.sku);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    return left.sku.localeCompare(right.sku);
  });

  const results = [];
  for (const product of orderedProducts) {
    let itemId = String(product.ml_item_id || '').trim().toUpperCase();
    const baseEvent = {
      event: primaryEventName,
      mode: apply ? 'apply' : 'dry_run',
      scope,
      sku: product.sku,
      produto_id: product.id,
      ml_item_id: itemId || null,
      supplier: product.fornecedor,
    };

    const supplierMatches = isEvolusom
      ? String(product.fornecedor || '').toUpperCase() === 'EVOLUSOM-PR'
      : isVanral
      ? String(product.fornecedor || '').toUpperCase() === 'VANRAL'
      : String(product.fornecedor || '').toUpperCase() === 'BKR1';
    if (!supplierMatches) {
      results.push(
        appendEvent({
          ...baseEvent,
          result: 'skipped',
          reason: isEvolusom
            ? 'supplier_not_evolusom_pr'
            : isVanral
            ? 'supplier_not_vanral'
            : 'supplier_not_bkr1',
        }),
      );
      continue;
    }
    if (!itemId || !/^MLB\d+$/.test(itemId)) {
      results.push(
        appendEvent({
          ...baseEvent,
          result: 'skipped',
          reason: 'invalid_ml_item_id',
        }),
      );
      continue;
    }

    const productAds = adsByProductId.get(String(product.id)) || [];
    // Linked catalog/traditional listings mirror metrics; summing them doubles
    // the product history. Use the largest observed value for product gating.
    const sold = Math.max(
      0,
      ...productAds.map((row) => Number(row?.vendidos || 0)),
    );
    const visits = Math.max(
      0,
      ...productAds.map((row) => Number(row?.visitas || 0)),
    );
    let front = null;
    let margin = null;
    const isLowCostCymbal =
      isVanral &&
      Number(product.custo) < 650 &&
      /^(?:par\s+de\s+)?pratos?\b/i.test(String(product.nome || '').trim());
    if (
      isEvolusom &&
      EVOLUSOM_OFFENSIVE_CRITICAL_SKUS.has(product.sku)
    ) {
      front = 'offensive';
      margin = EVOLUSOM_MARGIN_OVERRIDES.get(product.sku) || 0.08;
    } else if (
      isEvolusom &&
      (Number(product.custo) > 80 || sold > 2)
    ) {
      front = 'defensive';
      margin = EVOLUSOM_MARGIN_OVERRIDES.get(product.sku) || DEFENSIVE_MARGIN;
    } else if (isEvolusom && sold === 0 && visits > 40) {
      front = 'offensive';
      margin = EVOLUSOM_MARGIN_OVERRIDES.get(product.sku) || 0.06;
    } else if (isVanral && isLowCostCymbal) {
      front = 'offensive';
      margin = VANRAL_MARGIN_OVERRIDES.get(product.sku) || OFFENSIVE_MARGIN;
    } else if (
      isVanral &&
      (Number(product.custo) > 1000 || sold > 5)
    ) {
      front = 'defensive';
      margin = VANRAL_MARGIN_OVERRIDES.get(product.sku) || DEFENSIVE_MARGIN;
    } else if (
      isVanral &&
      Number(product.custo) < 650 &&
      visits > 100 &&
      sold === 0
    ) {
      front = 'offensive';
      margin = VANRAL_MARGIN_OVERRIDES.get(product.sku) || OFFENSIVE_MARGIN;
    } else if (isBkr1 && (sold >= 1 || Number(product.custo) > 30)) {
      front = 'defensive';
      margin = BKR1_MARGIN_OVERRIDES.get(product.sku) || DEFENSIVE_MARGIN;
    } else if (
      isBkr1 &&
      sold === 0 &&
      Number(product.custo) < 25 &&
      visits > 0
    ) {
      front = 'offensive';
      margin = BKR1_MARGIN_OVERRIDES.get(product.sku) || OFFENSIVE_MARGIN;
    } else {
      results.push(
        appendEvent({
          ...baseEvent,
          result: 'skipped',
          reason: 'matrix_not_matched',
          sold_quantity_lifetime: sold,
          visits_history: visits,
        }),
      );
      continue;
    }

    const prefetchedItemsById = new Map();
    let item = null;
    {
      const linkedItemIds = [
        ...new Set(
          [itemId, ...productAds.map((row) => row.ml_item_id)]
            .map((value) => String(value || '').trim().toUpperCase())
            .filter((value) => /^MLB\d+$/.test(value)),
        ),
      ];
      for (const linkedItemId of linkedItemIds) {
        const linkedItem = await mlRequest(
          `/items/${encodeURIComponent(
            linkedItemId,
          )}?include_internal_attributes=true`,
        );
        if (linkedItem.ok) {
          const linkedParams = new URLSearchParams({
            price: String(Number(linkedItem.data?.price || 0)),
            listing_type_id: String(linkedItem.data?.listing_type_id || ''),
            category_id: String(linkedItem.data?.category_id || ''),
            currency_id: 'BRL',
          });
          if (linkedItem.data?.shipping?.mode) {
            linkedParams.set('shipping_mode', linkedItem.data.shipping.mode);
          }
          if (linkedItem.data?.shipping?.logistic_type) {
            linkedParams.set(
              'logistic_type',
              linkedItem.data.shipping.logistic_type,
            );
          }
          const linkedFees = await mlRequest(
            `/sites/MLB/listing_prices?${linkedParams.toString()}`,
          );
          const linkedFeeRows = Array.isArray(linkedFees.data)
            ? linkedFees.data
            : [linkedFees.data];
          const linkedFeeRow =
            linkedFeeRows.find(
              (row) =>
                String(row?.listing_type_id || '') ===
                String(linkedItem.data?.listing_type_id || ''),
            ) || linkedFeeRows[0];
          linkedItem.livePercentageFee = Number(
            linkedFeeRow?.sale_fee_details?.percentage_fee || 0,
          );
          linkedItem.liveFixedFee = Number(
            linkedFeeRow?.sale_fee_details?.fixed_fee || 0,
          );
        }
        prefetchedItemsById.set(linkedItemId, linkedItem);
      }
      const listingPriority = (listingTypeId) => {
        if (listingTypeId === 'gold_pro') return 3;
        if (listingTypeId === 'gold_premium') return 2;
        if (listingTypeId === 'gold_special') return 1;
        return 0;
      };
      const selected = [...prefetchedItemsById.entries()]
        .filter(
          ([, response]) =>
            response.ok &&
            ['active', 'paused'].includes(
              String(response.data?.status || '').toLowerCase(),
            ),
        )
        .reduce((best, current) => {
          if (!best) return current;
          const score = ([, response]) =>
            Number(response.livePercentageFee || 0) * 100000 +
            Number(response.liveFixedFee || 0) * 100 +
            listingPriority(String(response.data?.listing_type_id || ''));
          return score(current) > score(best) ? current : best;
        }, null);
      baseEvent.linked_listing_contracts = [...prefetchedItemsById.entries()].map(
        ([linkedItemId, response]) => ({
          ml_item_id: linkedItemId,
          ok: response.ok,
          listing_type_id: response.data?.listing_type_id || null,
          percentage_fee: Number(response.livePercentageFee || 0) / 100,
          fixed_fee: Number(response.liveFixedFee || 0),
        }),
      );
      if (selected) {
        [itemId, item] = selected;
        baseEvent.ml_item_id = itemId;
      }
    }
    item =
      item ||
      (await mlRequest(
        `/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`,
      ));
    if (!item.ok) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'ml_item_fetch_failed',
          http_status: item.status,
          error: jsonError(item),
        }),
      );
      continue;
    }
    const liveStatus = String(item.data?.status || '').toLowerCase();
    if (!['active', 'paused'].includes(liveStatus)) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'skipped',
          reason: 'ml_status_not_editable',
          ml_status: liveStatus,
        }),
      );
      continue;
    }
    const liveSku = sellerSku(item.data);
    if (liveSku && liveSku !== product.sku) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'skipped',
          reason: 'live_sku_mismatch',
          live_sku: liveSku,
        }),
      );
      continue;
    }
    const isAutomated =
      automatedItemIds.has(itemId) ||
      (item.data?.tags || []).includes('dynamic_standard_price');
    if (isAutomated) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'skipped',
          reason: 'dynamic_standard_price_active',
        }),
      );
      continue;
    }

    const initialTarget = calculateTarget({
      cost: product.custo,
      shipping: product.ml_shipping,
      fixedFee: 0,
      mlFee: product.ml_fee,
      margin,
    });
    const listingTypeId = String(item.data?.listing_type_id || '').trim();
    const categoryId = String(item.data?.category_id || '').trim();
    const shippingMode = String(item.data?.shipping?.mode || '').trim();
    const logisticType = String(item.data?.shipping?.logistic_type || '').trim();
    const feesByPrice = new Map();
    async function listingFees(price) {
      if (feesByPrice.has(price)) return feesByPrice.get(price);
      const params = new URLSearchParams({
        price: String(price),
        listing_type_id: listingTypeId,
        category_id: categoryId,
        currency_id: 'BRL',
      });
      if (shippingMode) params.set('shipping_mode', shippingMode);
      if (logisticType) params.set('logistic_type', logisticType);
      const response = await mlRequest(
        `/sites/MLB/listing_prices?${params.toString()}`,
      );
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: jsonError(response),
        };
      }
      const rows = Array.isArray(response.data)
        ? response.data
        : [response.data];
      const row =
        rows.find(
          (candidate) =>
            String(candidate?.listing_type_id) === listingTypeId,
        ) || rows[0];
      const percentageFee =
        Number(row?.sale_fee_details?.percentage_fee) / 100;
      const fixedFee = Number(row?.sale_fee_details?.fixed_fee || 0);
      const result = Number.isFinite(percentageFee)
        ? { ok: true, percentageFee, fixedFee }
        : {
            ok: false,
            status: response.status,
            error: 'Taxa percentual ausente no calculador do Mercado Livre',
          };
      feesByPrice.set(price, result);
      return result;
    }

    const candidatePrices = new Set([initialTarget]);
    let probePrice = initialTarget;
    let calculatorFailure = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const fees = await listingFees(probePrice);
      if (!fees.ok) {
        calculatorFailure = fees;
        break;
      }
      const requiredPrice = calculateTarget({
        cost: product.custo,
        shipping: product.ml_shipping,
        fixedFee: fees.fixedFee,
        mlFee: fees.percentageFee,
        margin,
      });
      candidatePrices.add(requiredPrice);
      if (requiredPrice === probePrice) break;
      probePrice = requiredPrice;
    }
    if (calculatorFailure) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'listing_price_calculator_failed',
          http_status: calculatorFailure.status,
          error: calculatorFailure.error,
        }),
      );
      continue;
    }

    const evaluatedCandidates = [];
    for (const price of candidatePrices) {
      const fees = await listingFees(price);
      if (!fees.ok) {
        calculatorFailure = fees;
        break;
      }
      evaluatedCandidates.push({
        price,
        percentageFee: fees.percentageFee,
        fixedFee: fees.fixedFee,
        requiredPrice: calculateTarget({
          cost: product.custo,
          shipping: product.ml_shipping,
          fixedFee: fees.fixedFee,
          mlFee: fees.percentageFee,
          margin,
        }),
      });
    }
    if (calculatorFailure) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'listing_price_calculator_failed',
          http_status: calculatorFailure.status,
          error: calculatorFailure.error,
        }),
      );
      continue;
    }
    const selectedFees = evaluatedCandidates
      .filter((candidate) => candidate.price >= candidate.requiredPrice)
      .sort((left, right) => left.price - right.price)[0];
    if (!selectedFees) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'safe_price_not_found',
        }),
      );
      continue;
    }
    const percentageFee = selectedFees.percentageFee;
    const fixedFee = selectedFees.fixedFee;
    const targetPrice = selectedFees.price;
    const feeTierGuardApplied = targetPrice > selectedFees.requiredPrice;
    const feeMismatch =
      Number.isFinite(percentageFee) &&
      Math.abs(percentageFee - Number(product.ml_fee)) > 0.0001;
    if (!Number.isFinite(percentageFee) || (feeMismatch && !syncMlFee)) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'skipped',
          reason: 'ml_fee_contract_mismatch',
          local_ml_fee: Number(product.ml_fee),
          live_ml_fee: Number.isFinite(percentageFee) ? percentageFee : null,
          listing_type_id: listingTypeId,
        }),
      );
      continue;
    }
    const pricesBefore = await mlRequest(
      `/items/${encodeURIComponent(itemId)}/prices`,
      { headers: { 'show-all-prices': 'true' } },
    );
    if (!pricesBefore.ok) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'prices_before_fetch_failed',
          http_status: pricesBefore.status,
          error: jsonError(pricesBefore),
        }),
      );
      continue;
    }
    const oldPrice = standardPrice(pricesBefore.data);
    if (oldPrice === null) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'standard_price_missing',
        }),
      );
      continue;
    }

    const example = providedExamples.get(product.sku) || null;
    const formula = {
      cost: Number(product.custo),
      shipping: Number(product.ml_shipping),
      fixed_cost: fixedFee,
      ml_fee: percentageFee,
      das: pricingTaxRate,
      desired_margin: margin,
      denominator: 1 - percentageFee - pricingTaxRate - margin,
      required_price: selectedFees.requiredPrice,
      target_price: targetPrice,
      fee_tier_guard_applied: feeTierGuardApplied,
    };
    async function syncLinkedListings() {
      let linkedOk = true;
      const linkedItemIds = [
        ...new Set(
          productAds
            .map((row) => String(row.ml_item_id || '').trim().toUpperCase())
            .filter((value) => /^MLB\d+$/.test(value) && value !== itemId),
        ),
      ];
      for (const linkedItemId of linkedItemIds) {
        const linkedBaseEvent = {
          ...baseEvent,
          event: linkedEventName,
          ml_item_id: linkedItemId,
          primary_pricing_item_id: itemId,
        };
        const linkedItem =
          prefetchedItemsById.get(linkedItemId) ||
          (await mlRequest(
            `/items/${encodeURIComponent(
              linkedItemId,
            )}?include_internal_attributes=true`,
          ));
        if (!linkedItem.ok) {
          linkedOk = false;
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'failed',
              reason: 'linked_ml_item_fetch_failed',
              http_status: linkedItem.status,
              error: jsonError(linkedItem),
            }),
          );
          continue;
        }
        const linkedStatus = String(linkedItem.data?.status || '').toLowerCase();
        const linkedSku = sellerSku(linkedItem.data);
        const linkedAutomated =
          automatedItemIds.has(linkedItemId) ||
          (linkedItem.data?.tags || []).includes('dynamic_standard_price');
        if (!['active', 'paused'].includes(linkedStatus)) {
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'skipped',
              reason: 'linked_ml_status_not_editable',
              ml_status: linkedStatus,
            }),
          );
          continue;
        }
        if (linkedSku && linkedSku !== product.sku) {
          linkedOk = false;
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'skipped',
              reason: 'linked_live_sku_mismatch',
              live_sku: linkedSku,
            }),
          );
          continue;
        }
        if (linkedAutomated) {
          linkedOk = false;
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'skipped',
              reason: 'linked_dynamic_standard_price_active',
            }),
          );
          continue;
        }
        const linkedPricesBefore = await mlRequest(
          `/items/${encodeURIComponent(linkedItemId)}/prices`,
          { headers: { 'show-all-prices': 'true' } },
        );
        const linkedOldPrice = linkedPricesBefore.ok
          ? standardPrice(linkedPricesBefore.data)
          : null;
        if (!linkedPricesBefore.ok || linkedOldPrice === null) {
          linkedOk = false;
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'failed',
              reason: 'linked_standard_price_fetch_failed',
              http_status: linkedPricesBefore.status,
              error: linkedPricesBefore.ok ? null : jsonError(linkedPricesBefore),
            }),
          );
          continue;
        }
        if (linkedOldPrice === targetPrice) {
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'unchanged',
              old_price: linkedOldPrice,
              new_price: targetPrice,
              formula,
            }),
          );
          continue;
        }
        if (!apply) {
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'planned',
              old_price: linkedOldPrice,
              new_price: targetPrice,
              formula,
            }),
          );
          continue;
        }
        const linkedUpdate = await mlRequest(
          `/items/${encodeURIComponent(linkedItemId)}`,
          { method: 'PUT', body: { price: targetPrice } },
        );
        const linkedPricesAfter = linkedUpdate.ok
          ? await mlRequest(`/items/${encodeURIComponent(linkedItemId)}/prices`, {
              headers: { 'show-all-prices': 'true' },
            })
          : null;
        const linkedVerifiedPrice = linkedPricesAfter?.ok
          ? standardPrice(linkedPricesAfter.data)
          : null;
        if (!linkedUpdate.ok || linkedVerifiedPrice !== targetPrice) {
          linkedOk = false;
          results.push(
            appendEvent({
              ...linkedBaseEvent,
              front,
              result: 'failed',
              reason: linkedUpdate.ok
                ? 'linked_ml_price_verification_failed'
                : 'linked_ml_price_update_failed',
              old_price: linkedOldPrice,
              new_price: targetPrice,
              verified_price: linkedVerifiedPrice,
              formula,
              http_status: linkedPricesAfter?.status || linkedUpdate.status,
              error: linkedUpdate.ok
                ? linkedPricesAfter?.ok
                  ? null
                  : jsonError(linkedPricesAfter)
                : jsonError(linkedUpdate),
            }),
          );
          continue;
        }
        const linkedAdUpdate = await supabase
          .from('anuncios_ml')
          .update({ preco_ml: targetPrice })
          .eq('produto_id', product.id)
          .eq('ml_item_id', linkedItemId)
          .select('id,preco_ml');
        const linkedLocalOk =
          !linkedAdUpdate.error &&
          (linkedAdUpdate.data || []).length > 0 &&
          (linkedAdUpdate.data || []).every(
            (row) => Number(row.preco_ml) === targetPrice,
          );
        if (!linkedLocalOk) linkedOk = false;
        results.push(
          appendEvent({
            ...linkedBaseEvent,
            front,
            result: linkedLocalOk ? 'changed' : 'changed_ml_local_failed',
            old_price: linkedOldPrice,
            new_price: targetPrice,
            verified_price: linkedVerifiedPrice,
            formula,
            ml_http_status: linkedUpdate.status,
            local_ads_updated: linkedAdUpdate.data?.length || 0,
            local_error: linkedAdUpdate.error?.message || null,
          }),
        );
      }
      return linkedOk;
    }
    if (oldPrice === targetPrice) {
      const linkedOk = await syncLinkedListings();
      if (apply && feeMismatch && syncMlFee) {
        const feeUpdate = await supabase
          .from('produtos')
          .update({ ml_fee: percentageFee })
          .eq('id', product.id)
          .select('id,ml_fee')
          .maybeSingle();
        const feeUpdated =
          !feeUpdate.error &&
          Number(feeUpdate.data?.ml_fee) === percentageFee &&
          linkedOk;
        results.push(
          appendEvent({
            ...baseEvent,
            front,
            result: feeUpdated ? 'fee_synced' : 'fee_sync_failed',
            old_price: oldPrice,
            new_price: targetPrice,
            old_ml_fee: Number(product.ml_fee),
            new_ml_fee: percentageFee,
            formula,
            provided_example: example,
            local_error: feeUpdate.error?.message || null,
          }),
        );
        continue;
      }
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'unchanged',
          old_price: oldPrice,
          new_price: targetPrice,
          formula,
          provided_example: example,
        }),
      );
      continue;
    }
    if (!apply) {
      await syncLinkedListings();
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'planned',
          old_price: oldPrice,
          new_price: targetPrice,
          formula,
          provided_example: example,
        }),
      );
      continue;
    }

    const update = await mlRequest(`/items/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      body: { price: targetPrice },
    });
    if (!update.ok) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'ml_price_update_failed',
          old_price: oldPrice,
          new_price: targetPrice,
          formula,
          http_status: update.status,
          error: jsonError(update),
        }),
      );
      continue;
    }

    const pricesAfter = await mlRequest(
      `/items/${encodeURIComponent(itemId)}/prices`,
      { headers: { 'show-all-prices': 'true' } },
    );
    const verifiedPrice = pricesAfter.ok ? standardPrice(pricesAfter.data) : null;
    if (!pricesAfter.ok || verifiedPrice !== targetPrice) {
      results.push(
        appendEvent({
          ...baseEvent,
          front,
          result: 'failed',
          reason: 'ml_price_verification_failed',
          old_price: oldPrice,
          new_price: targetPrice,
          verified_price: verifiedPrice,
          formula,
          http_status: pricesAfter.status,
          error: pricesAfter.ok ? null : jsonError(pricesAfter),
        }),
      );
      continue;
    }

    const linkedOk = await syncLinkedListings();

    const productPatch = {
      custom_price: targetPrice,
      ...(feeMismatch && syncMlFee ? { ml_fee: percentageFee } : {}),
    };
    const productUpdate = await supabase
      .from('produtos')
      .update(productPatch)
      .eq('id', product.id)
      .select('id,custom_price,ml_fee')
      .maybeSingle();
    const adUpdate = await supabase
      .from('anuncios_ml')
      .update({ preco_ml: targetPrice })
      .eq('produto_id', product.id)
      .eq('ml_item_id', itemId)
      .select('id,preco_ml');
    const localOk =
      !productUpdate.error &&
      productUpdate.data?.custom_price === targetPrice &&
      (!feeMismatch ||
        !syncMlFee ||
        Number(productUpdate.data?.ml_fee) === percentageFee) &&
      !adUpdate.error &&
      (adUpdate.data || []).length > 0 &&
      linkedOk;

    results.push(
      appendEvent({
        ...baseEvent,
        front,
        result: localOk ? 'changed' : 'changed_ml_local_failed',
        old_price: oldPrice,
        new_price: targetPrice,
        verified_price: verifiedPrice,
        formula,
        old_ml_fee: Number(product.ml_fee),
        new_ml_fee: percentageFee,
        provided_example: example,
        ml_http_status: update.status,
        local_product_updated: Boolean(productUpdate.data),
        local_ads_updated: adUpdate.data?.length || 0,
        local_error:
          productUpdate.error?.message || adUpdate.error?.message || null,
      }),
    );
  }

  const counts = results.reduce((acc, row) => {
    acc[row.result] = (acc[row.result] || 0) + 1;
    return acc;
  }, {});
  let safeInputPath = null;
  let safeProducts = null;
  if (!apply) {
    const safeRows = buildSafeInputRows(
      results,
      primaryEventName,
      linkedEventName,
    );
    safeInputPath = path.join(outputDir, 'safe-input.ndjson');
    fs.writeFileSync(
      safeInputPath,
      safeRows.map((row) => JSON.stringify(row)).join('\n') +
        (safeRows.length ? '\n' : ''),
    );
    safeProducts = safeRows.length;
  }
  const summary = {
    event: isEvolusom
      ? 'evolusom_cash_tourniquet_summary'
      : isVanral
      ? 'vanral_instrument_dynamic_pricing_summary'
      : 'bkr1_battery_dynamic_pricing_summary',
    timestamp_utc: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry_run',
    profile,
    scope,
    output_dir: outputDir,
    products_scanned: products.length,
    automated_items_found: automatedItemIds.size,
    counts,
    safe_products: safeProducts,
    safe_input_file: safeInputPath,
    events_file: eventsPath,
  };
  fs.writeFileSync(
    path.join(outputDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary));

  if ((counts.failed || 0) > 0 || (counts.changed_ml_local_failed || 0) > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'supplier_pricing_campaign_fatal',
      timestamp_utc: new Date().toISOString(),
      error: error?.message || String(error),
    }),
  );
  process.exit(1);
});
