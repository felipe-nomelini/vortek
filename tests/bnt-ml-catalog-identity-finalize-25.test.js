const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const task = require('../scripts/catalog-identity-p0-finalize-25.js');

test('escopo fecha exatamente 7 casos anteriores e 18 novos', () => {
  assert.equal(task.CASES.length, 25);
  assert.equal(task.NEW_CASES.length, 18);
  assert.equal(new Set(task.CASES.map(row => row.sku)).size, 25);
  assert.equal(new Set(task.CASES.map(row => row.ml_item_id)).size, 25);
  assert.deepEqual(task.EXPECTED_BEFORE, { SEM_CONFLITO: 1501, CONFLITO_CONFIRMADO: 22, PENDENCIA_VALIDACAO: 27, INCONCLUSIVO: 0 });
  assert.deepEqual(task.EXPECTED_AFTER, { SEM_CONFLITO: 1526, CONFLITO_CONFIRMADO: 22, PENDENCIA_VALIDACAO: 2, INCONCLUSIVO: 0 });
});

test('VTK000303 mantém revisão editorial sem bloquear a decisão de identidade', () => {
  const row = task.CASES.find(entry => entry.sku === 'VTK000303');
  assert.equal(row.content_quality_flag, 'TITLE_REVIEW_REQUIRED');
  assert.equal(row.catalog_product_id, 'MLB60101636');
  assert.equal(row.gtin, '7898461965487');
});

test('manifesto detecta qualquer alteração material nas decisões', () => {
  const base = { version: 'v', run_id: 'r', generated_at: 'a', expires_at: 'b', seller_id: 1,
    actor: { id: 'x' }, universe_sha256: 'u', decisions: [{ sku: 'S', ml_item_id: 'M', produto_id: 'P',
      catalog_product_id: 'C', standard_item_id: null, identity_state: 'SEM_CONFLITO', reason_code: 'R',
      material_fingerprint: 'f', command_id: 'c', local_listing_price: 1, produtos_ativo: true,
      produtos_estoque: 2, produtos_custom_price: 1, content_quality_flag: null }] };
  const changed = structuredClone(base);
  changed.decisions[0].catalog_product_id = 'OUTRO';
  assert.notEqual(task.manifestHash(base), task.manifestHash(changed));
});

test('executor não contém mutação no Mercado Livre nem escrita operacional', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'catalog-identity-p0-finalize-25.js'), 'utf8');
  assert.doesNotMatch(source, /api\.mercadolibre\.com[^\n]+method:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(source, /\.from\(['"](?:produtos|anuncios_ml|catalogo_ml_snapshot|anuncios_ml_outbox)['"]\)\.(?:insert|update|upsert|delete)\(/);
  assert.match(source, /apply_ml_catalog_identity_projection_batch/);
  assert.match(source, /ml_catalog_identity_safety_snapshot/);
});
