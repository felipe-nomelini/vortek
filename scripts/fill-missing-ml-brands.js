const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const REPORT_ROOT = path.join(process.cwd(), 'reports', 'ml-brand-fill');
const CONCURRENCY = Number(process.env.ML_BRAND_FILL_CONCURRENCY || '3');
const MIN_CONFIDENCE = Number(process.env.ML_BRAND_FILL_MIN_CONFIDENCE || '0.78');
const LIMIT = Number(process.env.ML_BRAND_FILL_LIMIT || '0');

if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY missing');
if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing');

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function hasText(v) { return String(v || '').trim().length > 0; }
function compactText(v, max = 1200) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function normalizeBrand(v) { return String(v || '').trim().replace(/\s+/g, ' ').toUpperCase(); }
function normalizeHost(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function isMarketplaceHost(host) {
  return ['mercadolivre.com.br', 'mercadolibre.com', 'shopee.com.br', 'amazon.com.br', 'magazineluiza.com.br', 'americanas.com.br'].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}
function isTrustedHost(host, brand) {
  if (!host) return false;
  const brandToken = String(brand || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hostToken = host.replace(/[^a-z0-9]/g, '');
  if (brandToken && hostToken.includes(brandToken)) return true;
  return !isMarketplaceHost(host);
}
function buildQuery(produto) {
  const parts = [produto.nome, produto.gtin, produto.dslite_produto_id, 'marca fabricante ficha técnica especificações'].filter(Boolean);
  return `${parts.join(' ')} -site:mercadolivre.com.br -site:mercadolibre.com -site:shopee.com.br`.slice(0, 500);
}
async function searchWeb(produto) {
  const response = await fetch('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: buildQuery(produto),
      limit: 4,
      scrapeOptions: {
        formats: [{ type: 'markdown' }],
        onlyMainContent: true,
        timeout: 8000,
      },
    }),
  });
  if (!response.ok) return { searched: true, rows: [] };
  const payload = await response.json().catch(() => ({}));
  const rows = [
    ...(Array.isArray(payload?.data?.web) ? payload.data.web : []),
    ...(Array.isArray(payload?.web) ? payload.web : []),
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.results) ? payload.results : []),
  ]
    .map((row) => {
      const url = String(row?.url || row?.metadata?.sourceURL || row?.metadata?.url || '').trim();
      const host = normalizeHost(url);
      return {
        url,
        host,
        trusted: isTrustedHost(host, produto.marca),
        title: compactText(row?.title || row?.metadata?.title || '', 180),
        content: compactText([row?.description, row?.metadata?.description, row?.markdown, row?.content, row?.summary].filter(Boolean).join('\n'), 1800),
      };
    })
    .filter((row) => row.url && (row.title || row.content))
    .sort((a, b) => Number(b.trusted) - Number(a.trusted))
    .slice(0, 4);
  return { searched: true, rows };
}
function safeJsonParseLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const firstBrace = String(text).indexOf('{');
  const lastBrace = String(text).lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = String(text).slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return null;
}

async function askBrand(produto, research) {
  const prompt = [
    'Você identifica a marca correta de um produto para cadastro no Mercado Livre.',
    'Responda APENAS JSON válido no formato:',
    '{"brand":"<MARCA>|null","confidence":0.0,"reason":"...","evidence":"...","source_urls":["..."]}',
    'Regras:',
    '- Use somente marca com evidência confiável.',
    '- Prefira fabricante oficial, distribuidor oficial, ficha técnica oficial, manual, página do produto.',
    '- Se não houver evidência, retorne brand:null.',
    '- Não invente marca pela aparência do nome.',
    '- Marca deve vir curta, limpa, sem modelo.',
    `Produto: ${JSON.stringify({ sku: produto.sku, nome: produto.nome, gtin: produto.gtin, dslite_produto_id: produto.dslite_produto_id, categoria: produto.categoria, descricao: compactText(produto.descricao, 1200) })}`,
    `Pesquisa web: ${JSON.stringify({ searched: research.searched, rows: research.rows.map((row) => ({ url: row.url, trusted: row.trusted, title: row.title, content: row.content })) })}`,
  ].join('\n');

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'Responda somente JSON válido.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${txt.slice(0, 300)}`);
  }

  const payload = await response.json().catch(() => ({}));
  const content = payload?.choices?.[0]?.message?.content || '';
  const parsed = safeJsonParseLoose(content);
  if (!parsed || typeof parsed !== 'object') throw new Error('Resposta IA inválida');
  return parsed;
}

