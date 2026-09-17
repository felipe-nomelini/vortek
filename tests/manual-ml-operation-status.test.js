const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-integration-module');

const operationId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';

function route(owner = actorId) {
  let deliveryReads = 0;
  const client = { from(table) {
    const query = { select() { return query; }, eq() { return query; },
      maybeSingle: async () => {
        if (table === 'pricing_operations') return { data: { id: operationId, actor_id: owner,
          state: 'prepared', item_id: null }, error: null };
        deliveryReads++;
        return { data: { status: 'retry', last_error: 'internal_private_detail' }, error: null };
      } };
    return query;
  } };
  const mod = load('src/app/api/ml/operacoes/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => Response.json(body, options) } },
    zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: actorId }) },
    '@/lib/supabase': { createServiceClient: () => client },
  });
  return { get: () => mod.GET(new Request(`https://app.bentevi.shop/api/ml/operacoes?operationId=${operationId}`)),
    get deliveryReads() { return deliveryReads; } };
}

test('somente o autor consulta a operação; falha técnica privada não sai na resposta', async () => {
  const own = route();
  const response = await own.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { id: operationId, actor_id: actorId,
    state: 'prepared', item_id: null, delivery_status: 'retry' });
  assert.equal(own.deliveryReads, 1);

  const other = route(operationId);
  assert.equal((await other.get()).status, 404);
  assert.equal(other.deliveryReads, 0);
});
