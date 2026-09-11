const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');

const productId = '00000000-0000-4000-8000-000000000001';
const commandId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';

function harness(options = {}) {
  const calls = [];
  const route = load('src/app/api/pricing/decisions/reanalyze/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async () => options.denied
      ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, userId } },
    '@/services/pricing-reanalysis': {
      enqueuePricingReanalysis: async (input) => { calls.push(['enqueue', input]); return {
        jobId: commandId, state: 'pendente', replayed: Boolean(options.replay),
      }; },
      runPricingReanalysisJob: async (id, runOptions) => { calls.push(['run', id, runOptions]); return options.failed
        ? { jobId: id, productId, state: 'erro', error: 'pricing_reanalysis_unavailable', replayed: false }
        : options.hold ? { jobId: id, productId, state: 'on_hold', replayed: false }
          : { jobId: id, productId, state: 'completo', evaluationId: commandId, itemId: 'MLB1', replayed: false }; },
    },
  });
  const post = body => route.POST(new Request('http://local', { method: 'POST', body: JSON.stringify(body) }));
  return { calls, post };
}

test('reanálise exige permissão e não aceita parâmetros comerciais', async () => {
  const denied = harness({ denied: true });
  assert.equal((await denied.post({ productId, commandId })).status, 403);
  assert.equal(denied.calls.length, 0);
  const invalid = harness();
  assert.equal((await invalid.post({ productId, commandId, price: 1 })).status, 422);
  assert.equal(invalid.calls.length, 0);
});

test('reanálise manual enfileira e executa o job canônico sem writer comercial', async () => {
  const fresh = harness();
  const response = await fresh.post({ productId, commandId });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'completo');
  assert.deepEqual(fresh.calls[0][1], { productId, commandId, actorId: userId, source: 'manual' });
  assert.deepEqual(fresh.calls[1], ['run', commandId, { force: true }]);

  const source = fs.readFileSync('src/services/pricing-reanalysis.ts', 'utf8');
  assert.match(source, /status:\s*'completo'/);
  assert.match(source, /competitionItemId/);
  assert.match(source, /MATERIAL_RETRY_CODES/);
  assert.doesNotMatch(source, /method:\s*['"](?:PUT|DELETE|PATCH)['"]|enqueueApprovedPricingDecision|enqueueMlPublishOutbox/);
});

test('falha transitória fica observável e não é apresentada como concluída', async () => {
  const hold = harness({ hold: true });
  assert.equal((await hold.post({ productId, commandId })).status, 202);
  const failed = harness({ failed: true });
  const response = await failed.post({ productId, commandId });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Nenhuma alteração foi enviada/);
});

test('migration pagina por produto, corrige alerta histórico e mantém RPC backend-only', () => {
  const listSql = fs.readFileSync('supabase/migrations/20260911100000_pricing_decision_center_products.sql', 'utf8');
  const fixSql = fs.readFileSync('supabase/migrations/20260911130000_pricing_alert_reconciliation.sql', 'utf8');
  assert.match(listSql, /group by produto_id/);
  assert.match(listSql, /count\(distinct a\.produto_id\).*affected_products/s);
  assert.match(fixSql, /resolvedByVerifiedGroup/);
  assert.match(fixSql, /old\.observed_at<=e\.created_at/);
  assert.match(fixSql, /revoke all on function public\.sync_pricing_alerts/);
  assert.match(fixSql, /grant execute.*service_role/s);
});

test('cron mantém a fila atualizada sem habilitar automação de preço', () => {
  const cron = fs.readFileSync('src/app/api/sync/cron-dispatch/route.ts', 'utf8');
  assert.match(cron, /enqueueStalePricingReanalyses/);
  assert.match(cron, /processPricingReanalysisQueue/);
  assert.match(cron, /queue_skipped_auth_block/);
});
