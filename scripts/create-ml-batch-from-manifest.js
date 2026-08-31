const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { calculateExactMarginPrice } = require('../src/services/pricing.ts');
const { loadPricingTaxRate } = require('./lib/pricing-tax-context');

dotenv.config({ path: '.env.local' });

const MANIFEST_PATH = process.env.ML_BATCH_MANIFEST;
const BASE_URL = process.env.BATCH_API_URL || 'http://localhost:3000';
const DELAY_MS = Number(process.env.BATCH_DELAY_MS || '1500');
const REQUEST_TIMEOUT_MS = Number(process.env.BATCH_REQUEST_TIMEOUT_MS || '45000');
const DRY_RUN = process.env.DRY_RUN === '1';
const ALLOW_OUT_OF_STOCK = process.env.BATCH_ALLOW_OUT_OF_STOCK === '1';
// The listing route supplies the official EMPTY_GTIN_REASON=Kit when the
// category permits it. Keep GTIN as a preflight blocker by default; batches
// for known kits opt in explicitly and let Mercado Livre make the final call.
const ALLOW_EMPTY_GTIN_FOR_KITS = process.env.BATCH_ALLOW_EMPTY_GTIN_FOR_KITS === '1';
// Strict supplier batches never use AI/web guesses as publication evidence.
const STRICT_EVIDENCE = process.env.BATCH_STRICT_EVIDENCE !== '0';
const SKIP_SMART_FILL = STRICT_EVIDENCE || process.env.BATCH_SKIP_SMART_FILL === '1';
const RESULT_FILE = process.env.ML_BATCH_RESULT_FILE || '';
const STOP_AFTER_CONSECUTIVE_FAILURES = Math.max(
  0,
  Number(process.env.BATCH_STOP_AFTER_CONSECUTIVE_FAILURES || 0),
);
const LOGIN_EMAIL = process.env.BATCH_LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.BATCH_LOGIN_PASSWORD || '';
const HOST_HEADER = process.env.BATCH_HOST_HEADER || '';
const DIRECT_IP = process.env.BATCH_DIRECT_IP || '';
let authCookie = process.env.BATCH_COOKIE || '';

