const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const qty = require('../src/lib/ml/quantity-pricing.ts');

for (const flag of ['apply_quantity_pricing', 'update_quantity_pricing']) {
  for (const value of [true, 'true', 1, '1']) {
    test(`reconhece e aposenta ${flag}=${JSON.stringify(value)} sem alterar entrada`, () => {
      const input = { [flag]: value, base_price_for_quantity_pricing: 100, apply_quantity: true, apply_status: true, source: 'historico' };
      const snapshot = structuredClone(input);
      const output = qty.retireQuantityPricingPayload(input);
      assert.equal(qty.hasRetiredQuantityPricing(input), true);
      assert.equal(output.quantity_pricing_retirement.code, 'quantity_pricing_retired');
      assert.equal(output.apply_quantity, true); assert.equal(output.apply_status, true);
      assert.equal(output.source, 'historico');
      assert.equal(output[flag], undefined); assert.equal(output.base_price_for_quantity_pricing, undefined);
      assert.deepEqual(input, snapshot); assert.deepEqual(qty.retireQuantityPricingPayload(output), output);
    });
  }
}
test('preço base auxiliar antigo é identificado; operação normal não vira atacado', () => {
  assert.equal(qty.hasRetiredQuantityPricing({ base_price_for_quantity_pricing: 100 }), true);
  for (const value of [false, 'false', 0, '0', undefined]) {
    assert.equal(qty.hasRetiredQuantityPricing({ apply_quantity_pricing: value, apply_quantity: true }), false);
  }
});
test('módulo não exporta cálculo, recomendação ou writer de atacado', () => {
  for (const symbol of ['applyItemQuantityPricing', 'previewItemQuantityPricing', 'buildQuantityPricingPreview', 'buildQuantityPricingPayload']) {
    assert.equal(qty[symbol], undefined);
  }
});
test('preserva consulta de descontos remotos percentuais e absolutos', () => {
  const conditions = { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 3 };
  const found = qty.extractQuantityPricingTiers({
    price_per_quantity: [{ id: 'p', type: 'discount_percentage', percentage: 3, conditions }],
    prices: [{ id: 'a', type: 'standard', amount: 95, conditions: { ...conditions, min_purchase_unit: 5 } }],
  }, 100);
  assert.deepEqual(qty.serializeQuantityPricingTiers(found).map(t => [t.min_purchase_unit, t.amount, t.pricing_model]),
    [[3, 97, 'percentage'], [5, 95, 'absolute']]);
  assert.deepEqual(qty.extractQuantityPricingTiers({}, 100), []);
});
for (const endpoint of ['aplicar-atacado', 'atacado-preview']) {
  for (const authenticated of [false, true]) {
    test(`${endpoint}: autenticação e encerramento antes de efeitos`, async () => {
      const route = load(`src/app/api/ml/anuncio/${endpoint}/route.ts`, {
        'next/server': { NextResponse: { json: (body, opts) => Response.json(body, opts) } },
        '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'test' } : null } }) } }),
          createServiceClient() { throw Error('Efeito inesperado'); } },
      });
      const response = await route.POST({ json() { throw Error('Payload não deve ser lido'); } });
      assert.equal(response.status, authenticated ? 410 : 401);
      if (authenticated) assert.equal((await response.json()).code, 'quantity_pricing_retired');
    });
  }
}
test('nenhum consumidor operacional recomenda ou publica faixas', () => {
  for (const path of ['src/services/mercadolibre.ts', 'src/app/api/ml/anuncio/criar/route.ts',
    'src/app/api/ml/anuncio/atualizar-preco/route.ts', 'src/app/api/ml/anuncio/atualizar-preco/status/route.ts',
    'src/app/api/sync/anuncios/publish/route.ts']) {
    assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /setItemQuantityPricing|previewItemQuantityPricing|price-per-quantity|prices-per-quantity|apply_quantity_pricing: true/);
  }
});
test('carregador comercial não consulta tabela histórica', async () => {
  const tables = [];
  const { loadCommercialPricingConfiguration } = load('src/services/commercial-pricing-configuration.ts', { 'server-only': {} });
  const config = await loadCommercialPricingConfiguration({ from(table) {
    tables.push(table); assert.equal(table, 'configuracoes');
    return { select() { return this; }, maybeSingle: async () => ({ data: {
      pricing_ml_fee_fallback_rate: .15, pricing_unspecified_shipping_cost: 30, product_inactive_cost_threshold: 2000,
    }, error: null }) };
  } });
  assert.deepEqual(tables, ['configuracoes']); assert.equal(config.quantityPricingRanges, undefined);
});

