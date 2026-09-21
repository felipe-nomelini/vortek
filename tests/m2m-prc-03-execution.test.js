const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const guard = require('../src/lib/ml/pricing-execution.js');
const fs = require('node:fs');
const ts = require('typescript');

function guardedModule(path, dependencies = {}) {
  const imports = ts.preProcessFile(fs.readFileSync(path, 'utf8')).importedFiles;
  const stubs = Object.fromEntries(imports.map(i => [i.fileName, {}]));
  return load(path, { ...stubs, '@/lib/ml/pricing-execution': guard,
    '@/services/pricing-execution-access': { configuredPricingExecutionCapability: () => ({ mode: 'disabled', enabled: false, target: null, allowedOperations: [] }) },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => ({ ok: true, userId: 'test-user' }) },
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) } }),
      createServiceClient: () => ({ from() { throw Error('consulta/escrita inesperada'); } }) }, ...dependencies });
}

for (const path of ['src/app/api/catalogo/optin/route.ts']) {
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

test('scripts comerciais encerrados foram retirados e o bloqueio de execução permanece', () => {
  for (const name of ['create-ml-batch-from-manifest', 'prepare-ml-anuncio-batches', 'create-profitable-shelf-listings',
    'prepare-profitable-shelf-2', 'apply-supplier-pricing-campaign']) {
    assert.equal(fs.existsSync(`scripts/${name}.js`), false, name);
  }
  assert.throws(() => guard.assertPricingExecutionReady(), /pricing_execution_not_ready/);
});

test('sync de anúncios não possui mais recálculo/gravação de preço por frete', () => {
  const source = fs.readFileSync('src/app/api/sync/anuncios/route.ts', 'utf8');
  assert.doesNotMatch(source, /calculateSuggestedPrice|configuredShippingPrice|productPatch\.custom_price/);
  assert.match(source, /productPatch\.ml_shipping/);
});

test('sync de custos, kits e fornecedores não chamam reprecificação', () => {
  assert.equal(fs.existsSync('src/lib/ml/automatic-pricing.ts'), false);
  for (const path of [
    'src/app/api/sync/preco-estoque/route.ts',
    'src/app/api/sync/preco-estoque-xml/route.ts',
    'src/app/api/fornecedores/[id]/status/route.ts',
    'src/app/api/produtos/[id]/fornecedores/route.ts',
  ]) {
    assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /enqueueAutomaticPricesForCostChanges|automatic-pricing/);
  }
});

function worker(row, executionGuard = guard) {
  const tables = { anuncios_ml_outbox: [structuredClone(row)], produtos: [{ id: 'P1', ativo: true }],
    anuncios_ml: [{ ml_item_id: 'MLB1' }], catalogo_ml_snapshot: [{ ml_item_id: 'MLB1', status: 'active' }] };
  const requests = []; const stock = []; const writes = [];
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
        if (patch) {
          rows.forEach(r => Object.assign(r, structuredClone(patch)));
          writes.push({ table, patch: structuredClone(patch) });
        }
        return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve);
      },
    }; return query;
  } };
  const route = load('src/app/api/sync/anuncios/publish/route.ts', {
    '@/services/pricing-dispatch': { dispatchApprovedPricingOperation: async () => { throw Error('Operação aprovada inesperada neste teste de fila legada'); } },
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
    '@/lib/ml/stock-status-policy': require('../src/lib/ml/stock-status-policy.ts'),
    '@/lib/sync/ml-publish-outbox': { enqueueMlPublishOutbox() { throw Error('seed inesperado'); } },
    '@/lib/orders/fulfillment-capacity-loader': { loadProductFulfillmentCapacities() { throw Error('seed inesperado'); } },
    '@/lib/ml/listing-deletion': { isMlListingDeletionPayload: () => false },
    '@/lib/ml/operational-listing': { classifyMlPublishEligibility: () => ({ eligible: true }) },
    '@/lib/ml/protective-stock': require('../src/lib/ml/protective-stock.ts'),
  });
  return { route, tables, stock, requests, writes };
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

test('pausa confirmada atualiza o estado usado pela lista de anúncios', async () => {
  const h = worker({ ...priceRow, desired_price: null, desired_quantity: null, desired_status: 'pausado',
    payload: { apply_price: false, apply_quantity: false, apply_status: true } });
  const response = await h.route.POST(request()); const body = await response.json();
  assert.equal(body.success, true, JSON.stringify(body.errors));
  assert.equal(h.tables.anuncios_ml_outbox[0].status, 'done');
  assert.equal(h.tables.catalogo_ml_snapshot[0].status, 'paused');
  const snapshotWrite = h.writes.findIndex(write => write.table === 'catalogo_ml_snapshot' && write.patch.status === 'paused');
  const doneWrite = h.writes.findIndex(write => write.table === 'anuncios_ml_outbox' && write.patch.status === 'done');
  assert.ok(snapshotWrite >= 0 && doneWrite > snapshotWrite, 'a fila só conclui após atualizar o estado da lista');
  assert.equal(h.requests.some(r => r.method === 'PUT' && JSON.parse(r.body).price !== undefined), false);
});

test('produto inativo ainda executa pausa protetiva com quantidade zero', async () => {
  const h = worker({ ...priceRow, desired_price: null, desired_quantity: 0, desired_status: 'pausado',
    payload: { apply_price: false, apply_quantity_pricing: false, apply_quantity: true, apply_status: true } });
  h.tables.produtos[0].ativo = false;
  const response = await h.route.POST(request());
  assert.equal(response.status, 200);
  assert.equal(h.tables.anuncios_ml_outbox[0].status, 'done');
  assert.equal(h.stock.length, 1);
  assert.equal(h.stock[0][1], 0);
  assert.ok(h.requests.some(r => r.url === '/items/MLB1' && !r.method));
  assert.equal(h.requests.some(r => r.method === 'PUT' && JSON.parse(r.body).status === 'paused'), false);
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