if (!MANIFEST_PATH) {
  console.error('Defina ML_BATCH_MANIFEST com caminho do manifesto.');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
let pricingTaxRate = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function heuristicFreight(product) {
  const stored = Number(product?.ml_shipping || 0);
  if (stored > 0) return { value: stored, source: 'erp' };
  const cost = Number(product?.custo || 0);
  const dimensions = [product?.altura, product?.largura, product?.profundidade].map(Number);
  const volume = dimensions.reduce(
    (total, value) => total * (Number.isFinite(value) && value > 0 ? value : 0),
    1,
  );
  const highVolume = Number(product?.peso_bruto || 0) > 10 ||
    dimensions.some((value) => value > 100) || volume > 100000;
  if (cost > 400 || highVolume) return { value: 110, source: 'heuristic' };
  if (cost < 50) return { value: 6.5, source: 'heuristic' };
  if (cost <= 150) return { value: 25, source: 'heuristic' };
  return { value: 55, source: 'heuristic' };
}

async function profitableShelfPricing(product, categoryId, listingType) {
  const cost = Number(product?.custo || 0);
  const shipping = heuristicFreight(product);
  const margin = cost + shipping.value < 50 ? 0.08 : 0.25;
  let mlFee = Number(product?.ml_fee || 0.15);
  const calculate = () => {
    if (pricingTaxRate === null) throw new Error('Alíquota tributária indisponível');
    return calculateExactMarginPrice({
      cost,
      shipping: shipping.value,
      mlFee,
      margin,
      taxRate: pricingTaxRate,
    });
  };
  let price = calculate();
  const liveFee = await percentageFee(categoryId, listingType, price);
  if (liveFee) mlFee = liveFee;
  price = calculate();
  return {
    cost,
    shipping: shipping.value,
    shippingSource: shipping.source,
    mlFee,
    taxRate: pricingTaxRate,
    margin,
    price,
  };
}

async function chooseListingType(product, categoryId, requested) {
  if (requested && requested !== 'auto') return requested;
  const expectedFee = Number(product?.ml_fee || 0.15);
  const shipping = heuristicFreight(product).value;
  const cost = Number(product?.custo || 0);
  const margin = cost + shipping < 50 ? 0.08 : 0.25;
  const denominator = 1 - expectedFee - Number(pricingTaxRate) - margin;
  const probePrice = denominator > 0 ? (cost + shipping) / denominator : cost + shipping;
  const candidates = [];
  for (const listingType of ['gold_special', 'gold_pro']) {
    const fee = await percentageFee(categoryId, listingType, probePrice);
    if (fee) candidates.push({ listingType, fee });
  }
  candidates.sort((a, b) => {
    const difference = Math.abs(a.fee - expectedFee) - Math.abs(b.fee - expectedFee);
    if (difference !== 0) return difference;
    return a.listingType === 'gold_special' ? -1 : 1;
  });
  if (!candidates[0]) throw new Error('Nenhum tipo de anúncio disponível para a categoria');
  return candidates[0].listingType;
}

function normalizePredictionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildPredictionTitles(produto) {
  const rawName = normalizePredictionText(produto?.nome);
  const brand = normalizePredictionText(produto?.marca);
  const titles = new Set();

  const add = (value) => {
    const text = normalizePredictionText(value);
    if (text) titles.add(text.slice(0, 60));
  };

  add(brand ? `${rawName} ${brand}` : rawName);

  const compactBattery = rawName
    .replace(/\b(\d+)\s*cr\s*(\d{3,4})\b/gi, 'CR$2')
    .replace(/\b(\d+)\s*lr\s*(\d{2,4})\b/gi, 'LR$2')
    .replace(/\b(\d+)\s*sr\s*(\d{2,4})\b/gi, 'SR$2');
  add(brand ? `${compactBattery} ${brand}` : compactBattery);

  const cleanedName = rawName
    .replace(/\b(?:grl|std|s\.t\.d|picker)\b/gi, ' ')
    .replace(/\b[a-z]{1,4}-?[a-z0-9]{3,}\b/gi, ' ')
    .replace(/\br\d{4,}\b/gi, ' ')
    .replace(/\b\d+\s*(?:un|und|unid|unidade|cart|cartela|kit)\b/gi, ' ')
    .replace(/\(([^)]+)\)/g, ' $1 ');
  add(brand ? `${cleanedName} ${brand}` : cleanedName);

  if (/\bpalheta\b/i.test(rawName)) {
    const palhetaTitle = cleanedName.replace(/\bpalheta\b/i, 'Palheta para guitarra');
    add(brand ? `${palhetaTitle} ${brand}` : palhetaTitle);
  }

  if (/\b(?:cr|lr|sr)\d{2,4}\b/i.test(compactBattery) && !/\bbateria\b/i.test(compactBattery)) {
    add(`${compactBattery.replace(/\bpilha\b/i, 'Bateria')}${brand ? ` ${brand}` : ''}`);
  }

  return Array.from(titles);
}

let mlAccessTokenPromise = null;
const listingFeeCache = new Map();

async function getMlAccessToken() {
  if (!mlAccessTokenPromise) {
    mlAccessTokenPromise = supabase
      .from('integracoes')
      .select('access_token')
      .eq('tipo', 'mercadolivre')
      .single()
      .then(({ data, error }) => {
        if (error) throw new Error(`Falha ao ler token ML: ${error.message}`);
        if (!data?.access_token) throw new Error('Token ML indisponível');
        return data.access_token;
      });
  }
  return mlAccessTokenPromise;
}

