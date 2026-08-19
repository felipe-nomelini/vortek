const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildTransactionSql, compareLocalRemote } = require('../scripts/lib/ml-p0-phase5d1');

const item = {
  title: 'Ventisol Turbo 6', price: 599.9, sold_quantity: 0, status: 'active',
  listing_type_id: 'gold_special', catalog_listing: true, permalink: 'https://example.test/item', pictures: [],
};

test('transação usa lock, idempotência e não persiste qualidade inventada', () => {
  const sql = buildTransactionSql(item);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /LOCAL_PERSIST_ALREADY_CONSISTENT/);
  assert.match(sql, /SAFE_PUBLICATION_PERSIST_SUCCESS/);
  assert.doesNotMatch(sql, /qualidade_info/);
  assert.doesNotMatch(sql, /\bqualidade\b/);
});

test('executor não consulta performance nem permite escrita ML', () => {
  const source = fs.readFileSync(require.resolve('../scripts/run-ml-p0-phase5d1'), 'utf8');
  assert.doesNotMatch(source, /\/performance/);
  assert.doesNotMatch(source, /description/);
  assert.match(source, /method !== 'GET'/);
});

test('reconciliação exige vínculo único 1:1', () => {
  const local = {
    product: { ml_item_id: 'MLB7432322488' },
    item_listings: [{ ml_item_id: 'MLB7432322488', produto_id: 'eef0e527-8ef8-4a19-8132-9b1f670bb461', sku: 'VTK000392', titulo: item.title, preco_ml: 599.9, status: 'ativo', tipo: 'classico', catalogo: true, permalink: item.permalink }],
    product_listings: [{}], products_pointing_to_item: [{}],
  };
  const diff = compareLocalRemote(local, item);
  assert.equal(diff.unique, true);
  assert.equal(diff.material_drift, false);
});
