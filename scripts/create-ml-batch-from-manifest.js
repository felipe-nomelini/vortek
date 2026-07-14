const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const MANIFEST_PATH = process.env.ML_BATCH_MANIFEST;
const BASE_URL = process.env.BATCH_API_URL || 'http://localhost:3000';
const DELAY_MS = Number(process.env.BATCH_DELAY_MS || '1500');
const REQUEST_TIMEOUT_MS = Number(process.env.BATCH_REQUEST_TIMEOUT_MS || '45000');
const DRY_RUN = process.env.DRY_RUN === '1';
const RESULT_FILE = process.env.ML_BATCH_RESULT_FILE || '';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasText(value) {
  return String(value || '').trim().length > 0;
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

function missingRequired(attrs) {
  return (attrs || []).filter((attr) => !hasText(attr.value_id) && !hasText(attr.value_name));
}

async function prepareCategory(produtoId, categoryId, description) {
  const schemaData = await postJson('/api/ml/anuncio/schema', {
    produtoId,
    categoriaId: categoryId,
    listingType: 'gold_pro',
  });
  const schema = schemaData?.schema;
  if (!schema) throw new Error('Schema ML ausente');

  const smartData = await postJson('/api/ml/anuncio/preencher-inteligente', {
    produtoId,
    categoriaId: categoryId,
    required_attributes: schema.required_attributes || [],
    optional_attributes: schema.optional_attributes || [],
    description: schema.prefill?.description || description || '',
  });
  if (!smartData?.success) throw new Error(smartData?.error || 'Preenchimento inteligente falhou');

  const required = smartData.required_attributes || schema.required_attributes || [];
  const optional = smartData.optional_attributes || schema.optional_attributes || [];
  const missing = missingRequired(required);
  return { schema, smartData, required, optional, missing };
}

async function createOne(item) {
  let categories = [];
  try {
    const categoriesData = await postJson('/api/ml/anuncio/categorias', { produtoId: item.produtoId });
    categories = (categoriesData?.categorias || []).filter((category) => category?.id).slice(0, 8);
  } catch (error) {
    categories = [];
  }

  if (categories.length === 0) {
    categories = await predictCategoryDirect(item, 8);
  }

  if (categories.length === 0) throw new Error('Sem categoria ML prevista');

  const attempts = [];
  let prepared = null;
  for (const category of categories) {
    try {
      const current = await prepareCategory(item.produtoId, category.id, item.description || '');
      attempts.push({ category: { id: category.id, nome: category.nome }, missing: current.missing.map((attr) => attr.name || attr.id) });
      if (current.missing.length === 0) {
        prepared = { category, ...current };
        break;
      }
      if (current.missing.length > 0) break;
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

  if (DRY_RUN) {
    return {
      dryRun: true,
      produtoId: item.produtoId,
      sku: item.sku,
      category: { id: prepared.category.id, nome: prepared.category.nome, dominio: prepared.category.dominio },
      basePrice: prepared.schema.prefill?.base_price ?? null,
      missing: prepared.missing,
    };
  }

  const created = await postJson('/api/ml/anuncio/criar', {
    produtoId: item.produtoId,
    categoriaId: prepared.category.id,
    listingType: 'gold_pro',
    basePrice: prepared.schema.prefill?.base_price,
    fiscal: prepared.schema.fiscal_fields,
    description: prepared.smartData.description || prepared.schema.prefill?.description || item.description || '',
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
  };
}

(async () => {
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

  for (const item of items) {
    try {
      const { data: produto } = await supabase.from('produtos').select('id, nome, marca, descricao').eq('id', item.produtoId).single();
      const payload = await createOne({ ...item, nome: produto?.nome || item.nome, marca: produto?.marca || '', description: produto?.descricao || '' });
      result.created.push(payload);
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
      console.log(`[fail] ${item.sku} ${error.message}`);
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