async function percentageFee(categoryId, listingType, price) {
  const normalizedPrice = Math.max(1, Math.round(Number(price || 1) * 100) / 100);
  const key = `${categoryId}|${listingType}|${normalizedPrice}`;
  if (listingFeeCache.has(key)) return listingFeeCache.get(key);
  const token = await getMlAccessToken();
  const params = new URLSearchParams({
    price: String(normalizedPrice),
    category_id: String(categoryId),
    listing_type_id: String(listingType),
  });
  const response = await fetch(`https://api.mercadolibre.com/sites/MLB/listing_prices?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => null);
  const percentage = Number(
    data?.sale_fee_details?.percentage_fee ?? data?.sale_fee_details?.meli_percentage_fee,
  );
  const value = response.ok && Number.isFinite(percentage) && percentage > 0
    ? percentage / 100
    : null;
  listingFeeCache.set(key, value);
  return value;
}

async function getSimpleKitComponentCategory(produtoId) {
  const { data: components, error: componentsError } = await supabase
    .from('produto_kit_componentes')
    .select('componente_produto_id')
    .eq('kit_produto_id', String(produtoId));
  if (componentsError || (components || []).length !== 1) return null;

  const { data: component, error: componentError } = await supabase
    .from('produtos')
    .select('ml_item_id')
    .eq('id', String(components[0].componente_produto_id))
    .maybeSingle();
  const itemId = String(component?.ml_item_id || '').trim();
  if (componentError || !itemId) return null;

  const token = await getMlAccessToken();
  const response = await fetch(
    `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?attributes=category_id`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return null;
  const data = await response.json();
  const categoryId = String(data?.category_id || '').trim();
  return categoryId || null;
}

async function predictCategoryDirect(produto, limit = 8) {
  const token = await getMlAccessToken();
  const categories = [];
  const seen = new Set();

  for (const title of buildPredictionTitles(produto)) {
    const response = await fetch(`https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=${encodeURIComponent(title)}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    let data = [];
    try { data = text ? JSON.parse(text) : []; } catch { data = []; }
    if (!response.ok) continue;
    for (const item of Array.isArray(data) ? data : []) {
      const id = String(item?.category_id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      categories.push({
        id,
        nome: item.category_name || id,
        dominio: item.domain_name || '',
      });
    }
  }

  return categories;
}

function buildHeaders(base = {}) {
  const headers = { ...base };
  if (HOST_HEADER) headers.Host = HOST_HEADER;
  return headers;
}

function requestText(targetUrl, { method = 'GET', headers = {}, body = '' } = {}) {
  const parsed = new URL(targetUrl);

  if (DIRECT_IP) {
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const headerFile = path.join(os.tmpdir(), `ml-batch-headers-${process.pid}-${Date.now()}.txt`);
    const args = [
      '-k',
      '--silent',
      '--show-error',
      '--max-time',
      String(Math.max(1, Math.ceil(REQUEST_TIMEOUT_MS / 1000))),
      '--output',
      '-',
      '--dump-header',
      headerFile,
      '--write-out',
      '\n__STATUS__:%{http_code}',
      '--request',
      method,
      '--resolve',
      `${parsed.hostname}:${port}:${DIRECT_IP}`,
      targetUrl,
    ];

    for (const [key, value] of Object.entries(headers || {})) {
      args.push('-H', `${key}: ${value}`);
    }
    if (body) args.push('--data', body);

    const exec = spawnSync('curl', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });

    const headerText = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, 'utf8') : '';
    if (fs.existsSync(headerFile)) fs.unlinkSync(headerFile);
    if (exec.error) throw exec.error;
    if (exec.status !== 0) {
      throw new Error(exec.stderr || exec.stdout || `curl exited ${exec.status}`);
    }

    const raw = exec.stdout || '';
    const marker = '\n__STATUS__:';
    const markerIndex = raw.lastIndexOf(marker);
    const text = markerIndex >= 0 ? raw.slice(0, markerIndex) : raw;
    const status = markerIndex >= 0 ? Number(raw.slice(markerIndex + marker.length).trim()) : 0;
    const cookies = headerText
      .split(/\r?\n/)
      .filter((line) => /^set-cookie:/i.test(line))
      .map((line) => line.replace(/^set-cookie:\s*/i, '').trim())
      .filter(Boolean);

    return Promise.resolve({ status, text, headers: {}, cookies });
  }

  return fetch(targetUrl, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(async (response) => ({
    status: response.status,
    text: await response.text(),
    headers: response.headers,
    cookies: response.headers.getSetCookie(),
  }));
}

