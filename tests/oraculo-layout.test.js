const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'src/components/compras/OracleSettlementDrawer.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/compras/OracleSettlementDrawer.module.css'), 'utf8');

test('Oráculo: visão inicial destaca o bloqueio e recolhe pendências extensas', () => {
  assert.match(panel, /readyCount === 0/);
  assert.match(panel, /Nenhum fechamento disponível agora/);
  assert.match(panel, /readyCount > 0 \? formatCurrency/);
  assert.match(panel, /Excluídas/);
  assert.match(panel, /Compras fora do fechamento/);
  assert.match(panel, /account\.excluded\.length > 0 && <Collapse/);
  assert.match(panel, /item\.reasons\.slice\(0, 2\)/);
  assert.match(panel, /<details className=\{styles\.exceptionRow\}/);
  assert.match(panel, /Sem fornecedor identificado/);
});

test('Oráculo: histórico, preparo e detalhe têm etapas próprias sem liberar escrita', () => {
  for (const view of ['today', 'history', 'prepare', 'detail']) {
    assert.match(panel, new RegExp(`view === '${view}'`));
  }
  assert.match(panel, /const writable = canOperate && writesEnabled/);
  assert.match(panel, /writable && account\.canPrepare && account\.valid && account\.included\.length > 0/);
  assert.match(panel, /disabled=\{!writable \|\| !detail\.canConfirmBatch \|\| !pixDone\}/);
  assert.match(panel, /setPixDone\(false\); setReference\(''\); setNotes\(''\); setReceipt\(null\)/);
  assert.match(panel, /Fechamento consolidado em modo de leitura/);
});

test('Oráculo: cartão e valores têm layout responsivo', () => {
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /\.summaryGrid/);
  assert.match(css, /\.amountGrid/);
  assert.match(css, /\.exceptionRow/);
});
