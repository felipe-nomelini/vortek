const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('remove APIs e interface operacional exclusivas da conta-saldo Hayamax', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/app/api/fornecedores/saldo-hayamax/route.ts')), false);
  assert.equal(
    fs.existsSync(path.join(root, 'src/app/api/fornecedores/saldo-hayamax/aprovar-mercadopago/route.ts')),
    false,
  );

  const purchasesPage = read('src/app/(app)/compras/page.tsx');
  assert.doesNotMatch(purchasesPage, /\/api\/fornecedores\/saldo-hayamax/);
  assert.doesNotMatch(purchasesPage, /Importar extrato Hayamax|Registrar boleto Hayamax|Aprovar crédito/);
});

test('não gera novos balance_account nem débito automático', () => {
  const paymentModeSource = read('src/lib/produto-fornecedor.ts');
  const balanceSource = read('src/lib/supplier-balance.ts');
  const createPurchaseSource = read('src/app/api/dslite/pedido/route.ts');
  const syncPurchasesSource = read('src/app/api/sync/dslite-pedidos/route.ts');

  assert.match(paymentModeSource, /return 'prepaid_pix';/);
  assert.doesNotMatch(paymentModeSource, /return 'balance_account';/);
  assert.doesNotMatch(balanceSource, /recordSupplierPurchaseDebit|movement_type: 'purchase_debit'/);
  assert.doesNotMatch(createPurchaseSource, /recordSupplierPurchaseDebit/);
  assert.doesNotMatch(syncPurchasesSource, /recordSupplierPurchaseDebit/);
});

test('recusa balance_account ativo e preserva sua leitura histórica', () => {
  const offerRoute = read('src/app/api/produtos/[id]/fornecedores/route.ts');
  const offerPage = read('src/app/(app)/produtos/ofertas/[id]/page.tsx');
  const purchasesPage = read('src/app/(app)/compras/page.tsx');

  assert.match(offerRoute, /value === 'balance_account'/);
  assert.match(offerRoute, /status: 422/);
  assert.match(offerPage, /Saldo Hayamax \(histórico\).*disabled: true/s);
  assert.match(purchasesPage, /Saldo Hayamax/);
});

test('expõe o ledger aposentado somente para leitura e fora dos totais ativos', () => {
  const creditsRoute = read('src/app/api/fornecedores/creditos/route.ts');
  const creditsPage = read('src/app/(app)/fornecedores/creditos/page.tsx');
  const fetchMovementsSource = creditsRoute.slice(
    creditsRoute.indexOf('async function fetchAllMovements'),
    creditsRoute.indexOf('export async function GET'),
  );

  assert.doesNotMatch(fetchMovementsSource, /\.neq\('fornecedor_id', HAYAMAX_FORNECEDOR_ID\)/);
  assert.match(creditsRoute, /read_only: id === HAYAMAX_FORNECEDOR_ID/);
  assert.match(creditsRoute, /operationalSuppliers = suppliers\.filter\(\(row\) => !row\.read_only\)/);
  assert.match(creditsPage, /Aposentado · somente leitura/);
  assert.match(creditsPage, /filter\(\(supplier\) => !supplier\.read_only\)/);
  assert.match(creditsPage, /Conta-saldo aposentada/);
});