async function ensureAuthCookie() {
  if (authCookie) return authCookie;
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) return '';
  const response = await requestText(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email: LOGIN_EMAIL, senha: LOGIN_PASSWORD }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Falha login batch HTTP ${response.status}: ${response.text.slice(0, 300)}`);
  }
  const cookies = response.cookies.map((row) => row.split(';')[0]).filter(Boolean);
  authCookie = cookies.join('; ');
  return authCookie;
}

async function postJson(apiPath, body) {
  const headers = buildHeaders({
    'Content-Type': 'application/json',
    'x-local-dev-batch': 'true',
  });
  if (process.env.API_SECRET_KEY) headers['x-api-key'] = process.env.API_SECRET_KEY;
  const cookie = await ensureAuthCookie();
  if (cookie) headers.Cookie = cookie;

  const response = await requestText(`${BASE_URL}${apiPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = response.text ? JSON.parse(response.text) : null; } catch { data = { raw: response.text }; }
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(data?.error || data?.erro || data?.message || response.text || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function missingRequired(attrs, { allowEmptyGtinForKit = false } = {}) {
  return (attrs || []).filter((attr) => {
    if (hasText(attr.value_id) || hasText(attr.value_name)) return false;
    const id = String(attr?.id || '').toUpperCase();
    return !(
      allowEmptyGtinForKit &&
      (id === 'GTIN' || id === 'EMPTY_GTIN_REASON')
    );
  });
}

function sanitizeCatalogOverrides(overrides) {
  const candidates = Array.isArray(overrides) ? overrides : [];
  const alphanumericModel = candidates.find(
    (attribute) =>
      String(attribute?.id || '').toUpperCase() === 'ALPHANUMERIC_MODELS' &&
      hasText(attribute?.value_name),
  );

  return candidates.flatMap((attribute) => {
    const id = String(attribute?.id || '').toUpperCase();
    const valueName = String(attribute?.value_name || '').trim();

    // Some catalog records contain SEO text instead of the actual model.
    if (id === 'MODEL' && valueName.length > 120) {
      return alphanumericModel
        ? [{ ...attribute, value_id: '', value_name: alphanumericModel.value_name }]
        : [];
    }

    // Reject clearly corrupt catalog powers instead of publishing an unsafe value.
    if (id === 'POWER_OUTPUT') {
      const numericPower = Number(valueName.replace(/[^\d.,]/g, '').replace(',', '.'));
      if (Number.isFinite(numericPower) && numericPower > 100000) return [];
    }

    return [attribute];
  });
}

function applyAttributeOverrides(attrs, overrides) {
  const byId = new Map(
    sanitizeCatalogOverrides(overrides)
      .filter((attribute) => hasText(attribute?.id))
      .map((attribute) => [String(attribute.id).toUpperCase(), attribute]),
  );
  return (attrs || []).map((attribute) => {
    const override = byId.get(String(attribute.id || '').toUpperCase());
    if (!override) return attribute;
    return {
      ...attribute,
      value_id: hasText(override.value_id) ? String(override.value_id) : '',
      value_name: hasText(override.value_name) ? String(override.value_name) : '',
    };
  });
}

function applyKitIdentifierPolicy(attrs, item) {
  if (item.preflight?.omitComponentGtin !== true) return attrs;
  return [
    ...(attrs || []).filter(
      (attribute) =>
        !['GTIN', 'EMPTY_GTIN_REASON'].includes(
          String(attribute?.id || '').toUpperCase(),
        ),
    ),
    {
      id: 'EMPTY_GTIN_REASON',
      name: 'Motivo de GTIN vazio',
      value_id: '17055159',
      value_name: 'O produto é um kit ou pack',
    },
  ];
}

function applyExplicitEmptyIdentifierPolicy(attrs, item) {
  const reason = item.preflight?.emptyGtinReason;
  if (item.preflight?.omitGtin !== true || !reason?.value_id || !reason?.value_name) {
    return attrs;
  }
  return [
    ...(attrs || []).filter(
      (attribute) =>
        !['GTIN', 'EMPTY_GTIN_REASON'].includes(
          String(attribute?.id || '').toUpperCase(),
        ),
    ),
    {
      id: 'EMPTY_GTIN_REASON',
      name: 'Motivo de GTIN vazio',
      value_id: String(reason.value_id),
      value_name: String(reason.value_name),
    },
  ];
}

function fillKnownBatteryAttributes(attrs, productName) {
  const text = normalizePredictionText(productName)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const rechargeable = /recarregavel|eneloop/.test(text)
    ? 'Sim'
    : /\b(?:alcalinas?|comu[mn]s?|zincos?|lithium|cr\d{3,4}|lr\d{2,4})\b/.test(text)
      ? 'Não'
      : '';
  if (!rechargeable) return attrs;

  return attrs.map((attr) => {
    if (String(attr.id || '').toUpperCase() !== 'IS_RECHARGEABLE') return attr;
    if (hasText(attr.value_id) || hasText(attr.value_name)) return attr;
    const allowed = (attr.values || []).find((value) => String(value.name) === rechargeable);
    return {
      ...attr,
      value_id: allowed ? String(allowed.id) : '',
      value_name: rechargeable,
    };
  });
}

function plainSupplierText(value) {
  return String(value || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&lt;/gi, '')
    .replace(/&gt;/gi, '')
    .replace(/&(?:ndash|mdash);/gi, '-')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/Ω/g, ' ohms')
    .replace(/<|>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
    .normalize('NFC')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2022]/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/Ω/g, ' ohms')
    .trim();
}

