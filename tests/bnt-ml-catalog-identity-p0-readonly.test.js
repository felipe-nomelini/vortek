const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runner = require('../scripts/catalog-identity-p0-readonly.js');

const canonicalFile = '/mnt/c/Users/Bentevi Tecnologia/Downloads/P0_CATALOGO_ML_1550_UNIVERSO_FONTE_2026-09-14.csv';

test('fonte canônica entregue passa checksum, universo e duplicidade declarados', {
  skip: !fs.existsSync(canonicalFile),
}, () => {
  const result = runner.parseCanonicalCsv(fs.readFileSync(canonicalFile));
  assert.equal(result.sha256, runner.EXPECTED_SHA256);
  assert.equal(result.rows.length, 1_550);
  assert.equal(new Set(result.rows.map((row) => row.ml_item_id)).size, 1_550);
  assert.equal(new Set(result.rows.map((row) => row.sku)).size, 1_549);
  assert.deepEqual(result.rows.filter((row) => row.sku === 'VTK009697').map((row) => row.ml_item_id), [
    'MLB7210717968',
    'MLB4907843137',
  ]);
});

test('parser CSV preserva vírgula decimal e campos vazios', () => {
  const rows = runner.parseCsv('sku,price,empty\r\nVTK1,"1.234,56",\r\n');
  assert.deepEqual(rows, [['sku', 'price', 'empty'], ['VTK1', '1.234,56', '']]);
  assert.equal(runner.parseBrl('1.234,56', 'price', 2), 1234.56);
  assert.equal(runner.parseBrl('', 'price_to_win', 2, true), null);
  assert.throws(() => runner.parseBrl('1,2,3', 'price', 2), /canonical_price_invalid/);
});

test('barreira HTTP aceita somente GET e HEAD', async () => {
  const methods = [];
  const tracker = runner.createReadOnlyFetchTracker(async (_input, init) => {
    methods.push(init.method);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await tracker.readonlyFetch('https://example.test/read');
  await tracker.readonlyFetch('https://example.test/read', { method: 'HEAD' });
  await assert.rejects(tracker.readonlyFetch('https://example.test/write', { method: 'POST' }), /readonly_http_method_blocked:POST/);
  assert.deepEqual(methods, ['GET', 'HEAD']);
  assert.deepEqual(tracker.stats, { get: 1, head: 1, blocked_mutation_attempts: 1 });
});

test('divergência relacional rebaixa SEM_CONFLITO para pendência, sem fabricar conflito material', () => {
  const base = {
    identityState: 'SEM_CONFLITO',
    reasonCode: 'IDENTIDADE_COHERENTE_COM_DUAS_ANCORAS',
    conflictType: null,
    comparisons: [],
    riskTier: 'BAIXO',
    gapPct: 0,
    blockPriceWrite: false,
    blockBuyBoxChase: false,
  };
  const changed = runner.materialStateOverrides(base, {
    baseline: { sku: 'VTK000001', catalog_product_id: 'MLB100', standard_item_id: null },
    localListing: { sku: 'VTK000002' },
    snapshot: { catalog_product_id: 'MLB100', related_item_id: null },
    item: { catalog_product_id: 'MLB100', item_relations: [] },
  });
  assert.equal(changed.identityState, 'PENDENCIA_VALIDACAO');
  assert.equal(changed.reasonCode, 'RELACAO_BASELINE_VIVA_DIVERGENTE');
  assert.equal(changed.blockPriceWrite, true);
});

test('readback separa vínculo, atividade, preço desejado e preço observado', () => {
  const before = {
    listings: [{ ml_item_id: 'MLB1', produto_id: 'p1', sku: 'VTK1', preco_ml: 10 }],
    products: [{ id: 'p1', sku: 'VTK1', ativo: true, custom_price: 10 }],
  };
  const observedOnly = {
    listings: [{ ml_item_id: 'MLB1', produto_id: 'p1', sku: 'VTK1', preco_ml: 11 }],
    products: [{ id: 'p1', sku: 'VTK1', ativo: true, custom_price: 10 }],
  };
  assert.deepEqual(runner.compareOperationalProjection(before, observedOnly), {
    listing_relation_changes: 0,
    listing_observed_price_changes: 1,
    produtos_ativo_changes: 0,
    produtos_custom_price_changes: 0,
  });
});

test('runner não referencia cliente mutante nem operações de persistência', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'catalog-identity-p0-readonly.js'), 'utf8');
  assert.doesNotMatch(source, /services\/integration/);
  assert.doesNotMatch(source, /\.from\([^)]*\)\s*\.(?:insert|update|upsert|delete)\s*\(/s);
  assert.doesNotMatch(source, /client\.rpc\s*\(/);
  assert.match(source, /buildMlItemsBulkPath/);
  assert.equal(runner.ARTIFACT_NAMES.length, 10);
});

test('CLI exige somente input e output', () => {
  assert.deepEqual(runner.parseArgs(['--input', '/tmp/source.csv', '--output', '/tmp/result']), {
    input: '/tmp/source.csv',
    output: '/tmp/result',
  });
  assert.throws(() => runner.parseArgs(['--apply']), /argument_invalid/);
  assert.throws(() => runner.parseArgs(['--input', '/tmp/source.csv']), /arguments_input_output_required/);
});
