const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const guard = require('../src/lib/ml/pricing-execution.js');
const selection = require('../src/lib/ml/automatic-pricing-selection.ts');
const fs = require('node:fs');
const ts = require('typescript');

function guardedModule(path, dependencies = {}) {
  const imports = ts.preProcessFile(fs.readFileSync(path, 'utf8')).importedFiles;
  const stubs = Object.fromEntries(imports.map(i => [i.fileName, {}]));
  return load(path, { ...stubs, '@/lib/ml/pricing-execution': guard,
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) } }),
      createServiceClient: () => ({ from() { throw Error('consulta/escrita inesperada'); } }) }, ...dependencies });
}

for (const path of ['src/app/api/ml/anuncio/criar/route.ts', 'src/app/api/ml/anuncio/atualizar-preco/route.ts', 'src/app/api/catalogo/optin/route.ts']) {
  test(`${path}: bloqueio explícito antes do payload e de efeitos`, async () => {
    const route = guardedModule(path);
    const response = await route.POST({ json() { throw Error('payload não deve ser processado'); } });
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'pricing_execution_not_ready');
  });
}

test('cadastro não persiste preço enviado no payload', async () => {
  const route = guardedModule('src/app/api/produtos/route.ts');
  const response = await route.POST({ json: async () => ({ custom_price: 100 }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'pricing_execution_not_ready');
});

test('edição de preço rejeita antes de update/enqueue', async () => {
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'P1', custom_price: 100 }, error: null }) };
  const route = guardedModule('src/app/api/produtos/[id]/route.ts', {
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test' } } }) } }),
      createServiceClient: () => ({ from: () => query }) },
  });
  const response = await route.PATCH({ json: async () => ({ custom_price: 200 }) }, { params: Promise.resolve({ id: 'P1' }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'pricing_execution_not_ready');
});

test('transporte não permite contornar rotas para criar, reprecificar ou aplicar atacado', async () => {
  const transport = guardedModule('src/services/mercadolibre.ts');
  assert.equal(transport.setItemQuantityPricing, undefined);
  for (const execute of [() => transport.createListing({}), () => transport.updateItemPrice('MLB1', 100)]) {
    await assert.rejects(execute, /pricing_execution_not_ready/);
  }
});

test('scripts comerciais legados falham no primeiro comando, antes de ambiente/clientes', () => {
  for (const name of ['create-ml-batch-from-manifest', 'prepare-ml-anuncio-batches', 'create-profitable-shelf-listings',
    'prepare-profitable-shelf-2', 'apply-supplier-pricing-campaign']) {
    const source = fs.readFileSync(`scripts/${name}.js`, 'utf8');
    const parsed = ts.createSourceFile(`${name}.js`, source, ts.ScriptTarget.Latest, true);
    const first = parsed.statements[0].getText(parsed);
    assert.match(first, /pricing-execution\.js.*assertPricingExecutionReady/);
    // Executa só o primeiro comando isolado, nunca o script operacional.
    assert.throws(() => new Function('require', first)(() => guard), /pricing_execution_not_ready/);
  }
});

test('sync de anúncios não possui mais recálculo/gravação de preço por frete', () => {
  const source = fs.readFileSync('src/app/api/sync/anuncios/route.ts', 'utf8');
  assert.doesNotMatch(source, /calculateSuggestedPrice|configuredShippingPrice|productPatch\.custom_price/);
  assert.match(source, /productPatch\.ml_shipping/);
});

test('mudança de custo e kit não gravam preço nem enfileiram automação', async () => {
  const { enqueueAutomaticPricesForCostChanges } = load('src/lib/ml/automatic-pricing.ts', {
    '@/lib/ml/automatic-pricing-selection': selection, './pricing-execution.js': guard,
  });
  const result = await enqueueAutomaticPricesForCostChanges({ from() { throw Error('escrita proibida'); } },
    [{ productId: 'P1', previous: { custo: 10 }, next: { custo: 20 } }], { forceProductIds: ['KIT'] });
  assert.equal(result.productsUpdated, 0); assert.equal(result.outboxEnqueued, 0);
  assert.equal(result.skipped, 2); assert.deepEqual(result.errors, []);
  assert.equal(result.blockedReason, 'pricing_execution_not_ready');
});

