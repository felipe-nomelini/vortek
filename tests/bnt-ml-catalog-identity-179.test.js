const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const executor = require('../scripts/catalog-identity-p0-executive-179.js');

test('parser aceita BOM, aspas e quebra CRLF sem deslocar colunas', () => {
  const rows = executor.parseCsv('\uFEFFsku,title,pricing_eligible\r\nVTK1,"Produto, kit",True\r\n');
  assert.deepEqual(rows, [{ sku: 'VTK1', title: 'Produto, kit', pricing_eligible: 'True' }]);
  assert.deepEqual(executor.normalizeExecutiveRow(rows[0]), {
    sku: 'VTK1', ml_item_id: '', catalog_product_id: '', standard_item_id: null,
    previous_state: '', audited_state: '', reason_code: '', risk_tier: '',
    local_name: '', remote_title: '', execution_action: '', pricing_eligible: true, notes: '',
  });
});

test('snapshot material ignora ordem de atributos e normaliza espaços', () => {
  const item = { id: 'MLB1', seller_id: 1, title: '  Pilha\u00a0AAA ', catalog_listing: true,
    catalog_product_id: 'MLB2', item_relations: [{ id: 'MLB3' }], attributes: [
      { id: 'GTIN', value_name: '789' }, { id: 'BRAND', value_name: 'Marca' },
    ] };
  const reordered = { ...item, title: 'Pilha AAA', attributes: [...item.attributes].reverse() };
  const product = { id: 'MLB2', status: 'active', name: 'Pilha AAA', attributes: [] };
  assert.equal(executor.stableJson(executor.materialSnapshot(item, product)),
    executor.stableJson(executor.materialSnapshot(reordered, product)));
});

test('snapshot material detecta mudança de marca, GTIN e relação', () => {
  const base = { id: 'MLB1', seller_id: 1, title: 'Produto', catalog_listing: true,
    catalog_product_id: 'MLB2', item_relations: [{ id: 'MLB3' }],
    attributes: [{ id: 'BRAND', value_name: 'A' }, { id: 'GTIN', value_name: '1' }] };
  const product = { id: 'MLB2', status: 'active', name: 'Produto', attributes: [] };
  const changed = { ...base, item_relations: [{ id: 'MLB4' }],
    attributes: [{ id: 'BRAND', value_name: 'B' }, { id: 'GTIN', value_name: '2' }] };
  assert.notEqual(executor.sha256(executor.stableJson(executor.materialSnapshot(base, product))),
    executor.sha256(executor.stableJson(executor.materialSnapshot(changed, product))));
});

test('snapshot material detecta mudança de identidade no produto local', () => {
  const item = { id: 'MLB1', seller_id: 1, title: 'Produto', catalog_listing: true,
    catalog_product_id: 'MLB2', item_relations: [], attributes: [] };
  const product = { id: 'MLB2', status: 'active', name: 'Produto', attributes: [] };
  const local = { product: { id: '1', sku: 'VTK1', nome: 'Produto', marca: 'Marca A', gtin: '789' },
    listing: { ml_item_id: 'MLB1', produto_id: '1', sku: 'VTK1', titulo: 'Produto', catalogo: true },
    snapshot: { ml_item_id: 'MLB1', seller_id: 1, produto_id: '1', sku_local: 'VTK1',
      seller_sku: 'VTK1', catalog_product_id: 'MLB2', title: 'Produto' } };
  const changed = { ...local, product: { ...local.product, marca: 'Marca B' } };
  assert.notEqual(executor.stableJson(executor.materialSnapshot(item, product, local)),
    executor.stableJson(executor.materialSnapshot(item, product, changed)));
});

test('migration aplica projeção em transação privada e não toca tabelas operacionais', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
    '20260915050000_bnt_ml_catalog_identity_179_apply.sql'), 'utf8');
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /on conflict \(seller_id, ml_item_id\) do update/);
  assert.match(sql, /profile\.cargo = 'admin'/);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant execute[\s\S]+to service_role/);
  assert.match(sql, /ml_catalog_identity_projection_local_readback_changed/);
  assert.match(sql, /ml_catalog_identity_projection_manifest_decision_mismatch/);
  assert.match(sql, /trg_invalidate_ml_catalog_identity_on_product/);
  assert.doesNotMatch(sql, /update\s+public\.produtos/i);
  assert.doesNotMatch(sql, /update\s+public\.anuncios_ml/i);
  assert.doesNotMatch(sql, /update\s+public\.catalogo_ml_snapshot/i);
});

test('inputs executivos reais continuam íntegros quando disponíveis', { skip: !fs.existsSync('/mnt/c/Users/Bentevi Tecnologia/Downloads/P0_AUDITORIA_EXECUTIVA_179_CASOS_2026-09-15.csv') }, () => {
  const loaded = executor.loadInputs('/mnt/c/Users/Bentevi Tecnologia/Downloads',
    path.join(__dirname, '..', 'reports', 'catalog-identity-p0', 'BNT-ML-CATALOG-IDENTITY-01-2026-09-15-readonly-final'));
  assert.equal(loaded.audit.length, 179);
  assert.equal(loaded.release.length, 155);
  assert.equal(loaded.pending.length, 2);
  assert.equal(loaded.batch01.length, 15);
  assert.equal(loaded.batch02.length, 7);
});

test('executor persiste safety stop se a aplicação controlada for interrompida', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts',
    'catalog-identity-p0-executive-179.js'), 'utf8');
  assert.match(source, /state: 'paused'[\s\S]+safety_stop:/);
  assert.match(source, /run_complete_failed:/);
});
