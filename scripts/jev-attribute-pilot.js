#!/usr/bin/env node
// Piloto interno: somente SELECT no Bentevi, GET no Mercado Livre e POST de avaliação na TypeSafe.
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  MODEL, MAX_CASES, buildState, callJev, eligibleAttribute, loadBaseline,
  makeQuestion, parseChoice, selectCases,
} = require('./jev-attribute-pilot-lib');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

const PREPARE_ONLY = process.argv.includes('--prepare');
const REPORT_ROOT = path.resolve(__dirname, '..', 'reports', 'jev-attributes');

function serviceUrl() {
  const raw = process.env.SUPABASE_SERVICE_URL;
  if (!raw || new URL(raw).hostname !== '192.168.1.162') {
    throw new Error('SUPABASE_SERVICE_URL deve apontar diretamente para o Bentevi .162');
  }
  return raw;
}

async function mlGet(pathname) {
  const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
    method: 'GET', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Mercado Livre HTTP ${response.status}`);
  return response.json();
}

async function readRows(client, table, columns, configure) {
  const query = configure(client.from(table).select(columns));
  const { data, error } = await query;
  if (error) throw new Error(`Leitura ${table} indisponível: ${error.message}`);
  return data || [];
}

async function loadInputs(client, baseline) {
  const snapshots = await readRows(client, 'catalogo_ml_snapshot',
    'produto_id,category_id,synced_at', (query) => query
      .not('produto_id', 'is', null).not('category_id', 'is', null)
      .order('synced_at', { ascending: false }).limit(300));
  const selected = [];
  const byCategory = new Map();
  const seenProducts = new Set();
  for (const row of snapshots) {
    if (!/^MLB\d+$/.test(String(row.category_id || '')) || !row.produto_id
      || seenProducts.has(row.produto_id)) continue;
    const count = byCategory.get(row.category_id) || 0;
    if (count >= 3) continue;
    selected.push(row);
    seenProducts.add(row.produto_id);
    byCategory.set(row.category_id, count + 1);
    if (selected.length >= 45) break;
  }
  if (!selected.length) throw new Error('Sem produtos e categorias no snapshot');
  const ids = selected.map((row) => row.produto_id);
  const [products, offers, suppliers] = await Promise.all([
    readRows(client, 'produtos', 'id,nome,marca,descricao,categoria',
      (query) => query.in('id', ids)),
    readRows(client, 'produto_fornecedor_ofertas',
      'produto_id,dslite_fornecedor_id,nome,marca,descricao,ativo',
      (query) => query.in('produto_id', ids).eq('ativo', true).limit(500)),
    readRows(client, 'fornecedores',
      'dslite_id,ativo,status_dslite,dropshipping,dropshipping_retired_at',
      (query) => query.eq('ativo', true).is('dropshipping_retired_at', null)),
  ]);
  const productById = new Map(products.map((row) => [row.id, row]));
  const operational = new Set(suppliers
    .filter(baseline.isOperationalDropshippingSupplier)
    .map((row) => String(row.dslite_id)));
  const offerByProduct = new Map();
  for (const offer of offers) {
    if (!operational.has(String(offer.dslite_fornecedor_id))) continue;
    const group = offerByProduct.get(offer.produto_id) || [];
    group.push(offer);
    offerByProduct.set(offer.produto_id, group);
  }
  return selected.map((row) => ({
    categoryId: row.category_id,
    productId: row.produto_id,
    product: productById.get(row.produto_id),
    offers: (offerByProduct.get(row.produto_id) || []).slice(0, 5),
  })).filter((row) => row.product?.nome);
}

function supplierEvidence(offers) {
  return offers.map((row) => [row.nome, row.marca, row.descricao]
    .filter(Boolean).join(' ')).filter(Boolean).join('\n').slice(0, 2500);
}

async function gatherCases(inputs, baseline) {
  const categoryCache = new Map();
  const candidates = [];
  const issues = [];
  for (const input of inputs) {
    try {
      let definitions = categoryCache.get(input.categoryId);
      if (!definitions) {
        definitions = await mlGet(`/categories/${input.categoryId}/attributes`);
        if (!Array.isArray(definitions)) throw new Error('Atributos oficiais inválidos');
        categoryCache.set(input.categoryId, definitions);
      }
      const state = buildState(input.product, supplierEvidence(input.offers));
      if (!state.product.name) continue;
      const productForBaseline = {
        ...input.product,
        nome: state.product.name,
        marca: state.product.brand,
        descricao: [state.product.description, state.supplier_evidence].filter(Boolean).join(' '),
      };
      const facts = baseline.extractMlProductFacts(productForBaseline);
      const prediction = await baseline.getPredictionMap(input.categoryId, productForBaseline);
      for (const definition of definitions) {
        if (!eligibleAttribute(definition, baseline.isMlCriticalAttributeId)) continue;
        const attribute = baseline.mergeCategoryDefinition(
          { id: definition.id, name: definition.name, value_type: definition.value_type },
          new Map([[String(definition.id).toUpperCase(), definition]]),
        );
        const current = baseline.fillAttribute(attribute, facts, prediction, productForBaseline);
        candidates.push({ productId: input.productId, categoryId: input.categoryId,
          attributeId: attribute.id, attributeName: attribute.name,
          attribute, current: {
            id: current.value_id || null, name: current.value_name || null,
            source: current.source || null,
          }, state });
      }
    } catch (error) {
      issues.push({ productId: input.productId, categoryId: input.categoryId,
        reason: String(error.message || error) });
    }
  }
  return { cases: selectCases(candidates, MAX_CASES), issues,
    inspectedProducts: inputs.length, inspectedCategories: categoryCache.size };
}

function reportPath() {
  fs.mkdirSync(REPORT_ROOT, { recursive: true });
  return path.join(REPORT_ROOT, `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
}

