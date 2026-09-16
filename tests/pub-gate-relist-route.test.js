const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-integration-module');

const productId = '00000000-0000-4000-8000-000000000001';
function route(source) {
  let prepared = null;
  const module = load('src/app/api/ml/anuncio/criar/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => Response.json(body, options) } },
    'node:crypto': { randomUUID: () => productId },
    zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: productId }) },
    '@/lib/supabase': { createServiceClient: () => ({
      rpc: async () => ({ data: productId, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { alert_id: productId }, error: null }) }) }) }),
    }) },
    '@/lib/ml/pricing-execution': { getPricingExecutionBlock: () => ({}) },
    '@/services/publication-preparation': {
      publicationInputSchema: require('zod').z.object({
        action: require('zod').z.literal('relist'), produtoId: require('zod').z.string().uuid(),
        sourceItemId: require('zod').z.string(), priceCents: require('zod').z.number(),
        categoriaId: require('zod').z.string(), listingType: require('zod').z.string(),
        attributes: require('zod').z.array(require('zod').z.any()), sale_terms: require('zod').z.array(require('zod').z.any()),
        shipping: require('zod').z.any(),
      }),
      preparePublication: async input => { prepared = input; return {
        evaluationId: productId, pricing: {}, decisionContext: { expiresAt: '2026-09-17', priceCents: input.priceCents },
        preparation: { capacity: 1 },
      }; },
    },
    '@/services/pricing-execution-access': { configuredPricingExecutionCapability: () => ({ allowedOperations: ['listing_create'] }) },
    '@/services/integration': { fetchMLResult: async () => ({ ok: true, data: source }) },
  });
  return { module, get prepared() { return prepared; } };
}

test('republicação usa categoria, logística e atributos do anúncio encerrado', async () => {
  const h = route({ id: 'MLB123', status: 'closed', price: 237.71, category_id: 'MLB1696',
    listing_type_id: 'gold_pro', shipping: { mode: 'me2', logistic_type: 'xd_drop_off', free_shipping: true },
    attributes: [{ id: 'BRAND', value_name: 'Fortrek' }], sale_terms: [] });
  const response = await h.module.POST(new Request('https://app.bentevi.shop/api/ml/anuncio/criar', {
    method: 'POST', body: JSON.stringify({ action: 'relist', produtoId: productId,
      sourceItemId: 'MLB123', priceCents: 23771 }),
  }));
  assert.equal(response.status, 200);
  assert.equal(h.prepared.categoriaId, 'MLB1696');
  assert.deepEqual(h.prepared.shipping, { mode: 'me2', logisticType: 'xd_drop_off', freeShipping: true });
  assert.deepEqual(h.prepared.attributes, [{ id: 'BRAND', value_name: 'Fortrek' }]);
});

test('republicação bloqueia alteração do preço remoto antes de preparar a proposta', async () => {
  const h = route({ id: 'MLB123', status: 'closed', price: 240 });
  const response = await h.module.POST(new Request('https://app.bentevi.shop/api/ml/anuncio/criar', {
    method: 'POST', body: JSON.stringify({ action: 'relist', produtoId: productId,
      sourceItemId: 'MLB123', priceCents: 23771 }),
  }));
  assert.equal(response.status, 409);
  assert.equal(h.prepared, null);
});
