const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  applyItemQuantityPricing,
  buildQuantityPricingPayload,
  buildQuantityPricingPreview,
  extractQuantityPricingTiers,
  previewItemQuantityPricing,
  quantityPricingTiersMatch,
  serializeQuantityPricingTiers,
} = require('../src/lib/ml/quantity-pricing.ts');

const QUANTITY_RANGES = [
  { position: 1, minPurchaseUnit: 3, fallbackDiscountPercentage: 3 },
  { position: 2, minPurchaseUnit: 5, fallbackDiscountPercentage: 4 },
  { position: 3, minPurchaseUnit: 10, fallbackDiscountPercentage: 5 },
];

function recommendationData(percentages = [4.340541, 8.064865, 9.2]) {
  return {
    recommendations: [3, 5, 10].map((quantity, index) => ({
      quantity,
      amount: [95.66, 91.94, 90.8][index],
      is_incoherent_quantity: false,
      discount: { percentage: percentages[index] },
    })),
  };
}

function currentPrices(overrides = {}) {
  return {
    version: 7,
    presentation: { display_currency: 'BRL' },
    prices: [
      {
        id: 'standard-1',
        type: 'standard',
        amount: 100,
        currency_id: 'BRL',
        conditions: { context_restrictions: [] },
      },
      {
        id: 'legacy-3',
        type: 'standard',
        amount: 97,
        currency_id: 'BRL',
        conditions: {
          context_restrictions: ['channel_marketplace', 'user_type_business'],
          min_purchase_unit: 3,
        },
      },
    ],
    price_per_quantity: [],
    ...overrides,
  };
}

function percentageReadback(percentages = [4.340541, 8.064865, 9.2]) {
  return {
    presentation: { display_currency: 'BRL' },
    prices: [currentPrices().prices[0]],
    price_per_quantity: [3, 5, 10].map((quantity, index) => ({
      id: String(index + 20),
      type: 'discount_percentage',
      percentage: percentages[index],
      conditions: {
        context_restrictions: ['channel_marketplace', 'user_type_business'],
        min_purchase_unit: quantity,
        eligible: true,
      },
    })),
  };
}

test('converte recomendações do ML em uma única regra percentual 3/5/10', () => {
  const preview = buildQuantityPricingPreview(recommendationData(), 200, 100, QUANTITY_RANGES, 'BRL');

  assert.equal(preview.ok, true);
  assert.equal(preview.source, 'mercado_livre');
  assert.deepEqual(preview.tiers.map((tier) => ({
    quantity: tier.minPurchaseUnit,
    percentage: tier.discountPercentage,
  })), [
    { quantity: 3, percentage: 4.340541 },
    { quantity: 5, percentage: 8.064865 },
    { quantity: 10, percentage: 9.2 },
  ]);
});

test('usa a política atual 3/4/5 somente quando recomendações respondem 204', () => {
  const preview = buildQuantityPricingPreview(null, 204, 100, QUANTITY_RANGES, 'BRL');

  assert.equal(preview.ok, true);
  assert.equal(preview.source, 'fallback_204');
  assert.deepEqual(preview.tiers.map((tier) => tier.discountPercentage), [3, 4, 5]);
});

test('rejeita recomendações não progressivas e não inventa percentuais', () => {
  const preview = buildQuantityPricingPreview(
    recommendationData([4, 4, 5]),
    200,
    100,
    QUANTITY_RANGES,
    'BRL',
  );

  assert.equal(preview.ok, false);
  assert.equal(preview.code, 'quantity_pricing_recommendation_not_progressive');
  assert.deepEqual(preview.tiers, []);
});

test('descarta faixa incoerente informada pelo provedor', () => {
  const data = recommendationData();
  data.recommendations[1].is_incoherent_quantity = true;
  const preview = buildQuantityPricingPreview(data, 200, 100, QUANTITY_RANGES, 'BRL');

  assert.equal(preview.ok, true);
  assert.deepEqual(preview.tiers.map((tier) => tier.minPurchaseUnit), [3, 10]);
});

test('payload oficial preserva id existente e coincide com a prévia', () => {
  const preview = buildQuantityPricingPreview(recommendationData(), 200, 100, QUANTITY_RANGES, 'BRL');
  const payload = buildQuantityPricingPayload(preview.tiers, {
    price_per_quantity: [{
      id: 'existing-3',
      type: 'discount_percentage',
      percentage: 2,
      conditions: {
        context_restrictions: ['channel_marketplace', 'user_type_business'],
        min_purchase_unit: 3,
      },
    }],
  });

  assert.equal(payload.price_per_quantity[0].id, 'existing-3');
  assert.equal(payload.price_per_quantity[0].type, 'discount_percentage');
  assert.equal(payload.price_per_quantity[0].conditions.eligible, true);
  assert.deepEqual(
    payload.price_per_quantity.map((tier) => [tier.conditions.min_purchase_unit, tier.percentage]),
    preview.tiers.map((tier) => [tier.minPurchaseUnit, tier.discountPercentage]),
  );
});

