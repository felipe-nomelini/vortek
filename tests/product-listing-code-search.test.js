const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const itemId = 'MLB7295377986';
const productId = 'e1b0dd7a-687e-449b-a203-fb770a7f9e16';
const product = { id: productId, sku: 'VTK025392', estoque: 2, ml_status: 'ativo' };
const pricing = { target: { ok: false }, current: { memory: null } };
const subject = load('src/services/product-pricing-query.ts', {
  'server-only': {},
  './pricing-context': { loadProductPricing: async (_, products) => new Map(products.map(row => [row.id, pricing])) },
  '@/lib/pricing-view': { pricingView: () => ({ cost: 10, profit: null, suggestedPrice: null }) },
  '@/lib/ml/product-listings': { loadProductMlListings: async () => new Map() },
  '@/lib/orders/fulfillment-capacity-loader': {
    loadProductFulfillmentCapacities: async (_, ids) => new Map(ids.map(id => [id, { safe: 2, internal: 0, supplier: 2 }])),
  },
  '@/lib/kit-supply-source': { loadKitSupplySources: async () => new Map() },
});

function clientFixture({ listingOwner = null, snapshotOwner = null, pointerOwner = null, sku = product.sku } = {}) {
  const tables = {
    anuncios_ml: listingOwner ? [{ produto_id: listingOwner, ml_item_id: itemId }] : [],
    catalogo_ml_snapshot: snapshotOwner ? [{ produto_id: snapshotOwner, ml_item_id: itemId }] : [],
    produtos: pointerOwner ? [{ id: pointerOwner, sku, ml_item_id: itemId }] : [{ id: productId, sku }],
  };
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const result = () => ({ data: tables[table].filter(row => filters.every(([column, value]) => row[column] === value)), error: null });
      const builder = {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        maybeSingle: async () => ({ data: result().data[0] || null, error: null }),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return builder;
    },
    rpc: async (_, args) => {
      calls.push(args);
      return { data: { data: [
        { product: { ...product, id: 'outro-produto', sku: 'X' + product.sku }, preferredOffer: null, offersCount: 0 },
        { product, preferredOffer: null, offersCount: 0 },
      ] }, error: null };
    },
  };
}

test('encontra código de anúncio padrão, catálogo e ponteiro legado, inclusive em minúsculas', async () => {
  for (const owner of ['listingOwner', 'snapshotOwner', 'pointerOwner']) {
    const client = clientFixture({ [owner]: productId });
    const result = await subject.resolveListingProductSearch(client, itemId.toLowerCase());
    assert.deepEqual(result, { kind: 'linked', productId, sku: product.sku });
  }
});

test('não confunde código de categoria ou vínculo ausente com outro produto', async () => {
  const client = clientFixture();
  assert.deepEqual(await subject.resolveListingProductSearch(client, 'MLB3905'), { kind: 'missing' });
  assert.equal(await subject.resolveListingProductSearch(client, 'VTK025392'), null);
  await assert.rejects(
    subject.resolveListingProductSearch(clientFixture({ listingOwner: productId, snapshotOwner: 'outro-produto' }), itemId),
    /vinculado a produtos divergentes/,
  );
});

test('a busca por anúncio mantém somente o produto vinculado antes da paginação', async () => {
  const client = clientFixture({ listingOwner: productId });
  const query = { search: itemId, supplierIds: [], includeInternal: false, active: 'ativo', mlStatus: '',
    stock: '', priceField: 'cost', priceMin: null, priceMax: null, sortBy: 'sku', sortOrder: 'asc', page: 1, pageSize: 100 };
  const result = await subject.queryPricedProducts(client, query, { operational: new Set() });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].p_search, product.sku);
  assert.equal(result.total, 1);
  assert.equal(result.data[0].product.id, productId);
});
