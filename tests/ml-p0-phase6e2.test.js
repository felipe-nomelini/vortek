'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED,
  freezeSelection,
  loadAuthorizedAlternatives,
  pathsEqual,
  postSemanticValidation,
  semanticGatePasses,
} = require('../scripts/lib/ml-p0-phase6e2');

test('authorization source contains exactly seven immutable alternatives', () => {
  const source = loadAuthorizedAlternatives();
  assert.equal(source.selected.length, 7);
  assert.equal(new Set(source.selected.map((row) => row.sku)).size, 7);
  assert.deepEqual(source.selected.map((row) => row.sku), ALLOWED.map((row) => row.sku));
  assert.equal(source.selected.some((row) => ['VTK017508', 'VTK012864'].includes(row.sku)), false);
});

test('selected-7 freeze is derived from Phase 6E.1 source and preserves order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6e2-'));
  try {
    const info = freezeSelection(dir);
    const rows = fs.readFileSync(path.join(dir, 'selected-7.csv'), 'utf8').trim().split(/\n/);
    assert.equal(rows.length, 8);
    assert.equal(info.count, 7);
    assert.equal(info.order_preserved, true);
    assert.equal(info.substitutions, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('semantic write gate rejects Phase 6E.1 score 93 despite second-pass PASS', () => {
  assert.equal(semanticGatePasses({ independentSource: true, identityConfidence: 100, score: 93, hardMismatch: false, secondPassVerdict: 'PASS', pathMatch: true, domainMatch: true }), false);
});

test('semantic write gate requires all independent checks', () => {
  assert.equal(semanticGatePasses({ independentSource: true, identityConfidence: 100, score: 100, hardMismatch: false, secondPassVerdict: 'PASS', pathMatch: true, domainMatch: true }), true);
  assert.equal(semanticGatePasses({ independentSource: true, identityConfidence: 100, score: 100, hardMismatch: false, secondPassVerdict: 'PASS', pathMatch: false, domainMatch: true }), false);
  assert.equal(semanticGatePasses({ independentSource: false, identityConfidence: 100, score: 100, hardMismatch: false, secondPassVerdict: 'PASS', pathMatch: true, domainMatch: true }), false);
});

test('full category path comparison rejects same leaf under different tree', () => {
  assert.equal(pathsEqual(['Acessórios para Veículos', 'Som Automotivo', 'Antenas'], ['Agro', 'Carroceria', 'Antenas']), false);
  assert.equal(pathsEqual(['Instrumentos Musicais', 'Guitarras', 'Elétricas'], ['Instrumentos Musicais', 'Guitarras', 'Elétricas']), true);
});

test('post-readback semantic gate validates full remote tree, not leaf alone', async () => {
  const config = {
    requestedName: 'Guitarra Giannini G100 Vermelha',
    supplierEvidence: { supplier_category: 'Instrumentos Musicais / Guitarras' },
    categoryId: 'MLB438516',
    domainId: 'MLB-ELECTRIC_GUITARS',
    catalogProductId: null,
    catalogEvidence: {
      id: 'MLBTEST', domain_id: 'MLB-ELECTRIC_GUITARS', name: 'Guitarra Giannini G100',
      attributes: [{ id: 'GTIN', value_name: '7890443014381' }],
    },
    semanticAlternative: {
      category_path: ['Instrumentos Musicais', 'Instrumentos de Corda', 'Guitarras', 'Elétricas'],
    },
    semanticRecheck: { assessment: { score: 100 } },
  };
  const item = { category_id: 'MLB438516', catalog_product_id: null };
  const correct = await postSemanticValidation({
    config,
    item,
    ml: async () => ({ ok: true, status: 200, data: {
      id: 'MLB438516', name: 'Elétricas', settings: { catalog_domain: 'MLB-ELECTRIC_GUITARS' },
      path_from_root: config.semanticAlternative.category_path.map((name) => ({ name })),
    } }),
  });
  assert.equal(correct.passed, true);

  const wrong = await postSemanticValidation({
    config,
    item,
    ml: async () => ({ ok: true, status: 200, data: {
      id: 'MLB438516', name: 'Elétricas', settings: { catalog_domain: 'MLB-ELECTRIC_GUITARS' },
      path_from_root: ['Brinquedos', 'Guitarras', 'Elétricas'].map((name) => ({ name })),
    } }),
  });
  assert.equal(wrong.passed, false);
});

test('post-readback preserves pre-POST score across exact catalog projection drift', async () => {
  const categoryPath = ['Instrumentos Musicais', 'Instrumentos de Corda', 'Guitarras', 'Elétricas'];
  const config = {
    requestedName: 'Guitarra Giannini G100 Vermelha Com Escudo Branco',
    supplierEvidence: { supplier_category: 'Instrumentos Musicais / Cordas / Guitarras' },
    categoryId: 'MLB438516',
    domainId: 'MLB-ELECTRIC_GUITARS',
    catalogProductId: 'MLB17460878',
    semanticAlternative: { category_path: categoryPath },
    semanticRecheck: { assessment: { score: 100 } },
  };
  const responses = {
    '/categories/MLB438516': {
      id: 'MLB438516', name: 'Elétricas', settings: { catalog_domain: 'MLB-ELECTRIC_GUITARS' },
      path_from_root: categoryPath.map((name) => ({ name })),
    },
    '/products/MLB17460878': {
      id: 'MLB17460878', name: 'Guitarra Elétrica Giannini Standard G-100',
      domain_id: 'MLB-ELECTRIC_GUITARS', attributes: [],
    },
  };
  const result = await postSemanticValidation({
    config,
    item: { category_id: 'MLB438516', catalog_product_id: 'MLB17460878' },
    ml: async (resource) => ({ ok: true, status: 200, data: responses[resource] }),
  });

  assert.equal(result.semantic_score, 93);
  assert.equal(result.pre_semantic_score, 100);
  assert.equal(result.effective_semantic_score, 100);
  assert.equal(result.exact_remote_classification, true);
  assert.equal(result.passed, true);
});