test('publica com recomendação, x-version, migra legado e valida read-back', async () => {
  const calls = [];
  const requester = async (path, options = {}) => {
    calls.push({ path, options });
    if (calls.length === 1) return { ok: true, status: 200, data: currentPrices(), error: null };
    if (calls.length === 2) return { ok: true, status: 200, data: recommendationData(), error: null };
    if (calls.length === 3) return { ok: true, status: 200, data: {}, error: null };
    return { ok: true, status: 200, data: percentageReadback(), error: null };
  };

  const result = await applyItemQuantityPricing(requester, 'MLB123', 100, QUANTITY_RANGES);

  assert.equal(result.ok, true);
  assert.equal(result.recommendationSource, 'mercado_livre');
  assert.equal(calls[0].path, '/items/MLB123/prices?display_version=true');
  assert.equal(calls[1].path, '/prices-per-quantity/v1/recommendations');
  assert.equal(calls[2].path, '/items/MLB123/prices/price-per-quantity?remove-absolute-pxq=true');
  assert.equal(calls[2].options.headers['X-Version'], '7');
  assert.equal(calls[3].path, '/items/MLB123/prices');
  const payload = JSON.parse(calls[2].options.body);
  assert.deepEqual(
    payload.price_per_quantity.map((tier) => [tier.conditions.min_purchase_unit, tier.percentage]),
    result.tiersExpected.map((tier) => [tier.minPurchaseUnit, tier.discountPercentage]),
  );
});

test('bloqueia preço líquido B2B sem chamar recomendação ou escrita', async () => {
  let calls = 0;
  const requester = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      error: null,
      data: currentPrices({
        prices: [
          currentPrices().prices[0],
          {
            amount: 95,
            amount_tax_inclusion_type: 'net',
            conditions: {
              context_restrictions: ['channel_marketplace', 'user_type_business'],
              min_purchase_unit: 1,
            },
          },
        ],
      }),
    };
  };

  const result = await applyItemQuantityPricing(requester, 'MLB123', 100, QUANTITY_RANGES);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'quantity_pricing_net_price_incompatible');
  assert.equal(result.httpStatus, 422);
  assert.equal(calls, 1);
});

test('trata mudança concorrente de preço como conflito retomável', async () => {
  const requester = async () => ({
    ok: true,
    status: 200,
    data: currentPrices(),
    error: null,
  });

  const result = await applyItemQuantityPricing(requester, 'MLB123', 101, QUANTITY_RANGES);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'quantity_pricing_base_price_conflict');
  assert.equal(result.httpStatus, 409);
});

test('preserva conflito x-version retornado pelo provedor', async () => {
  let call = 0;
  const requester = async () => {
    call += 1;
    if (call === 1) return { ok: true, status: 200, data: currentPrices({ prices: [currentPrices().prices[0]] }), error: null };
    if (call === 2) return { ok: true, status: 200, data: recommendationData(), error: null };
    return {
      ok: false,
      status: 409,
      data: null,
      error: { code: 'item.version', message: 'version changed' },
    };
  };

  const result = await applyItemQuantityPricing(requester, 'MLB123', 100, QUANTITY_RANGES);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'quantity_pricing_version_conflict');
  assert.equal(result.httpStatus, 409);
});

test('falha quando read-back percentual diverge do payload publicado', async () => {
  let call = 0;
  const requester = async () => {
    call += 1;
    if (call === 1) return { ok: true, status: 200, data: currentPrices({ prices: [currentPrices().prices[0]] }), error: null };
    if (call === 2) return { ok: true, status: 200, data: recommendationData(), error: null };
    if (call === 3) return { ok: true, status: 200, data: {}, error: null };
    return { ok: true, status: 200, data: percentageReadback([4.340541, 8.064865, 8.9]), error: null };
  };

  const result = await applyItemQuantityPricing(requester, 'MLB123', 100, QUANTITY_RANGES);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'quantity_pricing_not_effective');
});

test('serializa leitura percentual e absoluta para a interface durante transição', () => {
  const percentage = extractQuantityPricingTiers(percentageReadback(), 100);
  assert.equal(quantityPricingTiersMatch(percentage, percentage), true);
  assert.deepEqual(serializeQuantityPricingTiers(percentage)[0], {
    min_purchase_unit: 3,
    discount_percent: 4.340541,
    amount: 95.66,
    currency_id: 'BRL',
    pricing_model: 'percentage',
  });

  const absolute = extractQuantityPricingTiers(currentPrices(), 100);
  assert.equal(absolute[0].pricingModel, 'absolute');
  assert.equal(absolute[0].discountPercentage, 3);
});

test('propaga seller inelegível sem criar fallback', async () => {
  const requester = async () => ({
    ok: false,
    status: 403,
    data: null,
    error: { code: 'forbidden', message: 'user is not allowed to request recommendations' },
  });

  const preview = await previewItemQuantityPricing(requester, 'MLB123', 100, QUANTITY_RANGES);
  assert.equal(preview.ok, false);
  assert.equal(preview.code, 'forbidden');
  assert.deepEqual(preview.tiers, []);
});

test('backend calcula a prévia e o browser não replica descontos', () => {
  const previewRoute = fs.readFileSync(
    path.join(__dirname, '../src/app/api/ml/anuncio/atacado-preview/route.ts'),
    'utf8',
  );
  const anunciosPage = fs.readFileSync(
    path.join(__dirname, '../src/app/(app)/anuncios/page.tsx'),
    'utf8',
  );
  const produtosPage = fs.readFileSync(
    path.join(__dirname, '../src/app/(app)/produtos/page.tsx'),
    'utf8',
  );

  assert.match(previewRoute, /previewItemQuantityPricing/);
  assert.doesNotMatch(anunciosPage, /buildWholesalePrices|basePrice\s*\*\s*0\.9[567]/);
  assert.doesNotMatch(produtosPage, /basePrice\s*\*\s*0\.9[567]/);
});
