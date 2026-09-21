const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('piloto de Buy Box e canal do agente não têm executores acessíveis', () => {
  for (const path of [
    'src/app/api/pricing/buybox-pilot/route.ts',
    'src/services/buybox-economics-pilot.ts',
    'scripts/ml-buybox-economics-batch-01.js',
    'src/app/api/ml/agente/preco/route.ts',
    'src/lib/ml/agent-price-auth.ts',
    'scripts/ml-agent-price.js',
  ]) assert.equal(fs.existsSync(path), false, path);

  const proxy = fs.readFileSync('src/proxy.ts', 'utf8');
  assert.doesNotMatch(proxy, /\/api\/pricing\/buybox-pilot|\/api\/ml\/agente\/preco/);
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(Object.keys(packageJson.scripts).some((name) => name.startsWith('pricing:buybox:')), false);
});

test('confirmação humana e proteções da fila permanecem', () => {
  const manual = fs.readFileSync('src/app/api/ml/anuncio/atualizar-preco/route.ts', 'utf8');
  assert.match(manual, /authorizeApiRequest/);
  assert.match(manual, /enqueueManualMlCommand/);
  const publisher = fs.readFileSync('src/app/api/sync/anuncios/publish/route.ts', 'utf8');
  assert.match(publisher, /getPricingExecutionBlock/);
  assert.match(publisher, /dispatchApprovedPricingOperation/);
});

test('histórico do piloto continua legível pelo monitor sem escrita remota', () => {
  const migration = fs.readFileSync('supabase/migrations/20260916120000_bnt_ml_buybox_economics_01.sql', 'utf8');
  const monitor = fs.readFileSync('src/services/pricing-experiments.ts', 'utf8');
  assert.match(migration, /create table public\.pricing_experiments/);
  assert.doesNotMatch(monitor, /method:\s*['"](?:PUT|POST|DELETE|PATCH)['"]/);
  assert.doesNotMatch(monitor, /enqueueManualMlCommand|dispatchApprovedPricingOperation/);
});