async function loadTargets() {
  const { data, error } = await supabase
    .from('produtos')
    .select('id, sku, nome, gtin, descricao, categoria, dslite_produto_id, marca, estoque, custo, ml_status, ml_item_id, ativo')
    .eq('ativo', true)
    .eq('ml_status', 'sem_anuncio')
    .gt('estoque', 0)
    .is('ml_item_id', null)
    .or('marca.is.null,marca.eq.')
    .order('sku', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data || [];
  return LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

async function processOne(produto) {
  const research = await searchWeb(produto);
  const ai = await askBrand(produto, research);
  const brand = normalizeBrand(ai.brand);
  const confidence = Number(ai.confidence || 0);
  const sourceUrls = Array.isArray(ai.source_urls) ? ai.source_urls.slice(0, 4).map(String) : research.rows.map((row) => row.url).slice(0, 4);
  const evidence = compactText(ai.evidence || '', 500);
  const trustedSources = research.rows.filter((row) => row.trusted).length;

  if (!brand || brand === 'NULL' || confidence < MIN_CONFIDENCE || trustedSources === 0) {
    return {
      ok: false,
      produtoId: produto.id,
      sku: produto.sku,
      nome: produto.nome,
      brand: brand || null,
      confidence,
      trustedSources,
      reason: ai.reason || 'insufficient_evidence',
      evidence,
      sourceUrls,
    };
  }

  const { error } = await supabase
    .from('produtos')
    .update({ marca: brand, updated_at: new Date().toISOString() })
    .eq('id', produto.id);
  if (error) throw new Error(error.message);

  return {
    ok: true,
    produtoId: produto.id,
    sku: produto.sku,
    nome: produto.nome,
    brand,
    confidence,
    trustedSources,
    reason: ai.reason || 'web_research',
    evidence,
    sourceUrls,
  };
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let index = 0;
  async function next() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      const item = items[currentIndex];
      try {
        results[currentIndex] = await worker(item, currentIndex);
      } catch (error) {
        results[currentIndex] = { ok: false, produtoId: item.id, sku: item.sku, nome: item.nome, reason: 'exception', error: error.message };
      }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_ROOT, stamp);
  fs.mkdirSync(reportDir, { recursive: true });

  const targets = await loadTargets();
  console.log(`[start] targets=${targets.length} concurrency=${CONCURRENCY}`);

  const results = await runPool(targets, async (produto, idx) => {
    const out = await processOne(produto);
    console.log(`${out.ok ? '[ok]' : '[skip]'} ${idx + 1}/${targets.length} ${produto.sku} ${out.brand || out.reason || ''}`);
    return out;
  }, CONCURRENCY);

  const updated = results.filter((row) => row?.ok);
  const skipped = results.filter((row) => row && !row.ok);

  const { count: stillMissingBrand, error: countError } = await supabase
    .from('produtos')
    .select('*', { count: 'exact', head: true })
    .eq('ativo', true)
    .eq('ml_status', 'sem_anuncio')
    .gt('estoque', 0)
    .is('ml_item_id', null)
    .or('marca.is.null,marca.eq.');
  if (countError) throw new Error(countError.message);

  const summary = {
    generatedAt: new Date().toISOString(),
    targets: targets.length,
    updated: updated.length,
    skipped: skipped.length,
    stillMissingBrand,
    minConfidence: MIN_CONFIDENCE,
    concurrency: CONCURRENCY,
    limit: LIMIT,
    reportDir,
  };

  fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportDir, 'updated.json'), JSON.stringify(updated, null, 2));
  fs.writeFileSync(path.join(reportDir, 'skipped.json'), JSON.stringify(skipped, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})();
