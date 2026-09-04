const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/fornecedores/creditos/page.tsx');
const listRoute = read('src/app/api/fornecedores/creditos/route.ts');
const decisionRoute = read('src/app/api/fornecedores/creditos/[id]/route.ts');
const reconciliationRoute = read('src/app/api/fornecedores/creditos/reconciliar/route.ts');
const visualReview = read('src/lib/supplier-credits-visual-review.ts');

test('organiza créditos como painel Bentevi orientado à decisão', () => {
  assert.match(page, /Crédito disponível/);
  assert.match(page, /Fila prioritária/);
  assert.match(page, /Aguardando sua decisão/);
  assert.match(page, /Mais antigas primeiro/);
  assert.match(page, /Operação atual/);
  assert.match(page, /Histórico aposentado/);
  assert.match(page, /Novo movimento/);
  assert.match(page, /Buscar cancelamentos/);
});

test('separa extrato em entradas e saídas e concentra decisão em modal', () => {
  assert.match(page, /title: 'Entrada'/);
  assert.match(page, /title: 'Saída'/);
  assert.match(page, /Extrato de créditos/);
  assert.match(page, /Analisar crédito candidato/);
  assert.match(page, /Confirmar crédito/);
  assert.match(page, /Rejeitar crédito/);
  assert.match(page, /Observação da decisão \(opcional\)/);
});

test('mantém Hayamax isolada, fora da operação e somente leitura', () => {
  assert.match(page, /Conta-saldo aposentada · Hayamax/);
  assert.match(page, /não participa dos totais operacionais/);
  assert.match(page, /selectedSupplier\?\.read_only/);
  assert.match(listRoute, /operationalSuppliers = suppliers\.filter\(\(row\) => !row\.read_only\)/);
  assert.match(listRoute, /movement\.fornecedor_id !== HAYAMAX_FORNECEDOR_ID/);
});

test('expõe pendências prioritárias sem quebrar o contrato existente', () => {
  assert.match(listRoute, /pending_movements: pendingMovements\.slice\(0, 50\)/);
  assert.match(listRoute, /pending_count: pendingMovements\.length/);
  assert.match(listRoute, /movement_count/);
  assert.match(visualReview, /Date\.parse\(left\.created_at\) - Date\.parse\(right\.created_at\)/);
});

test('amostra temporária exige origem, expiração e identificadores protegidos', () => {
  assert.match(visualReview, /EXPECTED_SOURCE = 'production-read-only'/);
  assert.match(visualReview, /Date\.parse\(payload\.expiresAt\) <= Date\.now\(\)/);
  assert.match(visualReview, /supplier\.fornecedor_id\.startsWith\('bnt-d17-'\)/);
  assert.match(visualReview, /movement\.id\.startsWith\('bnt-d17-movement-'\)/);
  assert.match(visualReview, /movement\.ml_order_id === null/);
});

test('bloqueia todas as mutações enquanto a amostra visual estiver ativa', () => {
  for (const source of [listRoute, decisionRoute, reconciliationRoute]) {
    assert.match(source, /loadSupplierCreditsVisualReview\(\)/);
    assert.match(source, /SUPPLIER_CREDITS_VISUAL_REVIEW_BLOCK/);
    assert.match(source, /status: 409/);
  }
  assert.match(page, /Simulação visual: nenhuma movimentação financeira foi gravada/);
  assert.match(page, /Simulação visual: nenhuma decisão financeira foi gravada/);
  assert.match(page, /Simulação visual: nenhuma pendência foi criada/);
});

test('preserva tipos canônicos e proteção de saldo do ledger existente', () => {
  assert.match(page, /manual_credit/);
  assert.match(page, /credit_usage/);
  assert.match(page, /adjustment_credit/);
  assert.match(page, /adjustment_debit/);
  assert.match(listRoute, /resolveManualSupplierLedgerAction/);
  assert.match(listRoute, /Crédito confirmado insuficiente/);
});
