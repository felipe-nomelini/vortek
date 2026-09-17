const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

test('pausa operacional enfileira somente o status, mesmo com preço e estoque cadastrados', async () => {
  const product = {
    id: 'fa726c47-c2bc-462a-926a-258019af7e4c',
    sku: 'VTK017472',
    ml_item_id: 'MLB7601891176',
    ml_status: 'ativo',
    custom_price: 570.68,
    estoque: 48,
  };
  let selectedColumns = '';
  let enqueuedInput = null;
  const serviceClient = {
    from(table) {
      assert.equal(table, 'produtos');
      return {
        select(columns) {
          selectedColumns = columns;
          return {
            async in(column, values) {
              assert.equal(column, 'id');
              assert.deepEqual(values, [product.id]);
              return { data: [product], error: null };
            },
          };
        },
      };
    },
  };
  const { POST } = load('src/app/api/anuncios/status-lote/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase': {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) } }),
      createServiceClient: () => serviceClient,
    },
    '@/lib/sync/ml-publish-outbox': {
      enqueueMlPublishOutbox: async (_client, input) => {
        enqueuedInput = input;
        // Reproduz a proteção produtiva: uma pausa não pode carregar preço.
        if (Object.hasOwn(input, 'desiredPrice')) return { ok: false, error: 'ml_identity_price_write_blocked' };
        return { ok: true, outboxId: 'outbox-status-1', action: 'inserted' };
      },
    },
  });

  const response = await POST(new Request('https://app.bentevi.shop/api/anuncios/status-lote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ produtoIds: [product.id], targetStatus: 'pausado' }),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(selectedColumns, 'id, sku, ml_item_id, ml_status');
  assert.equal(body.items[0].outcome, 'queued');
  assert.equal(body.items[0].outboxId, 'outbox-status-1');
  assert.equal(enqueuedInput.desiredStatus, 'pausado');
  assert.equal(enqueuedInput.mlItemId, product.ml_item_id);
  assert.equal(enqueuedInput.source, 'anuncios_batch_status');
  assert.equal(enqueuedInput.payload.apply_status, true);
  assert.equal(enqueuedInput.payload.apply_price, false);
  assert.equal(enqueuedInput.payload.apply_quantity, false);
  assert.equal(Object.hasOwn(enqueuedInput, 'desiredPrice'), false);
  assert.equal(Object.hasOwn(enqueuedInput, 'desiredQuantity'), false);
});
