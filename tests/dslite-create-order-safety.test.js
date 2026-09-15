const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(root, 'src/services/dslite.ts'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/app/api/dslite/pedido/route.ts'), 'utf8');
const ordersRouteSource = fs.readFileSync(path.join(root, 'src/app/api/pedidos/route.ts'), 'utf8');

test('criação de pedido DSLite não possui retry automático de POST', () => {
  assert.equal(serviceSource.includes('DSLITE_CREATE_ORDER_MAX_ATTEMPTS'), false);
  assert.equal(serviceSource.includes("reconciledBy: 'post_write_nf_key'"), true);
});

test('rota serializa writes DSLite e não usa fallback sem fornecedor', () => {
  assert.equal(routeSource.includes('domain: "dslite:order_create"'), true);
  assert.equal(routeSource.includes('criarPedidoDropshipping(xml)'), false);
  assert.equal(routeSource.includes('canFallbackToSupplierlessCreate'), false);
  assert.equal(routeSource.includes('fallbackSupplierId'), false);
  assert.equal(routeSource.includes('fallbackDsliteProdutoId'), false);
  assert.equal(routeSource.includes('legacySupplierId'), false);
  assert.equal(ordersRouteSource.includes('legacySupplierId'), false);
});

test('kit preserva o fornecedor configurado depois da expansão fiscal', () => {
  assert.match(routeSource, /loadPinnedKitSourcesForOrder/);
  assert.match(routeSource, /componentDsliteProductId/);
  assert.match(routeSource, /allowFallback: !fixedKitSupplierPlan/);
  assert.match(routeSource, /fixedSupplierOffers[\s\S]*dslite_fornecedor_id[\s\S]*fixedKitSupplierPlan\.supplierId/);
  assert.match(routeSource, /fornecedor configurado do kit/);
  assert.match(routeSource, /pinnedLineKitPlan\.supplierId !== fornecedorId/);
});
