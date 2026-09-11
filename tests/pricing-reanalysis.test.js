const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');

const productId = '00000000-0000-4000-8000-000000000001';
const commandId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';

function harness(options = {}) {
  const calls = [];
  const job = { id: commandId, status: options.priorStatus || 'concluido', created_by: userId,
    log: [{ productId }] };
  const client = { from(table) {
    const q = {
      insert(body) { calls.push(['insert', table, body]); return q; },
      update(body) { calls.push(['update', table, body]); return q; },
      select() { return q; }, eq() { return q; },
      single: async () => options.replay && table === 'jobs'
        ? { data: null, error: { code: '23505' } }
        : { data: table === 'jobs' ? job : null, error: null },
      maybeSingle: async () => ({ data: table === 'jobs' ? job : { id: productId, sku: 'VTK1' }, error: null }),
      then(resolve) { resolve({ data: null, error: null }); },
    };
    return q;
  } };
  const route = load('src/app/api/pricing/decisions/reanalyze/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async () => options.denied
      ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, userId } },
    '@/lib/supabase': { createServiceClient: () => client },
    '@/services/integration': { fetchMLResult: async path => { calls.push(['ml', path]);
      return { ok: true, data: { id: 123, site_id: 'MLB' } }; } },
    '@/services/ml-listing-links': {
      resolveProductMlLinks: async () => ({ coverage: 'complete', groups: [{}], candidates: [
        { itemId: 'MLB1', status: 'active', identity: 'complete', variationId: '', catalog: false },
      ] }),
      persistProductMlGroups: async () => ({ applied: true }),
    },
    '@/services/pricing-detail': { loadPricingDetail: async () => Response.json({ evaluationId: commandId }) },
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

test('reanálise é unitária, idempotente e não contém writer remoto', async () => {
  const fresh = harness();
  const response = await fresh.post({ productId, commandId });
  assert.equal(response.status, 200);
  assert.deepEqual(fresh.calls.filter(call => call[0] === 'ml'), [['ml', '/users/me']]);
  assert.equal(fresh.calls.some(call => call[0] === 'insert' && call[1] === 'jobs'), true);
  const replay = harness({ replay: true });
  const replayResponse = await replay.post({ productId, commandId });
  assert.equal(replayResponse.status, 200);
  assert.equal((await replayResponse.json()).replayed, true);
  assert.equal(replay.calls.some(call => call[0] === 'ml'), false);
  const source = fs.readFileSync('src/app/api/pricing/decisions/reanalyze/route.ts', 'utf8');
  assert.doesNotMatch(source, /method:\s*['"](?:PUT|DELETE|PATCH)['"]|enqueueApprovedPricingDecision/);
});

test('migration pagina por produto e mantém RPC fora de anon/authenticated', () => {
  const sql = fs.readFileSync('supabase/migrations/20260911100000_pricing_decision_center_products.sql', 'utf8');
  assert.match(sql, /group by produto_id/);
  assert.match(sql, /count\(distinct a\.produto_id\).*affected_products/s);
  assert.match(sql, /revoke all on function public\.search_pricing_decision_product_ids/);
  assert.match(sql, /grant execute.*service_role/s);
});
