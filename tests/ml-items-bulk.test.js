const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ML_ITEMS_BULK_MAX_IDS,
  buildMlItemsBulkPath,
  getMlItemsBulkBody,
} = require('../src/lib/ml/items-bulk.ts');

test('monta o endpoint bulk atual com atributos do body', () => {
  assert.equal(
    buildMlItemsBulkPath([' MLB1 ', 'MLB2', 'MLB1'], ['id', 'body.title', 'title']),
    '/items/bulk?ids=MLB1,MLB2&attributes=body.title',
  );
});

test('limita cada consulta bulk a 20 ids', () => {
  assert.equal(ML_ITEMS_BULK_MAX_IDS, 20);
  assert.throws(() => buildMlItemsBulkPath([]), /ids_required/);
  assert.throws(
    () => buildMlItemsBulkPath(Array.from({ length: 21 }, (_, index) => `MLB${index}`)),
    /max_20_ids/,
  );
});

test('normaliza o contrato novo usando id raiz e status_code', () => {
  assert.deepEqual(
    getMlItemsBulkBody({ id: 'MLB1', status_code: 200, body: { id: 'incorreto', title: 'Produto' } }),
    { id: 'MLB1', title: 'Produto' },
  );
  assert.equal(getMlItemsBulkBody({ id: 'MLB1', status_code: 404, body: {} }), null);
  assert.equal(getMlItemsBulkBody({ status_code: 200, body: {} }), null);
});

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|js|jsonl)$/.test(entry.name) ? [target] : [];
  });
}

test('código e scripts não mantêm consultas múltiplas legadas', () => {
  const roots = [path.join(__dirname, '../src'), path.join(__dirname, '../scripts')];
  for (const file of roots.flatMap(sourceFiles)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\/items\?ids=/, file);
    assert.doesNotMatch(source, /\/users\?ids=/, file);
  }
});
