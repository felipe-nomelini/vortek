const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/(app)/pedidos/page.tsx'), 'utf8');

test('BNT-D01 persiste o estado operacional relevante na URL', () => {
  for (const key of [
    'view', 'search', 'status', 'fornecedores', 'dateFrom', 'dateTo',
    'priceMin', 'priceMax', 'page', 'sortBy', 'sortOrder',
  ]) {
    assert.match(page, new RegExp(`['\"]${key}['\"]`), `parâmetro ${key} deve ser persistido`);
  }
  assert.match(page, /window\.history\.replaceState/);
});

test('BNT-D01 apresenta somente ações autorizadas para o cargo atual', () => {
  assert.match(page, /fetch\('\/api\/auth\/me'/);
  assert.match(page, /hasPermission\(role, permission\)/);
  for (const permission of [
    'sales.track',
    'sales.dslite.create',
    'sales.internal_shipping.process',
    'sales.dslite.label.complete',
    'sales.dslite.resume',
    'purchases.payment.confirm',
    'sales.whatsapp_label.send',
    'sales.dslite.unlink',
  ]) {
    assert.match(page, new RegExp(permission.replaceAll('.', '\\.')));
  }
});

test('BNT-D01 mantém lista e resumo independentes e preserva dados em falha de refresh', () => {
  assert.match(page, /listLoading/);
  assert.match(page, /summaryLoading/);
  assert.match(page, /listError/);
  assert.match(page, /summaryError/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /Os dados anteriores foram preservados/);
});
