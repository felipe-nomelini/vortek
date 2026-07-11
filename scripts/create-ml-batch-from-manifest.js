const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const MANIFEST_PATH = process.env.ML_BATCH_MANIFEST;
const BASE_URL = process.env.BATCH_API_URL || 'http://localhost:3000';
const DELAY_MS = Number(process.env.BATCH_DELAY_MS || '1500');
const DRY_RUN = process.env.DRY_RUN === '1';
const RESULT_FILE = process.env.ML_BATCH_RESULT_FILE || '';
const LOGIN_EMAIL = process.env.BATCH_LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.BATCH_LOGIN_PASSWORD || '';
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

async function ensureAuthCookie() {
  if (authCookie) return authCookie;
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) return '';
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, senha: LOGIN_PASSWORD }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha login batch HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const cookies = response.headers.getSetCookie().map((row) => row.split(';')[0]).filter(Boolean);
  authCookie = cookies.join('; ');
  return authCookie;
}

async function postJson(apiPath, body) {
  const headers = {
    'Content-Type': 'application/json',
    'x-local-dev-batch': 'true',
  };
  if (process.env.API_SECRET_KEY) headers['x-api-key'] = process.env.API_SECRET_KEY;
  const cookie = await ensureAuthCookie();
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data?.error || data?.erro || data?.message || text || `HTTP ${response.status}`);
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
  const categoriesData = await postJson('/api/ml/anuncio/categorias', { produtoId: item.produtoId });
  const categories = (categoriesData?.categorias || []).filter((category) => category?.id).slice(0, 8);
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
      const { data: produto } = await supabase.from('produtos').select('id, descricao').eq('id', item.produtoId).single();
      const payload = await createOne({ ...item, description: produto?.descricao || '' });
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
