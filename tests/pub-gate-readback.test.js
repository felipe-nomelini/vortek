const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-integration-module');

function harness(catalogListing) {
  let persisted = 0;
  const product = { id: 'p', ativo: true, sku: 'SKU', ml_item_id: 'MLB0', custom_price: 10 };
  const item = { id: 'MLB3', seller_id: 123, price: 110, currency_id: 'BRL', status: 'active',
    sub_status: [], pictures: [{}], category_id: 'MLB1', listing_type_id: 'gold_pro',
    condition: 'new', available_quantity: 1, parent_item_id: 'MLB0', catalog_listing: catalogListing,
    shipping: { mode: 'me2', logistic_type: 'xd_drop_off', free_shipping: true }, sale_terms: [] };
  const client = { from(table) {
    const q = { select() { return q; }, eq() { return q; }, or() { return q; },
      update() { persisted++; return q; },
      single: async () => ({ data: product, error: null }),
      then(resolve) { resolve(table === 'produto_fornecedor_ofertas'
        ? { data: [], error: null } : { data: [{ id: 'p' }], error: null }); } };
    return q;
  } };
  const mod = load('src/services/publication-readback.ts', {
    'server-only': {}, '@/lib/supabase': {},
    './integration': { fetchMLResult: async path => path.endsWith('/description')
      ? { ok: true, data: { plain_text: 'Descrição oficial do catálogo' } }
      : { ok: true, data: item } },
    './mercadolibre': { getCategoryAttributes: async () => [], getCategorySaleTerms: async () => [] },
    '@/lib/ml-critical-attributes': { assessMlProductIdentity: () => ({}), loadMlIdentityKit: async () => ({}) },
    '@/lib/ml/brand-equivalences': { loadMlBrandEquivalences: async () => [] },
    '@/lib/ml-listing-identity': { isMlIdentityComplete: () => true, isMlExistingListingIdentitySafe: () => true },
    '@/lib/dslite/supplier-policy': { loadOperationalDropshippingSupplierIds: async () => new Set() },
    '@/lib/product-warranty': { factoryWarranty: { revision: 'v1' },
      warrantySaleTerms: () => ({ compatible: true, terms: [] }) },
    '@/lib/ml/persist-single-anuncio': { persistSingleAnuncioBySku: async () => ({ ok: true }) },
    './ml-listing-links': { resolveProductMlLinks: async () => ({ coverage: 'complete', groups: [{}],
      candidates: [{ itemId: 'MLB3', identity: 'complete' }] }), persistProductMlGroups: async () => {} },
    '@/lib/ml/pricing-execution': { pricingReadbackMatches: () => true },
  });
  const operation = { item_id: 'MLB3', produto_id: 'p', new_price_cents: 11000 };
  const preparation = { action: 'relist', sourceItemId: 'MLB0', capacity: 1,
    originalCustomPrice: 20, warrantyRevision: 'v1', description: 'Descrição gerada pela loja',
    input: { shipping: { mode: 'me2', logisticType: 'xd_drop_off', freeShipping: true } },
    expected: { category_id: 'MLB1', listing_type_id: 'gold_pro', condition: 'new' } };
  return { run: () => mod.verifyCreatedPublication(client, operation, preparation, '123'),
    get persisted() { return persisted; } };
}

test('readback aceita a descrição oficial de republicação em catálogo sem alterar o item', async () => {
  const catalog = harness(true);
  assert.equal(await catalog.run(), true);
  assert.equal(catalog.persisted, 1);

  const standard = harness(false);
  assert.equal(await standard.run(), false);
  assert.equal(standard.persisted, 0);
});
