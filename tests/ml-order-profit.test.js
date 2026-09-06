const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateFinalOrderProfit,
  resolveMlSellerShippingCost,
} = require('../src/lib/ml/order-profit.ts');

test('usa somente o custo final do vendedor informado pelo Mercado Livre', () => {
  const cost = resolveMlSellerShippingCost({
    senders: [
      { user_id: 10, cost: 8.19 },
      { user_id: 20, cost: 5.5 },
    ],
  }, 20);

  assert.equal(cost, 5.5);
});

test('aceita custo zero como custo final válido', () => {
  assert.equal(resolveMlSellerShippingCost({
    senders: [{ user_id: 10, cost: 0 }],
  }, 10), 0);
});

test('não inventa custo quando resposta de frete está incompleta', () => {
  assert.equal(resolveMlSellerShippingCost({ senders: [] }, 10), null);
  assert.equal(resolveMlSellerShippingCost({
    senders: [{ user_id: 10, cost: null }],
  }, 10), null);
});

test('não calcula lucro antes do custo final do frete', () => {
  assert.equal(calculateFinalOrderProfit({
    total: 89,
    productCost: 55.43,
    saleFees: 10.24,
    sellerShippingCost: null,
    tax: 3.56,
    matchedItems: 1,
  }), null);
});

test('calcula lucro final com custo real do frete', () => {
  assert.equal(calculateFinalOrderProfit({
    total: 89,
    productCost: 55.43,
    saleFees: 10.24,
    sellerShippingCost: 13.25,
    tax: 3.56,
    matchedItems: 1,
  }), 6.52);
});

test('não persiste lucro inválido quando a origem contém valor não finito', () => {
  assert.equal(calculateFinalOrderProfit({
    total: 89,
    productCost: Number.NaN,
    saleFees: 10.24,
    sellerShippingCost: 13.25,
    tax: 3.56,
    matchedItems: 1,
  }), null);
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, overrides = {}) {
  const filename = path.resolve(file), mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: mod, exports: mod.exports, Date, Intl, Map, Set,
    require: id => overrides[id] ?? require(id.startsWith('@/') ? path.resolve('src', id.slice(2)) + '.ts' : id.startsWith('.') ? path.resolve(path.dirname(filename), id) + (path.extname(id) ? '' : '.ts') : id),
  });
  return mod.exports;
}

function fixture({ variables = {}, kit = false, activeOffer = true, activeSupplier = true, taxRate = .08279935223578168, taxStatus = 'estimated' } = {}) {
  const product = { id: 'product', sku: 'VTK016034', ml_item_id: 'MLB1', custo: kit ? 24.72 : 12.36, ativo: true };
  const component = { id: 'component', sku: 'VTK003213', nome: 'Bateria', ativo: true };
  const tables = {
    produtos: [product, component],
    produto_fornecedor_ofertas: [{ id: 'offer', produto_id: kit ? component.id : product.id, custo: 12.36, estoque: 100, ativo: activeOffer, dslite_fornecedor_id: '108' }],
    fornecedores: [{ dslite_id: '108', ativo: activeSupplier }],
    catalogo_ml_snapshot: [],
    produto_kits: kit ? [{ produto_id: product.id, ativo: true }] : [],
    produto_kit_componentes: kit ? [{ kit_produto_id: product.id, componente_produto_id: component.id, quantidade: 2 }] : [],
  };
  const db = { from: table => {
    let rows = tables[table] ?? [];
    const result = () => ({ data: rows, error: null });
    const q = {
      select: () => q,
      eq: (key, value) => { rows = rows.filter(r => r[key] === value); return q; },
      in: (key, values) => { rows = rows.filter(r => values.includes(r[key])); return q; },
      then: resolve => Promise.resolve(result()).then(resolve),
      single: async () => rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'row not found' } },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    };
    return q;
  } };
  const pricing = load('src/services/pricing-context.ts', { './integration': {} });
  const kits = load('src/lib/produto-kits.ts', { '@/lib/sync/ml-publish-outbox': {} });
  const service = load('src/services/orders.ts', {
    '@/lib/supabase': { createServiceClient: () => db },
    '@/lib/produto-kits': kits,
    './integration': { fetchML: () => { throw Error('unexpected network'); } },
    './pricing-context': {
      ...pricing,
      loadPricingRuntime: async () => ({ tax: { rate: taxRate, status: taxStatus }, variableCosts: variables }),
    },
  });
  const order = { id: '2000018304422954', total_amount: 53.19, order_items: [{ item: { id: 'MLB1', seller_sku: product.sku }, quantity: 1, sale_fee: 7.45 }] };
  return { service, order, tables, calculate: (value = order, freight = 9.15) => service.calculateOrderProfit(value, null, { allowShipmentFetch: false, sellerShippingCost: freight }) };
}

