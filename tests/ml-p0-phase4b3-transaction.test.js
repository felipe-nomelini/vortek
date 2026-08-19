const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTransactionSql, sqlLiteral } = require('../scripts/run-ml-p0-phase4b3-transaction');

function item() {
  return {
    id: 'MLB7432157712',
    title: "Carregador D'Pilhas Toshiba",
    price: 187.22,
    sold_quantity: 0,
    status: 'active',
    listing_type_id: 'gold_pro',
    catalog_listing: false,
    permalink: 'https://produto.mercadolivre.com.br/MLB-7432157712',
    pictures: [{ secure_url: 'https://http2.mlstatic.com/image.jpg' }],
  };
}

test('escapes SQL text values', () => {
  assert.equal(sqlLiteral("D'Pilhas"), "'D''Pilhas'");
});

test('transaction is atomic, locked, idempotent, and preserves master dimensions', () => {
  const sql = buildTransactionSql(item());
  assert.match(sql, /begin;/i);
  assert.match(sql, /commit;/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update;/i);
  assert.match(sql, /LOCAL_PERSIST_ALREADY_CONSISTENT/);
  assert.match(sql, /insert into public\.anuncios_ml/);
  assert.match(sql, /set ml_item_id = 'MLB7432157712', ml_status = 'ativo'/);
  assert.doesNotMatch(sql, /set[\s\S]{0,200}(altura|largura|profundidade|peso_bruto)\s*=/i);
});