function worker(row, executionGuard = guard) {
  const tables = { anuncios_ml_outbox: [structuredClone(row)], produtos: [{ id: 'P1', ativo: true }],
    anuncios_ml: [{ ml_item_id: 'MLB1' }], catalogo_ml_snapshot: [{ ml_item_id: 'MLB1', status: 'active' }] };
  const requests = []; const stock = [];
  const client = { from(table) {
    const filters = []; let patch = null;
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(k, v) { filters.push(r => r[k] === v); return this; },
      in(k, v) { filters.push(r => v.includes(r[k])); return this; },
      lte(k, v) { filters.push(r => !r[k] || r[k] <= v); return this; },
      update(v) { patch = v; return this; },
      then(resolve) {
        const rows = (tables[table] || []).filter(r => filters.every(f => f(r)));
        if (patch) rows.forEach(r => Object.assign(r, structuredClone(patch)));
        return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve);
      },
    }; return query;
  } };
  const route = load('src/app/api/sync/anuncios/publish/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase': { createServiceClient: () => client },
    '@/lib/ml/pricing-execution': executionGuard,
    '@/lib/ml/quantity-pricing': require('../src/lib/ml/quantity-pricing.ts'),
    '@/services/integration': { fetchMLResult: async (url, options = {}) => {
      requests.push({ url, ...options }); return { ok: true, data: { id: 'MLB1', status: 'paused', price: 77 } };
    } },
    '@/services/mercadolibre': { setItemQuantityPricing() { throw Error('atacado proibido'); } },
    '@/lib/sync/domain-lock': { acquireDomainLock: async () => ({ acquired: true, ownerToken: 'test-lock' }), releaseDomainLock: async () => {} },
    '@/lib/ml/reconcile-anuncio': { reconcileAnuncioMlFromItem: async () => ({ ok: true }) },
    '@/lib/ml/status': { mapMlStatusToLocalStatus: () => 'pausado' },
    '@/lib/ml/stock-publish': { loadMlStockContext: async () => ({}), publishAndVerifyMlStock: async (...args) => { stock.push(args); return { ok: true }; } },
    '@/lib/sync/ml-publish-outbox': { enqueueMlPublishOutbox() { throw Error('seed inesperado'); } },
    '@/lib/orders/fulfillment-capacity-loader': { loadProductFulfillmentCapacities() { throw Error('seed inesperado'); } },
    '@/lib/ml/listing-deletion': { isMlListingDeletionPayload: () => false },
    '@/lib/ml/operational-listing': { classifyMlPublishEligibility: () => ({ eligible: true }) },
    '@/lib/supplier-deactivation': { isSafeInactiveSupplierPause: () => false },
  });
  return { route, tables, stock, requests };
}

const priceRow = { id: 'Q1', produto_id: 'P1', ml_item_id: 'MLB1', desired_price: 100, status: 'pending',
  attempts: 0, payload: { apply_price: true, apply_quantity_pricing: true, apply_quantity: false, apply_status: false } };
// Request isolado: a autenticação é igual à configuração do processo, sem ler ou imprimir seu valor.
const request = () => ({ headers: { get: () => process.env.API_SECRET_KEY }, json: async () => ({}) });

test('fila antiga só de preço é cancelada sem chamada ML e sem retry', async () => {
  const h = worker(priceRow); const response = await h.route.POST(request());
  assert.equal(response.status, 200);
  assert.equal(h.tables.anuncios_ml_outbox[0].status, 'cancelled');
  assert.equal(h.tables.anuncios_ml_outbox[0].attempts, 0);
  assert.equal(h.tables.anuncios_ml_outbox[0].payload.pricing_block.code, 'pricing_execution_not_ready');
  assert.equal(h.requests.length, 0); assert.equal(h.stock.length, 0);
});

test('fila mista executa estoque/status e registra preço bloqueado, sem divergência de preço artificial', async () => {
  const h = worker({ ...priceRow, desired_quantity: 8, desired_status: 'pausado',
    payload: { ...priceRow.payload, apply_quantity: true, apply_status: true } });
  const response = await h.route.POST(request()); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.success, true, JSON.stringify(body.errors));
  const row = h.tables.anuncios_ml_outbox[0];
  assert.equal(row.status, 'done'); assert.equal(row.payload.pricing_block.code, 'pricing_execution_not_ready');
  assert.equal(h.stock.length, 1); assert.equal(h.stock[0][1], 8);
  assert.ok(h.requests.some(r => r.method === 'PUT' && JSON.parse(r.body).status === 'paused'));
  assert.ok(h.requests.every(r => !r.body || !('price' in JSON.parse(r.body))));
  assert.equal(body.records.retry, 0);
  assert.notEqual(row.payload.publish_progress.last_operation, 'price_reconcile_mismatch');
});

for (const gate of [guard, { getPricingExecutionBlock: () => null }]) {
  for (const flag of ['apply_quantity_pricing', 'update_quantity_pricing']) {
    test(`aposentadoria permanente no worker: ${flag}, gate ${!!gate.getPricingExecutionBlock()}`, async () => {
      const h = worker({ ...priceRow, desired_price: null,
        payload: { apply_price: false, [flag]: '1', apply_quantity: false, apply_status: false } }, gate);
      for (let i = 0; i < 2; i++) {
        const response = await h.route.POST(request());
        assert.equal(response.status, 200);
      }
      const row = h.tables.anuncios_ml_outbox[0];
      assert.equal(row.status, 'cancelled'); assert.equal(row.last_error, 'quantity_pricing_retired');
      assert.equal(row.attempts, 0); assert.equal(h.requests.length, 0); assert.equal(h.stock.length, 0);
    });
  }
  test(`fila mista sem preço preserva estoque/status com gate ${!!gate.getPricingExecutionBlock()}`, async () => {
    const h = worker({ ...priceRow, desired_price: null, desired_quantity: 10, desired_status: 'pausado',
      payload: { apply_price: false, update_quantity_pricing: true, apply_quantity: true, apply_status: true } }, gate);
    const response = await h.route.POST(request());
    assert.equal(response.status, 200);
    const row = h.tables.anuncios_ml_outbox[0];
    assert.equal(row.status, 'done');
    assert.equal(row.payload.quantity_pricing_retirement.code, 'quantity_pricing_retired');
    assert.equal(row.payload.update_quantity_pricing, undefined);
    assert.equal(h.stock.length, 1); assert.equal(h.stock[0][1], 10);
    assert.ok(h.requests.every(r => !r.url.includes('quantity')));
  });
}