test('despesa não cadastrada permite estimativa; zero confirmado e despesa informada são preservados', async () => {
  const missing = await fixture().calculate();
  assert.equal(missing.lucro, 19.82);
  assert.equal(missing.status, 'estimated');
  assert.ok(missing.reasons.includes('CUSTOS_VARIAVEIS_NAO_INFORMADOS'));
  const zero = await fixture({ variables: { product: 0 }, taxStatus: 'confirmed' }).calculate();
  assert.equal(zero.lucro, 19.82); assert.equal(zero.status, 'available');
  assert.equal((await fixture({ variables: { product: 2 } }).calculate()).lucro, 17.82);
  assert.equal((await fixture({ variables: { product: null } }).calculate()).lucro, 19.82);
});

test('despesa adicional inválida não vira zero nem valor estimado utilizável', async () => {
  for (const value of [-1, NaN, Infinity, '2']) {
    const r = await fixture({ variables: { product: value } }).calculate();
    assert.equal(r.lucro, null); assert.equal(r.status, 'inconclusive');
    assert.ok(r.reasons.includes('CUSTOS_VARIAVEIS_INVALIDOS'));
  }
});

test('venda real de kit usa duas ofertas unitárias e cobra tarifa uma vez por kit', async () => {
  const r = await fixture({ kit: true }).calculate();
  assert.equal(r.custoTotal, 24.72); assert.equal(r.taxasTotal, 7.45);
  assert.equal(r.itensEncontrados, 1); assert.equal(r.lucro, 7.46);
  assert.equal(r.status, 'estimated');
});

test('dois kits multiplicam componentes, tarifa e despesas pela quantidade correta', async () => {
  const f = fixture({ kit: true, variables: { product: 1 } });
  f.order.order_items[0].quantity = 2; f.order.total_amount = 106.38;
  const r = await f.calculate();
  assert.equal(r.custoTotal, 49.44); assert.equal(r.taxasTotal, 14.9);
  assert.equal(r.lucro, 22.08);
});

test('oferta ou fornecedor inativo não sustenta custo de kit', async () => {
  for (const options of [{ activeOffer: false }, { activeSupplier: false }]) {
    const r = await fixture({ kit: true, ...options }).calculate();
    assert.equal(r.lucro, null); assert.equal(r.itensEncontrados, 0);
    assert.ok(r.reasons.includes('CUSTO_PRODUTO_INDISPONIVEL'));
  }
});

test('kit inativo e composição não suportada mantêm diagnóstico próprio', async () => {
  const inactive = fixture({ kit: true }); inactive.tables.produto_kits[0].ativo = false;
  assert.ok((await inactive.calculate()).reasons.includes('KIT_INATIVO'));
  const composite = fixture({ kit: true }); composite.tables.produto_kit_componentes.push({ ...composite.tables.produto_kit_componentes[0] });
  assert.ok((await composite.calculate()).reasons.includes('KIT_COMPOSTO_NAO_SUPORTADO'));
});

test('ausência de frete, tarifa ou tributo não produz lucro falso', async () => {
  const f = fixture(); assert.equal((await f.calculate(f.order, null)).lucro, null);
  delete f.order.order_items[0].sale_fee;
  const noFee = await f.calculate(); assert.equal(noFee.lucro, null); assert.ok(noFee.reasons.includes('TARIFA_ML_INDISPONIVEL'));
  assert.equal((await fixture({ taxRate: null }).calculate()).lucro, null);
});

test('uma despesa ausente não elimina as despesas conhecidas das outras linhas', async () => {
  const f = fixture({ kit: true, variables: { product: 2 } });
  f.order.order_items.push({ item: { id: 'MLB2', seller_sku: 'VTK003213' }, quantity: 1, sale_fee: 1 });
  const r = await f.calculate();
  assert.equal(r.custoTotal, 37.08); assert.equal(r.lucro, -7.9);
  assert.ok(r.reasons.includes('CUSTOS_VARIAVEIS_NAO_INFORMADOS'));
});

test('cálculo compartilhado aceita despesa adicional ausente sem dispensar custos obrigatórios', () => {
  for (const variableCosts of [undefined, null, 0]) {
    assert.equal(calculateFinalOrderProfit({ total: 89, productCost: 55.43, saleFees: 10.24, sellerShippingCost: 13.25, tax: 3.56, variableCosts, matchedItems: 1 }), 6.52);
  }
});