function readableParagraphs(value) {
  const text = plainSupplierText(value);
  if (!text) return '';
  return text
    .split(/\n+/)
    .flatMap((line) => {
      if (line.startsWith('• ') || line.length <= 320) return [line];
      const sentences = line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [line];
      const paragraphs = [];
      for (let index = 0; index < sentences.length; index += 3) {
        paragraphs.push(
          sentences
            .slice(index, index + 3)
            .map((sentence) => sentence.trim())
            .join(' '),
        );
      }
      return paragraphs;
    })
    .filter(Boolean)
    .join('\n\n');
}

function validPackageDimensions(product) {
  const values = [
    Number(product?.altura || 0),
    Number(product?.largura || 0),
    Number(product?.profundidade || 0),
  ];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return false;
  return !(values[0] === 1 && values[1] === 1 && values[2] === 1);
}

function buildRichBatchDescription(item, prepared) {
  const product = item.product || {};
  const sections = [String(product.nome || item.nome || '').trim()];
  const overview = readableParagraphs(item.description || product.descricao);
  if (overview) sections.push(`VISÃO GERAL\n${overview}`);

  const ignoredAttributes = new Set([
    'GTIN',
    'SELLER_SKU',
    'ITEM_CONDITION',
    'PACKAGE_HEIGHT',
    'PACKAGE_WIDTH',
    'PACKAGE_LENGTH',
    'PACKAGE_WEIGHT',
  ]);
  const confirmed = [];
  const seen = new Set();
  for (const attribute of [...(prepared.required || []), ...(prepared.optional || [])]) {
    const id = String(attribute?.id || '').toUpperCase();
    const name = String(attribute?.name || id).trim();
    const value = String(attribute?.value_name || '').trim();
    const valueId = String(attribute?.value_id || '').trim();
    if (
      !id ||
      ignoredAttributes.has(id) ||
      (!value && !valueId) ||
      valueId === '-1' ||
      /^n[aã]o se aplica$/i.test(value)
    ) {
      continue;
    }
    const displayValue = String(
      value ||
      (attribute?.values || []).find(
        (candidate) => String(candidate?.id || '') === valueId,
      )?.name ||
      '',
    ).replace(/Ω/g, 'ohms');
    if (!displayValue) continue;
    const key = `${name.toLowerCase()}:${String(displayValue).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    confirmed.push(`• ${name}: ${displayValue}`);
    if (confirmed.length >= 24) break;
  }
  if (confirmed.length) {
    sections.push(`CARACTERÍSTICAS CONFIRMADAS\n${confirmed.join('\n')}`);
  }

  const identifiers = [];
  if (String(product.marca || '').trim()) {
    identifiers.push(`• Marca: ${String(product.marca).trim()}`);
  }
  if (String(product.gtin || item.preflight?.validatedGtin || '').trim()) {
    identifiers.push(
      `• GTIN: ${String(product.gtin || item.preflight.validatedGtin).trim()}`,
    );
  }
  if (String(product.ncm || item.preflight?.validatedNcm || '').trim()) {
    identifiers.push(
      `• NCM: ${String(product.ncm || item.preflight.validatedNcm).trim()}`,
    );
  }
  if (String(product.sku || item.sku || '').trim()) {
    identifiers.push(`• SKU: ${String(product.sku || item.sku).trim()}`);
  }
  if (identifiers.length) {
    sections.push(`IDENTIFICAÇÃO DO PRODUTO\n${identifiers.join('\n')}`);
  }

  const packageDetails = [];
  if (validPackageDimensions(product)) {
    packageDetails.push(
      `• Dimensões informadas: ${product.altura} × ${product.largura} × ${product.profundidade} cm`,
    );
  }
  if (Number(product.peso_bruto) > 0) {
    packageDetails.push(
      `• Peso bruto informado: ${Number(product.peso_bruto).toLocaleString('pt-BR', {
        maximumFractionDigits: 3,
      })} kg`,
    );
  }
  if (packageDetails.length) {
    sections.push(`EMBALAGEM\n${packageDetails.join('\n')}`);
  }

  // Marker keeps route formatter from wrapping this verified structure again.
  sections.push('Informações confirmadas pelo cadastro do fornecedor e ficha técnica do Mercado Livre.');
  return sections
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/<|>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
    .normalize('NFC')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2022]/g, ' ')
    .trim()
    .slice(0, 5000);
}

function applyLiveEmptyGtinReason(required, optional, product) {
  if (hasText(product?.gtin)) return { required, optional };
  const all = [...(required || []), ...(optional || [])];
  const reasonAttribute = all.find(
    (attribute) => String(attribute?.id || '').toUpperCase() === 'EMPTY_GTIN_REASON',
  );
  if (!reasonAttribute) return { required, optional };
  const isKit = /\b(?:kit|pack|cartela\s+com|\d+\s*(?:un|unidades?))\b/i.test(
    String(product?.nome || ''),
  );
  const allowed = (reasonAttribute.values || []).find((value) => {
    const name = String(value?.name || '');
    return isKit
      ? /kit|pack/i.test(name)
      : /n[aã]o (?:tem|possui).*(?:c[oó]digo|gtin)|sem.*(?:c[oó]digo|gtin)/i.test(name);
  });
  if (!allowed?.id || !allowed?.name) return { required, optional };
  const withoutIdentifiers = (rows) => (rows || []).filter(
    (attribute) => !['GTIN', 'EMPTY_GTIN_REASON'].includes(
      String(attribute?.id || '').toUpperCase(),
    ),
  );
  return {
    required: withoutIdentifiers(required),
    optional: [
      ...withoutIdentifiers(optional),
      {
        ...reasonAttribute,
        value_id: String(allowed.id),
        value_name: String(allowed.name),
      },
    ],
  };
}

async function prepareCategory(produtoId, categoryId, description, product, listingType) {
  const schemaData = await postJson('/api/ml/anuncio/schema', {
    produtoId,
    categoriaId: categoryId,
    listingType,
    strictEvidence: STRICT_EVIDENCE,
  });
  const schema = schemaData?.schema;
  if (!schema) throw new Error('Schema ML ausente');

  if (SKIP_SMART_FILL) {
    let required = fillKnownBatteryAttributes(schema.required_attributes || [], product?.nome || '');
    let optional = schema.optional_attributes || [];
    ({ required, optional } = applyLiveEmptyGtinReason(required, optional, product));
    const missing = missingRequired(required, {
      allowEmptyGtinForKit: ALLOW_EMPTY_GTIN_FOR_KITS,
    });
    return {
      schema,
      smartData: {
        success: true,
        description: schema.prefill?.description || description || '',
      },
      required,
      optional,
      missing,
    };
  }

  const smartData = await postJson('/api/ml/anuncio/preencher-inteligente', {
    produtoId,
    categoriaId: categoryId,
    required_attributes: schema.required_attributes || [],
    optional_attributes: schema.optional_attributes || [],
    description: schema.prefill?.description || description || '',
  });
  if (!smartData?.success) throw new Error(smartData?.error || 'Preenchimento inteligente falhou');

  let required = fillKnownBatteryAttributes(smartData.required_attributes || schema.required_attributes || [], product?.nome || '');
  let optional = smartData.optional_attributes || schema.optional_attributes || [];
  ({ required, optional } = applyLiveEmptyGtinReason(required, optional, product));
  const missing = missingRequired(required, {
    allowEmptyGtinForKit: ALLOW_EMPTY_GTIN_FOR_KITS,
  });
  return { schema, smartData, required, optional, missing };
}

async function createOne(item) {
  let categories = item.categoryId
    ? [{
        id: String(item.categoryId),
        nome: item.catalogEvidence?.categoryName || String(item.categoryId),
        dominio: item.catalogEvidence?.catalogDomainId || '',
      }]
    : [];
  if (categories.length === 0) {
    try {
      const categoriesData = await postJson('/api/ml/anuncio/categorias', { produtoId: item.produtoId });
      categories = (categoriesData?.categorias || []).filter((category) => category?.id).slice(0, 8);
    } catch (error) {
      categories = [];
    }
  }

  if (categories.length === 0) {
    categories = await predictCategoryDirect(item, 8);
  }

  // A unit GTIN can only be reused by this seller in its original ML category.
  // For a simple kit, prefer its component listing category over text prediction.
  const componentCategoryId = await getSimpleKitComponentCategory(item.produtoId);
  if (componentCategoryId) {
    const componentCategory = {
      id: componentCategoryId,
      nome: componentCategoryId,
      dominio: '',
    };
    categories = item.categoryId
      ? [
          ...categories,
          ...(
            categories.some((category) => String(category.id) === componentCategoryId)
              ? []
              : [componentCategory]
          ),
        ]
      : [
          componentCategory,
          ...categories.filter((category) => String(category.id) !== componentCategoryId),
        ];
  }

  if (categories.length === 0) throw new Error('Sem categoria ML prevista');
  if (item.strictFirstCategory === true && !item.categoryId) categories = categories.slice(0, 1);

  let listingType = null;

  const attempts = [];
  let prepared = null;
  for (const category of categories) {
    try {
      const currentListingType = await chooseListingType(
        item.product || {},
        category.id,
        String(item.listingType || 'auto'),
      );
      const current = await prepareCategory(
        item.produtoId,
        category.id,
        item.description || '',
        item.product || {},
        currentListingType,
      );
      current.required = applyAttributeOverrides(current.required, item.attributeOverrides);
      // Exact GTIN catalog matches are strong evidence for category and required
      // fields, but optional catalog specs can still contain seller-generated errors.
      // Keep optional values sourced from the local/DSLite product preparation.
      if (item.preflight?.trustedOptionalAttributeOverrides === true) {
        current.optional = applyAttributeOverrides(current.optional, item.attributeOverrides);
      }
      if (item.preflight?.omitComponentGtin === true) {
        current.required = (current.required || []).filter(
          (attribute) => String(attribute?.id || '').toUpperCase() !== 'GTIN',
        );
        current.optional = applyKitIdentifierPolicy(current.optional, item);
      }
      if (item.preflight?.omitGtin === true) {
        current.required = (current.required || []).filter(
          (attribute) => String(attribute?.id || '').toUpperCase() !== 'GTIN',
        );
        current.optional = applyExplicitEmptyIdentifierPolicy(current.optional, item);
      }
      current.missing = missingRequired(current.required, {
        allowEmptyGtinForKit: ALLOW_EMPTY_GTIN_FOR_KITS,
      });
      attempts.push({ category: { id: category.id, nome: category.nome }, missing: current.missing.map((attr) => attr.name || attr.id) });
      if (current.missing.length === 0) {
        listingType = currentListingType;
        prepared = { category, ...current };
        break;
      }
    } catch (error) {
      attempts.push({ category: { id: category.id, nome: category.nome }, error: error.message });
    }
  }

  if (!prepared) {
    const first = attempts.find((attempt) => attempt.missing?.length) || attempts[0];
    const error = new Error(first?.missing?.length ? `Atributos obrigatórios pendentes: ${first.missing.join(', ')}` : first?.error || 'Nenhuma categoria ML válida encontrada');
    error.attempts = attempts;
    throw error;
  }
  if (!listingType) throw new Error('Tipo de anúncio não definido');

  const pricing = item.pricingMode === 'profitable_shelf_2'
    ? await profitableShelfPricing(item.product || {}, prepared.category.id, listingType)
    : item.pricingMode === 'target_net_profit'
      ? {
          mode: 'target_net_profit',
          targetNetProfit: Number(item.targetNetProfit),
          price: Number(item.customPrice || 0),
        }
      : null;

  if (DRY_RUN) {
    return {
      dryRun: true,
      produtoId: item.produtoId,
      sku: item.sku,
      category: { id: prepared.category.id, nome: prepared.category.nome, dominio: prepared.category.dominio },
      basePrice: prepared.schema.prefill?.base_price ?? null,
      familyName: item.familyName || null,
      listingType,
      pricing,
      missing: prepared.missing,
      attributes: [...prepared.required, ...prepared.optional]
        .filter((attribute) => hasText(attribute.value_id) || hasText(attribute.value_name))
        .map((attribute) => ({
          id: attribute.id,
          name: attribute.name || attribute.id,
          value_id: attribute.value_id || '',
          value_name: attribute.value_name || '',
        })),
      saleTerms: (prepared.schema.sale_terms || [])
        .filter((term) => hasText(term.value_id) || hasText(term.value_name))
        .map((term) => ({
          id: term.id,
          value_id: term.value_id || '',
          value_name: term.value_name || '',
        })),
      description: buildRichBatchDescription(item, prepared),
    };
  }

  const created = await postJson('/api/ml/anuncio/criar', {
    produtoId: item.produtoId,
    categoriaId: prepared.category.id,
    listingType,
    basePrice: Number(item.customPrice || 0) > 0
      ? Number(item.customPrice)
      : pricing?.price ?? prepared.schema.prefill?.base_price,
    pricingMode: item.pricingMode || undefined,
    targetNetProfit: item.pricingMode === 'target_net_profit'
      ? Number(item.targetNetProfit)
      : undefined,
    familyName: item.familyName || undefined,
    fiscal: prepared.schema.fiscal_fields,
    description: buildRichBatchDescription(item, prepared),
    attributes: [...prepared.required, ...prepared.optional].map((attr) => ({
      id: attr.id,
      value_id: attr.value_id || '',
      value_name: attr.value_name || '',
    })),
    sale_terms: (prepared.schema.sale_terms || []).map((term) => ({
      id: term.id,
      value_id: term.value_id || '',
      value_name: term.value_name || '',
    })),
    allowOutOfStockListing: ALLOW_OUT_OF_STOCK,
  });

  if (!created?.success) {
    const error = new Error(created?.error || 'Criação retornou sem sucesso');
    error.data = created;
    throw error;
  }

  return {
    dryRun: false,
    produtoId: item.produtoId,
    sku: item.sku,
    category: { id: prepared.category.id, nome: prepared.category.nome, dominio: prepared.category.dominio },
    anuncio: created.anuncio,
    linked_existing: Boolean(created.linked_existing),
    warnings: created.warnings || [],
    pricing: created.pricing_policy || pricing,
  };
}

(async () => {
  const pricingTax = await loadPricingTaxRate(supabase);
  pricingTaxRate = pricingTax.taxRate;
  const manifest = JSON.parse(fs.readFileSync(path.resolve(MANIFEST_PATH), 'utf8'));
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const result = {
    manifest: path.resolve(MANIFEST_PATH),
    baseUrl: BASE_URL,
    dryRun: DRY_RUN,
    batchId: manifest.batchId || null,
    selected: items.length,
    created: [],
    failed: [],
  };
  let consecutiveFailures = 0;

  for (const item of items) {
    try {
      const { data: produto } = await supabase.from('produtos').select('*').eq('id', item.produtoId).single();
      const payload = await createOne({
        ...item,
        product: produto || null,
        nome: produto?.nome || item.nome,
        marca: produto?.marca || '',
        description: item.description || produto?.descricao || '',
      });
      result.created.push(payload);
      consecutiveFailures = 0;
      console.log(`[ok] ${item.sku} ${payload.anuncio?.id || payload.category?.id || ''}`);
    } catch (error) {
      result.failed.push({
        produtoId: item.produtoId,
        sku: item.sku,
        nome: item.nome,
        error: error.message,
        status: error.status || null,
        attempts: error.attempts || null,
        data: error.data || null,
      });
      consecutiveFailures += 1;
      console.log(`[fail] ${item.sku} ${error.message}`);
    }
    if (
      !DRY_RUN &&
      STOP_AFTER_CONSECUTIVE_FAILURES > 0 &&
      consecutiveFailures >= STOP_AFTER_CONSECUTIVE_FAILURES
    ) {
      console.log(`[stop] consecutive_failures=${consecutiveFailures}`);
      break;
    }
    await sleep(DELAY_MS);
  }

  if (RESULT_FILE) {
    fs.mkdirSync(path.dirname(path.resolve(RESULT_FILE)), { recursive: true });
    fs.writeFileSync(path.resolve(RESULT_FILE), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length > Math.max(3, Math.ceil(items.length * 0.5))) process.exitCode = 2;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
