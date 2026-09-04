const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const contracts = require('../src/lib/configuracoes/contracts.ts');
const { resolveMlFee } = require('../src/lib/commercial-pricing.ts');

const validConfiguration = {
  mlFeeFallbackPercent: 15,
  unspecifiedShippingCost: 30,
  inactiveCostThreshold: 2000,
  costTiers: [
    { position: 1, maxCost: 400, marginPercent: 15, minProfit: 20 },
    { position: 2, maxCost: 1000, marginPercent: 20, minProfit: 60 },
    { position: 3, maxCost: null, marginPercent: 25, minProfit: 150 },
  ],
  quantityPricingTiers: [
    { position: 1, minPurchaseUnit: 3, discountPercent: 3 },
    { position: 2, minPurchaseUnit: 5, discountPercent: 4 },
    { position: 3, minPurchaseUnit: 10, discountPercent: 5 },
  ],
};

test('contrato comercial aceita a política vigente e rejeita faixas ambíguas', () => {
  assert.equal(contracts.commercialConfigurationSchema.safeParse(validConfiguration).success, true);
  assert.equal(contracts.commercialConfigurationSchema.safeParse({
    ...validConfiguration,
    costTiers: validConfiguration.costTiers.map((tier, index) => (
      index === 1 ? { ...tier, maxCost: 300 } : tier
    )),
  }).success, false);
  assert.equal(contracts.commercialConfigurationSchema.safeParse({
    ...validConfiguration,
    quantityPricingTiers: [
      validConfiguration.quantityPricingTiers[0],
      { ...validConfiguration.quantityPricingTiers[1], discountPercent: 2 },
    ],
  }).success, false);
});

test('taxa observada, inclusive zero, prevalece sobre o fallback', () => {
  assert.equal(resolveMlFee(0, 0.15), 0);
  assert.equal(resolveMlFee(0.17, 0.15), 0.17);
  assert.equal(resolveMlFee(null, 0.12), 0.12);
  assert.equal(resolveMlFee('inválida', 0.12), 0.12);
});

test('migration protege tabelas e limita a mutação ao RPC administrativo', () => {
  const migration = read('supabase/migrations/20260904223000_bnt_cfg_03_commercial_pricing.sql');
  assert.match(migration, /create table if not exists public\.pricing_cost_tiers/);
  assert.match(migration, /create table if not exists public\.ml_quantity_pricing_tiers/);
  assert.match(migration, /create or replace function public\.save_commercial_pricing_configuration/);
  assert.match(migration, /security definer/);
  assert.match(migration, /grant execute[^;]+to service_role/s);
  assert.match(migration, /enable row level security/g);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]+service_role/i);
});

test('salvamento comercial não dispara recálculo, publicação ou alteração de produto', () => {
  const route = read('src/app/api/configuracoes/comercial/route.ts');
  const ui = read('src/components/configuracoes/ComercialTab.tsx');
  const notifications = read('src/components/configuracoes/NotificacoesTab.tsx');
  const page = read('src/app/(app)/configuracoes/page.tsx');

  assert.match(route, /save_commercial_pricing_configuration/);
  assert.match(route, /recordConfigurationAudit/);
  assert.doesNotMatch(route, /from\(["']produtos["']\)|fetchML|outbox|publish/i);
  assert.match(ui, /próximos cálculos/i);
  assert.match(ui, /Simulador/);
  assert.doesNotMatch(notifications, /margem_lucro|Margem de lucro/);
  assert.match(page, /key: "comercial"/);
});
