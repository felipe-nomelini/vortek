const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(root, 'src/services/dslite.ts'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/app/api/dslite/pedido/route.ts'), 'utf8');

test('criação de pedido DSLite não possui retry automático de POST', () => {
  assert.equal(serviceSource.includes('DSLITE_CREATE_ORDER_MAX_ATTEMPTS'), false);
  assert.equal(serviceSource.includes("reconciledBy: 'post_write_nf_key'"), true);
});

test('rota serializa writes DSLite e não usa fallback sem fornecedor', () => {
  assert.equal(routeSource.includes('domain: "dslite:order_create"'), true);
  assert.equal(routeSource.includes('criarPedidoDropshipping(xml)'), false);
  assert.equal(routeSource.includes('canFallbackToSupplierlessCreate'), false);
});

test('identidade do anúncio não bloqueia pedido já vendido', () => {
  assert.equal(routeSource.includes('ml_listing_identity_blocked'), false);
  assert.equal(routeSource.includes('ml_listing_identity_check_failed'), false);
  assert.equal(routeSource.includes('ml_manual_blocklist'), false);
});
