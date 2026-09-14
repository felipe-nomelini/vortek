const assert = require('node:assert/strict');
const test = require('node:test');

const {
  batchManifestState,
  classifyMlListingUnder70,
  hasActiveMixedPriceGroup,
  preservesUntouchedListingFields,
} = require('../src/lib/ml/listing-terms-batch-core.ts');

test('seleciona somente anúncio ativo com preço positivo estritamente abaixo de 70', () => {
  assert.equal(classifyMlListingUnder70({ status: 'active', price: 69.99 }).target, true);
  assert.equal(classifyMlListingUnder70({ status: 'active', price: 70 }).target, false);
  assert.equal(classifyMlListingUnder70({ status: 'paused', price: 20 }).target, false);
  assert.equal(classifyMlListingUnder70({ status: 'active', price: 0 }).target, false);
});

test('separa troca para Clássico e frete pago pelo comprador', () => {
  const both = classifyMlListingUnder70({
    status: 'active', price: 60, listing_type_id: 'gold_pro', shipping: { free_shipping: true },
  });
  assert.equal(both.needsListingType, true);
  assert.equal(both.needsBuyerPaidShipping, true);

  const compliant = classifyMlListingUnder70({
    status: 'active', price: 60, listing_type_id: 'gold_special', shipping: { free_shipping: false },
  });
  assert.equal(compliant.reason, 'already_compliant');
});

test('bloqueia frete por conta do comprador quando a plataforma marca frete grátis obrigatório', () => {
  const result = classifyMlListingUnder70({
    status: 'active', price: 60, listing_type_id: 'gold_pro',
    shipping: { free_shipping: true }, tags: ['mandatory_free_shipping'],
  });
  assert.equal(result.target, true);
  assert.equal(result.blockedByMandatoryFreeShipping, true);
  assert.equal(result.reason, 'mandatory_free_shipping');
});

test('detecta grupo ativo que cruza o limite e preserva preço, estoque e título', () => {
  assert.equal(hasActiveMixedPriceGroup([
    { status: 'active', price: 69.99 },
    { status: 'active', price: 70 },
  ]), true);
  assert.equal(hasActiveMixedPriceGroup([
    { status: 'active', price: 20 },
    { status: 'paused', price: 200 },
  ]), false);

  assert.equal(preservesUntouchedListingFields(
    { price: 50, available_quantity: 3, title: 'Produto' },
    { price: 50, available_quantity: 3, title: 'Produto', listing_type_id: 'gold_special' },
  ), true);
  assert.equal(preservesUntouchedListingFields(
    { price: 50, available_quantity: 3, title: 'Produto' },
    { price: 51, available_quantity: 3, title: 'Produto' },
  ), false);
});

test('normaliza o estado usado no hash do manifesto', () => {
  assert.deepEqual(batchManifestState({
    id: ' MLB1 ', status: 'ACTIVE', sub_status: ['Z', 'a'], price: 12.345,
    listing_type_id: 'gold_pro', shipping: { free_shipping: true }, title: ' Produto ',
  }), {
    id: 'MLB1', status: 'active', sub_status: ['a', 'z'], price: 12.35,
    listing_type_id: 'gold_pro', free_shipping: true, title: 'Produto', sold_quantity: null,
    available_quantity: null, user_product_id: null, catalog_product_id: null,
    catalog_listing: false, last_updated: null,
  });
});
