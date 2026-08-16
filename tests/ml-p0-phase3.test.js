const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseCanonicalProduct,
  chooseRecommendedAction,
  compareRemoteMatch,
  localDuplicateConfidence,
  parsePackCount,
} = require('../scripts/lib/ml-p0-phase3');

test('detecta quantidade comercial em título e atributo', () => {
  assert.equal(parsePackCount('Kit 3 Jogos de Cordas'), 3);
  assert.equal(parsePackCount('Cabo com 20 unidades'), 20);
  assert.equal(parsePackCount('Produto', [{ id: 'UNITS_PER_PACK', value_name: '6' }]), 6);
});

test('GTIN igual não vence divergência de quantidade comercial', () => {
  const result = compareRemoteMatch({
    local: { sku: 'VTK1', gtin: '097855181138', brand: 'Logitech', model: 'M110', title: 'Mouse Logitech M110', pack_count: 1 },
    item: { id: 'MLB1', title: 'Kit 2 Mouse Logitech M110', attributes: [
      { id: 'BRAND', value_name: 'Logitech' }, { id: 'MODEL', value_name: 'M110' },
      { id: 'GTIN', value_name: '097855181138' }, { id: 'UNITS_PER_PACK', value_name: '2' },
    ] },
  });
  assert.equal(result.match_type, 'NOT_MATCH');
  assert.equal(result.evidence.pack_match, false);
});

test('GTIN, marca, modelo e quantidade iguais produzem exact match', () => {
  const result = compareRemoteMatch({
    local: { sku: 'VTK1', gtin: '097855181138', brand: 'Logitech', model: 'M110', title: 'Mouse Logitech M110', pack_count: 1 },
    item: { id: 'MLB1', title: 'Mouse Logitech M110', attributes: [
      { id: 'BRAND', value_name: 'Logitech' }, { id: 'MODEL', value_name: 'M110' }, { id: 'GTIN', value_name: '097855181138' },
    ] },
  });
  assert.equal(result.match_type, 'EXACT_MATCH');
  assert.ok(result.confidence >= 95);
});

test('vínculo com outro produto só é errado após identidade remota forte', () => {
  const result = compareRemoteMatch({
    local: { sku: 'VTK1', gtin: '7891234567895', brand: 'Marca A', model: 'A1', title: 'Produto Marca A A1', pack_count: 1 },
    item: { id: 'MLB1', title: 'Produto diferente Marca B B2', attributes: [
      { id: 'BRAND', value_name: 'Marca B' }, { id: 'MODEL', value_name: 'B2' }, { id: 'GTIN', value_name: '7899876543210' },
    ] },
    linkedProduct: { sku: 'VTK2', gtin: '7899876543210', marca: 'Marca B' },
  });
  assert.equal(result.match_type, 'NOT_MATCH');
});

test('duplicidade local exige mesma unidade comercial', () => {
  const base = { gtin: '733132120277', marca: 'Elixir', model: '12027', imagens: [] };
  assert.ok(localDuplicateConfidence({ ...base, nome: 'Encordoamento 12027' }, { ...base, nome: 'Encordoamento 12027' }).confidence >= 90);
  assert.ok(localDuplicateConfidence({ ...base, nome: 'Encordoamento 12027' }, { ...base, nome: 'Kit 3 Encordoamentos 12027' }).confidence < 80);
});

test('produto com venda e anúncio ativo vence escolha canônica', () => {
  const selected = chooseCanonicalProduct(
    { sku: 'NOVO', sold_quantity: 0, active_remote_count: 0, gtin: '7891234567895', created_at: '2026-01-01' },
    { sku: 'ANTIGO', sold_quantity: 8, active_remote_count: 1, gtin: '7891234567895', created_at: '2025-01-01' },
  );
  assert.equal(selected.sku, 'ANTIGO');
});

test('ready exige todos gates e baixo risco de duplicidade', () => {
  assert.equal(chooseRecommendedAction({ equivalentMatches: 0, maxConfidence: 0, hasLocalDuplicate: false,
    gates: { identity: 100, documentation: 100, publication: 95, duplicateRisk: 0, category: true, attributes: true, image: true },
    sourceDeferred: false, categoryMismatch: false, manualIdentity: false, manualTech: false, manualImage: false,
  }), 'READY_FOR_CREATE');
  assert.equal(chooseRecommendedAction({ equivalentMatches: 1, maxConfidence: 99, hasLocalDuplicate: true,
    gates: {}, sourceDeferred: false, categoryMismatch: false, manualIdentity: false, manualTech: false, manualImage: false,
  }), 'BLOCK_DUPLICATE');
});
