const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const policy = require('../src/services/pricing-policy.ts');
const taxRules = require('../src/services/pricing.ts');
const core = require('../src/services/pricing-core.js');
const economy = load('src/services/pricing-economy.ts', { './pricing-policy': policy, './pricing': taxRules, './pricing-core.js': core });
const view = load('src/lib/pricing-view.ts');
const evaluatedAt = '2026-09-06T12:00:00.000Z';
const tax = { appliedRate: .04, estimatedRate: .04, confirmedRate: null, rbt12: 100000,
  bracket: 1, source: 'estimated', referenceMonth: '2026-09', manualRequired: false, warning: null };
const context = load('src/services/pricing-context.ts', {
  'server-only': {}, './pricing-economy': economy,
  './commercial-pricing-configuration': { loadCommercialPricingConfiguration: async () => ({ mlFeeFallbackRate: .14, unspecifiedShippingCost: 10 }) },
  './pricing-tax-context': { loadPricingTaxContext: async () => tax },
  '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'),
  '@/lib/dslite/supplier-policy': { loadOperationalDropshippingSupplierIds: async () => new Set() },
  '@/lib/kit-supply-source': require('./helpers/kit-supply-source-module'),
});
const sample = (i, complete = true) => context.simulateProductPricing({
  costCents: complete ? 3000 + i : null, shippingCents: 1000, priceCents: 10000 + i,
  feeRate: .14, taxContext: tax, evaluatedAt,
});
const rows = Array.from({ length: 1105 }, (_, i) => ({
  product: { id: String(i), sku: String(i).padStart(5, '0'), estoque: 2, ml_status: 'sem_anuncio', pricing: sample(i, i !== 1104) },
  preferredOffer: null, offersCount: 0,
}));

const projectionMigration = require('node:fs').readFileSync(
  require('node:path').join(process.cwd(), 'supabase/migrations/20260922160000_ui_catalog_read_models.sql'), 'utf8',
);
const projectionWorker = require('node:fs').readFileSync(
  require('node:path').join(process.cwd(), 'src/services/ui-read-model.ts'), 'utf8',
);

test('filtro, ordenação e resumo são calculados antes da paginação no banco', () => {
  assert.match(projectionMigration, /with filtered as \(/);
  assert.match(projectionMigration, /ordered as \(/);
  assert.match(projectionMigration, /position > v_offset and position <= v_offset \+ v_page_size/);
  assert.match(projectionMigration, /'summary', jsonb_build_object/);
  assert.match(projectionMigration, /'total', \(select count\(\*\) from filtered\)/);
});

test('inconclusivo permanece null e não contamina média nem vira receita zero', () => {
  assert.match(projectionMigration, /exists\(select 1 from filtered where pricing_inconclusive\) then null/);
  assert.match(projectionMigration, /round\(avg\(profit\),2\)/);
  assert.match(projectionMigration, /count\(profit\)/);
  assert.equal(view.pricingView(rows.at(-1).product.pricing).cost, null);
  assert.equal(view.pricingView(undefined).profit, null);
});

test('worker processa a fonte econômica em lotes canônicos de até 100 produtos', () => {
  assert.match(projectionWorker, /for \(let offset = 0; offset < productRows\.length; offset \+= 100\)/);
  assert.match(projectionWorker, /productRows\.slice\(offset, offset \+ 100\)/);
  assert.match(projectionWorker, /loadProductPricing\(client, batch, \{ requestContext, evidence \}\)/);
});

test('simulador autentica antes do contexto e rejeita campos legados sem efeitos', async () => {
  let allowed = false; let reads = 0;
  const route = load('src/app/api/configuracoes/comercial/simular/route.ts', {
    '@/lib/configuracoes/contracts': require('../src/lib/configuracoes/contracts.ts'),
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } }, zod: require('zod'),
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => { reads++; return {}; } },
    '@/lib/auth/admin': { requireAdminUser: async () => allowed ? { ok: true } : { ok: false, response: new Response(null, { status: 403 }) } },
    '@/services/pricing-tax-context': { loadPricingTaxContext: async () => tax },
    '@/services/pricing-context': context,
  });
  const input = { costCents: 4000, shippingCents: 1000, feeRate: .14, priceCents: 10000 };
  const request = data => new Request('http://localhost/simular', { method: 'POST', body: JSON.stringify(data) });
  assert.equal((await route.POST(request(input))).status, 403); assert.equal(reads, 0);
  allowed = true;
  assert.equal((await route.POST(request({ ...input, minProfit: 20 }))).status, 422); assert.equal(reads, 0);
  const response = await route.POST(request(input)); const payload = await response.json();
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.equal(payload.pricing.current.memory.resultCents, context.simulateProductPricing({ ...input, taxContext: tax, evaluatedAt }).current.memory.resultCents);
  assert.equal(payload.pricing.target.priceCents, context.simulateProductPricing({ ...input, taxContext: tax, evaluatedAt }).target.priceCents);
  assert.equal(payload.pricing.current.memory.scenario, 'simulation');
});

test('PDF usa uma única leitura completa, inclusive com economia inconclusiva', async () => {
  let reads = 0;
  const pdfLib = require('pdf-lib');
  const route = load('src/app/api/produtos/exportar-pdf/route.ts', {
    'node:fs/promises': require('node:fs/promises'), 'node:path': { default: require('node:path') }, 'pdf-lib': pdfLib,
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/services/product-list': { getProductListResponse: async (_, allRows) => {
      reads++; assert.equal(allRows, true);
      return Response.json({ data: [rows[0], rows.at(-1)], total: 2, fornecedores: [] });
    } },
    '@/lib/pricing-view': view, '@/theme/bentevi': require('../src/theme/bentevi.ts'),
    '@/lib/commercial-pricing': require('../src/lib/commercial-pricing.ts'),
  });
  const response = await route.GET(new Request('http://localhost/api/produtos/exportar-pdf'));
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  const document = await pdfLib.PDFDocument.load(await response.arrayBuffer());
  assert.ok(document.getPageCount() > 0);
});

test('PDF de Anúncios não reconsulta todo o conjunto a cada página', async () => {
  let reads = 0; const pdfLib = require('pdf-lib');
  const route = load('src/app/api/anuncios/exportar-pdf/route.ts', {
    'node:fs/promises': require('node:fs/promises'), 'node:path': { default: require('node:path') }, 'pdf-lib': pdfLib,
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/services/ml-listings-query': { getMlListingResponse: async (_, allRows) => {
      reads++; assert.equal(allRows, true);
      return Response.json({ data: [{ itemId: 'MLB_TEST', title: 'Amostra', price: 100, profit: null, marginPercent: null }], total: 1 });
    } },
    '@/theme/bentevi': require('../src/theme/bentevi.ts'),
  });
  const response = await route.GET(new Request('http://localhost/api/anuncios/exportar-pdf'));
  assert.equal(response.status, 200); assert.equal(reads, 1);
  const document = await pdfLib.PDFDocument.load(await response.arrayBuffer());
  assert.ok(document.getPageCount() > 0);
});
