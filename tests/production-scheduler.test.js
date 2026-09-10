const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PRODUCTION_SCHEDULER_CENTRAL_INTERVAL_MS,
  PRODUCTION_SCHEDULER_PUBLISH_INTERVAL_MS,
  shouldStartProductionScheduler,
} = require('../src/services/production-scheduler.ts');

test('agendador inicia somente no servidor produtivo e nunca durante o build', () => {
  const production = {
    NODE_ENV: 'production',
    VORTEK_RUNTIME_ENVIRONMENT: 'production',
  };
  assert.equal(shouldStartProductionScheduler(production), true);
  assert.equal(shouldStartProductionScheduler({ ...production, NEXT_PHASE: 'phase-production-build' }), false);
  assert.equal(shouldStartProductionScheduler({ ...production, VORTEK_RUNTIME_ENVIRONMENT: 'local_dev' }), false);
  assert.equal(shouldStartProductionScheduler({ ...production, NODE_ENV: 'development' }), false);
});

test('runtime substitui os dois crons de rede sem liberar preço automático', () => {
  assert.equal(PRODUCTION_SCHEDULER_CENTRAL_INTERVAL_MS, 60_000);
  assert.equal(PRODUCTION_SCHEDULER_PUBLISH_INTERVAL_MS, 15_000);

  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/production-scheduler.ts'),
    'utf8',
  );
  assert.match(source, /\/api\/sync\/cron-dispatch/);
  assert.match(source, /taskKey: 'sync_ml_listings_publish'/);
  assert.doesNotMatch(source, /catalog-price-refresh|pricing_decision|desired_price/);
  assert.match(source, /127\.0\.0\.1/);
});

test('instrumentação Node registra o agendador produtivo', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/instrumentation-node.ts'), 'utf8');
  assert.match(source, /startProductionScheduler\(\)/);
});

test('migration desliga dispatchers de banco substituídos pelo runtime', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260910153000_move_dispatch_to_app_runtime.sql'),
    'utf8',
  );
  assert.match(source, /cron\.alter_job\(v_central_job_id, active := false\)/);
  assert.match(source, /cron\.alter_job\(v_publish_job_id, active := false\)/);
  assert.match(source, /cron\.alter_job\(v_price_job_id, active := false\)/);
  assert.doesNotMatch(source, /active := true/);
});
