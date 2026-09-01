const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const page = read('src/app/(app)/estoque/page.tsx');
const scanner = read('src/components/estoque/ReceiveNfeModal.tsx');
const stockRoute = read('src/app/api/estoque/route.ts');
const importRoute = read('src/app/api/estoque/recebimentos/importar/route.ts');
const confirmRoute = read('src/app/api/estoque/recebimentos/[id]/confirmar/route.ts');
const manifestRoute = read('src/app/api/estoque/recebimentos/manifestar/route.ts');
const incomingManifestation = read('src/lib/fiscal/incoming-nfe.ts');
const migration = read('supabase/migrations/20260901190000_bnt_d05_owned_inventory.sql');

test('organiza estoque próprio em posição, recebimentos e movimentações', () => {
  for (const label of ['Estoque próprio', 'Físico utilizável', 'Disponível', 'Reservado', 'Em conferência']) assert.match(page, new RegExp(label));
  for (const tab of ["key: 'estoque'", "key: 'recebimentos'", "key: 'movimentos'"]) assert.match(page, new RegExp(tab));
  assert.doesNotMatch(page, /cinco filas|Entrada manual/);
});

test('expõe posição canônica por produto e histórico auditável', () => {
  assert.match(stockRoute, /from\('estoque_interno_posicoes'\)/);
  assert.match(stockRoute, /inventory\.read/);
  assert.match(stockRoute, /inventory\.manage/);
  assert.match(page, /Último movimento/);
  assert.match(page, /Histórico/);
  assert.match(page, /Ajustar estoque/);
  assert.match(migration, /stock_adjustment_invades_reservations/);
  assert.match(migration, /idempotency_key/);
});

test('recebimento por NF-e exige conferência física antes de liberar saldo', () => {
  assert.match(page, /Receber NF-e/);
  assert.match(scanner, /O saldo só fica disponível depois da conferência física/);
  assert.match(scanner, /Confirmar recebimento/);
  assert.match(confirmRoute, /confirm_internal_stock_receipt/);
  assert.match(migration, /'entrada_compra'/);
  assert.match(migration, /'aguardando_conferencia', 'parcial', 'conferido'/);
});

test('suporta câmera móvel, leitor HID, chave manual e upload XML', () => {
  assert.match(scanner, /BrowserMultiFormatReader/);
  assert.match(scanner, /facingMode: \{ ideal: 'environment' \}/);
  assert.match(scanner, /controlsRef\.current\?\.stop\(\)/);
  assert.match(scanner, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(scanner, /Leitores USB ou Bluetooth/);
  assert.match(scanner, /Enviar XML do fornecedor/);
  assert.match(importRoute, /obterXmlEntradaBrasilNfe/);
});

test('manifestação fiscal é explícita e não acontece durante a importação', () => {
  assert.doesNotMatch(importRoute, /manifestarCiencia/);
  assert.match(manifestRoute, /confirmar: z\.literal\(true\)/);
  assert.match(manifestRoute, /requestIncomingNfeManifestation/);
  assert.match(incomingManifestation, /manifestarNotaEntradaBrasilNfe/);
  assert.match(incomingManifestation, /estoque_manifestacoes_nfe/);
  assert.match(scanner, /Manifestar ciência e obter XML/);
});

test('itens sem correspondência exigem produto Bentevi existente', () => {
  assert.match(scanner, /Vincule todos os itens/);
  assert.match(scanner, /Crie o produto na tela Produtos/);
  assert.match(confirmRoute, /produtoId: z\.string\(\)\.uuid\(\)/);
  assert.match(migration, /stock_receipt_unmapped_items/);
  assert.match(migration, /estoque_mapeamentos_fornecedor/);
});

test('ledger mantém entradas, reservas, saídas, ajustes e reversões na mesma fonte', () => {
  for (const type of ['entrada_devolucao', 'entrada_compra', 'ajuste_positivo', 'ajuste_negativo', 'saida_envio_interno']) assert.match(migration, new RegExp(`'${type}'`));
  assert.match(migration, /create or replace view public\.estoque_interno_posicoes/);
  assert.match(migration, /create or replace function public\.select_order_fulfillment/);
  assert.match(page, /Recebimento de compra/);
  assert.match(page, /Ajuste negativo/);
});

test('preserva identidade dark Bentevi e tratamento de erro', () => {
  const styles = read('src/app/(app)/estoque/estoque.module.css');
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /var\(--bentevi-surface/);
  assert.match(styles, /\.positiveValue/);
  assert.match(page, /Os dados anteriores foram preservados/);
});