test('Comercial salva os três parâmetros restantes e rejeita contrato antigo antes de persistir', async () => {
  const contracts = require('../src/lib/configuracoes/contracts.ts');
  const calls = []; const audits = [];
  const config = { mlFeeFallbackRate: .15, unspecifiedShippingCost: 30, inactiveCostThreshold: 2000 };
  const route = load('src/app/api/configuracoes/comercial/route.ts', {
    'next/server': { NextResponse: { json: (body, opts) => Response.json(body, opts) } },
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => ({
      rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; },
    }) },
    '@/lib/auth/admin': { requireAdminUser: async () => ({ ok: true, user: { id: 'test' }, nome: 'Teste' }) },
    '@/lib/configuracoes/contracts': contracts,
    '@/services/commercial-pricing-configuration': { loadCommercialPricingConfiguration: async () => config },
    '@/services/pricing-tax-context': { loadPricingTaxContext: async () => ({ appliedRate: .04 }) },
    '@/services/configuration-audit': { recordConfigurationAudit: async (_, __, entries) => audits.push(...entries) },
    '@/services/pricing-policy': require('../src/services/pricing-policy.ts'),
  });
  const input = { mlFeeFallbackPercent: 15, unspecifiedShippingCost: 30, inactiveCostThreshold: 2000 };
  const rejected = await route.PUT({ json: async () => ({ ...input, quantityPricingTiers: [{ position: 1, minPurchaseUnit: 3, discountPercent: 3 }] }) });
  assert.equal(rejected.status, 422); assert.equal(calls.length, 0);
  const saved = await route.PUT({ json: async () => input });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).quantityPricingTiers, undefined);
  assert.deepEqual(calls[0].args, { p_ml_fee_fallback_rate: .15, p_unspecified_shipping_cost: 30, p_inactive_cost_threshold: 2000 });
  assert.equal(audits.length, 3);
  assert.ok(audits.every(a => !a.key.includes('quantity')));
  assert.equal((await (await route.GET()).json()).quantityPricingTiers, undefined);
});
test('consulta de fila cancelada é terminal e não consulta ML nem recomendações', async () => {
  const route = load('src/app/api/ml/anuncio/atualizar-preco/status/route.ts', {
    'next/server': { NextResponse: { json: (body, opts) => Response.json(body, opts) } },
    '@/lib/supabase': {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test' } } }) } }),
      createServiceClient: () => ({ from: () => ({ select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: { id: 'old', status: 'cancelled', last_error: 'quantity_pricing_retired', payload: {} }, error: null }),
      }) }),
    },
    '@/services/integration': { fetchMLResult() { throw Error('Consulta ML inesperada'); } },
  });
  const response = await route.GET(new Request('https://dev.bentevi.shop/api/ml/anuncio/atualizar-preco/status?outboxId=old'));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.status, 'cancelled');
  assert.equal(body.phase, 'cancelado'); assert.equal(body.result, null);
});
test('migration substitui assinatura e preserva tabela/auditoria históricas', () => {
  const sql = fs.readFileSync('supabase/migrations/20260906130000_bnt_canon_qty_01_retire_quantity_pricing.sql', 'utf8');
  assert.match(sql, /drop function public.save_commercial_pricing_configuration\(numeric,numeric,numeric,jsonb\)/);
  assert.doesNotMatch(sql, /delete from|truncate|drop table|p_quantity_tiers/i);
  assert.match(sql, /grant execute[^;]+to service_role/);
  assert.match(sql, /revoke all[^;]+from public, anon, authenticated/);
  assert.match(sql, /set search_path to 'pg_catalog', 'pg_temp'/);
});
