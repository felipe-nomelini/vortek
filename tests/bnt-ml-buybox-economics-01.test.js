const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const migration = fs.readFileSync('supabase/migrations/20260916120000_bnt_ml_buybox_economics_01.sql', 'utf8');
const pilot = fs.readFileSync('src/services/buybox-economics-pilot.ts', 'utf8');
const monitor = fs.readFileSync('src/services/pricing-experiments.ts', 'utf8');
const runner = fs.readFileSync('scripts/ml-buybox-economics-batch-01.js', 'utf8');

test('manifestos oficiais têm 15 SKUs únicos e checksums aprovados', () => {
  const root = '/mnt/c/Users/Bentevi Tecnologia/Downloads';
  const manifestBuffer = fs.readFileSync(`${root}/P1_ECONOMICA_BATCH_01_MANIFEST_15_SKUS.json`);
  const screeningBuffer = fs.readFileSync(`${root}/P1_ECONOMICA_BATCH_01_SCREENING_15_SKUS.csv`);
  assert.equal(crypto.createHash('sha256').update(manifestBuffer).digest('hex'), '891559359ee5c63cc7e05d1279ccfbd20ec64ea49f7ab57275cbc2c529140b60');
  assert.equal(crypto.createHash('sha256').update(screeningBuffer).digest('hex'), '9251741d53768fc84aca337115d2bcc2f6878967db88461ab4dd7f8f0f110199');
  const rows = JSON.parse(manifestBuffer);
  assert.equal(rows.length, 15);assert.equal(new Set(rows.map(row => row.sku)).size, 15);
  assert.equal(new Set(rows.map(row => row.ml_item_id)).size, 15);
});

test('persistência separa lote, experimento e checkpoints idempotentes', () => {
  for (const table of ['pricing_batch_runs','pricing_batch_items','pricing_experiments','pricing_experiment_checkpoints']) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
  }
  assert.match(migration, /unique \(experiment_id, checkpoint\)/);
  assert.match(migration, /for update of c skip locked/);
  assert.match(migration, /where state = 'pending'/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /grant execute.*service_role/s);
});

test('executor fica preso ao ator, hashes e origem price_to_win', () => {
  assert.match(pilot, /BNT-ML-BUYBOX-ECONOMICS-01/);
  assert.match(pilot, /3e56ce48-f461-4784-848b-097d1e482a43/);
  assert.match(pilot, /targetOrigin: 'price_to_win'/);
  assert.match(pilot, /strictEconomicGates: true/);
  assert.match(pilot, /OFERTA_ATIVA_COM_ESTOQUE_AUSENTE/);
  assert.match(pilot, /PRECO_VIVO_ABAIXO_DO_PISO/);
  assert.doesNotMatch(pilot, /custom_price\s*:/);
  assert.doesNotMatch(pilot, /local\.identity\.produto_id/);
});

test('rota interna do piloto exige a chave do servidor no proxy', () => {
  const proxy = fs.readFileSync('src/proxy.ts', 'utf8');
  assert.match(proxy, /pathname === "\/api\/pricing\/buybox-pilot"/);
  assert.match(proxy, /isInternalPricingRoute \|\|/);
});

test('monitor é somente leitura no Mercado Livre e agenda D1 D3 D7', () => {
  assert.match(pilot, /checkpoint: 'D1'/);assert.match(pilot, /checkpoint: 'D3'/);assert.match(pilot, /checkpoint: 'D7'/);
  assert.doesNotMatch(monitor, /method:\s*['"](?:PUT|POST|DELETE|PATCH)['"]/);
  assert.doesNotMatch(monitor, /enqueueApprovedPricingDecision|dispatchApprovedPricingOperation/);
  assert.match(monitor, /priceChangedExternally/);
});

test('runner sempre conclui dry-run integral antes de qualquer execute e gera dez artefatos', () => {
  assert.ok(runner.indexOf("action: 'evaluate'") < runner.indexOf("action: 'execute'"));
  for (let index = 1; index <= 10; index++) assert.match(runner, new RegExp(`${String(index).padStart(2, '0')}_batch01_`));
  assert.match(runner, /if \(evaluated\.length !== 15\)/);
  assert.match(runner, /failedReadbacks > 1/);
});
