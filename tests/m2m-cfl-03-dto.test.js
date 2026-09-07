const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-integration-module');
const { loadProductMlListings } = load('src/lib/ml/product-listings.ts', {
  '@/lib/catalogo/no-catalogo': { resolveCatalogCompetitionStatus: () => 'sem_catalogo' },
});

function fixture(state = 'verified') {
  const calls = [];
  const rows = {
    anuncios_ml: [{ produto_id: 'P1', ml_item_id: 'MLB1', status: 'active', catalogo: false, preco_ml: 100, permalink: null }],
    catalogo_ml_snapshot: [],
    ml_pricing_groups: [{ id: 'G1', produto_id: 'P1', current_version: 2, state, observed_at: '2026-09-07T00:00:00Z' }],
    ml_pricing_group_members: [
      { group_id: 'G1', version: 2, ml_item_id: 'MLB1', variation_id: '', catalog_listing: false },
      { group_id: 'G1', version: 2, ml_item_id: 'MLB2', variation_id: '', catalog_listing: true },
    ],
    ml_pricing_group_revisions: [{ group_id: 'G1', version: 2, catalog_synchronized_pair: true }],
  };
  const client = { from(table) {
    return {
      select() { return this; }, in() { return this; }, eq() { return this; }, neq() { return this; },
      or(filter) { calls.push(filter); return this; },
      then(resolve) { return Promise.resolve({ data: rows[table], error: null }).then(resolve); },
    };
  } };
  return { client, rows, calls };
}

test('DTO preserva anúncio e acrescenta grupo atual sem carregar revisões históricas', async () => {
  const f = fixture(); const dto = (await loadProductMlListings(f.client, ['P1'])).get('P1')[0];
  assert.equal(dto.itemId, 'MLB1'); assert.equal(dto.status, 'ativo'); assert.equal(dto.price, 100);
  assert.equal(dto.pricingGroup.groupId, 'G1'); assert.equal(dto.pricingGroup.version, 2);
  assert.equal(dto.pricingGroup.catalogSynchronizedPair, true); assert.equal(dto.pricingGroup.members.length, 2);
  assert.deepEqual(f.calls, ['and(group_id.eq.G1,version.eq.2)']);
});
test('grupo não revalidado conserva membros, mas não declara sincronismo vigente', async () => {
  const f = fixture('unverified'); const group = (await loadProductMlListings(f.client, ['P1'])).get('P1')[0].pricingGroup;
  assert.equal(group.catalogSynchronizedPair, false); assert.equal(group.members.length, 2);
});
test('anúncio sem grupo não recebe vínculo fabricado', async () => {
  const f = fixture(); f.rows.ml_pricing_groups = [];
  assert.equal((await loadProductMlListings(f.client, ['P1'])).get('P1')[0].pricingGroup, null);
});