async function run() {
  const url = serviceUrl();
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!PREPARE_ONLY && !apiKey) throw new Error('TYPESAFE_API_KEY ausente no ambiente privado');
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const predictionFailures = [];
  const baseline = loadBaseline(async (title, limit) => {
    try {
      return await mlGet(`/sites/MLB/domain_discovery/search?q=${encodeURIComponent(title)}&limit=${limit}`);
    } catch (error) {
      predictionFailures.push(String(error.message || error));
      throw error;
    }
  });
  const inputs = await loadInputs(client, baseline);
  const gathered = await gatherCases(inputs, baseline);
  if (!gathered.cases.length) throw new Error('Nenhum atributo elegível para comparar');
  const report = {
    mode: PREPARE_ONLY ? 'prepared' : 'comparison',
    createdAt: new Date().toISOString(), target: 'Bentevi .162 (somente leitura)',
    model: MODEL, selection: { maxCases: MAX_CASES,
      inspectedProducts: gathered.inspectedProducts,
      inspectedCategories: gathered.inspectedCategories,
      selectedCases: gathered.cases.length },
    limits: ['Concordância não prova acerto.', 'Precisão depende de revisão humana das evidências.',
      'Amostra restrita a atributos listados e não críticos.',
      'Confiança é apenas um filtro provisório, sem calibração para este catálogo.'],
    predictionFailures: predictionFailures.length,
    issues: gathered.issues, results: [],
  };
  const groups = new Map();
  for (const row of gathered.cases) {
    const key = `${row.productId}:${row.categoryId}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  for (const rows of groups.values()) {
    const state = rows[0].state;
    const prepared = rows.map((row) => makeQuestion(row.attribute));
    const questions = Object.fromEntries(prepared.map((item, index) => [`q${index}`, item.question]));
    let evaluation = null;
    let failure = null;
    if (!PREPARE_ONLY) {
      try {
        evaluation = await callJev(state, questions, apiKey);
      } catch (error) {
        failure = String(error.message || error);
        if (/TypeSafe HTTP (401|402|403)/.test(failure)) throw new Error(failure);
      }
    }
    rows.forEach((row, index) => {
      let answer = null;
      let status = PREPARE_ONLY ? 'not_run' : 'inconclusive';
      let error = failure;
      if (evaluation) {
        try {
          answer = parseChoice(evaluation.payload, `q${index}`, prepared[index].values);
          status = answer.status;
        } catch (cause) {
          error = String(cause.message || cause);
        }
      }
      const choice = answer?.choice || null;
      const currentId = row.current.id || null;
      const agreement = status === 'evaluated'
        ? (currentId === (choice?.id || null) ? 'agree' : 'disagree') : 'undetermined';
      report.results.push({ productId: row.productId, categoryId: row.categoryId,
        attributeId: row.attributeId, attributeName: row.attributeName,
        current: row.current,
        jev: { status, choice, confidence: answer?.confidence ?? null,
          probabilities: answer?.probabilities || null },
        agreement, correctness: 'not_adjudicated',
        evidence: { productName: state.product.name,
          productDescriptionExcerpt: state.product.description.slice(0, 200),
          supplierExcerpt: state.supplier_evidence.slice(0, 200) },
        request: evaluation ? { elapsedMs: evaluation.elapsedMs,
          inputTokens: evaluation.inputTokens,
          estimatedUsd: evaluation.estimatedUsd / rows.length } : null,
        error });
    });
    if (!PREPARE_ONLY) console.log(`Avaliados ${report.results.length}/${gathered.cases.length} casos`);
  }
  const requestCount = PREPARE_ONLY ? 0 : [...groups.values()].length;
  report.summary = {
    requests: requestCount,
    evaluated: report.results.filter((row) => row.jev.status === 'evaluated').length,
    inconclusive: report.results.filter((row) => row.jev.status === 'inconclusive').length,
    agreement: report.results.filter((row) => row.agreement === 'agree').length,
    disagreement: report.results.filter((row) => row.agreement === 'disagree').length,
    estimatedUsd: report.results.reduce((sum, row) => sum + (row.request?.estimatedUsd || 0), 0),
  };
  const output = reportPath();
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output, selection: report.selection, summary: report.summary }));
}

run().catch((error) => {
  console.error(`Piloto Jev: ${String(error.message || error)}`);
  process.exitCode = 1;
});
