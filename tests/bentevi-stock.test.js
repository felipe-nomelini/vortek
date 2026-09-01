const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/estoque/page.tsx');
const styles = read('src/app/(app)/estoque/estoque.module.css');
const drawer = read('src/components/estoque/EstoqueDetailsDrawer.tsx');
const stockRoute = read('src/app/api/estoque/route.ts');
const situationRoute = read('src/app/api/estoque/[movimentoId]/situacao/route.ts');

test('organiza o estoque interno em cinco filas operacionais', () => {
  for (const label of ['Em revisão', 'Disponíveis', 'Reservadas', 'Não aproveitáveis', 'Saídas despachadas']) {
    assert.match(page, new RegExp(`label: '${label}'`));
  }
  for (const queue of ['revisao', 'disponivel', 'reservado', 'nao_aproveitavel', 'despachado']) {
    assert.match(page, new RegExp(`queue: '${queue}'`));
  }
  assert.match(page, /Estoque interno, reservas e decisões/);
  assert.match(page, /un\./);
});

test('separa produto, origem, quantidade, condição e ações', () => {
  for (const title of ['Produto', 'Quantidade', 'Condição', 'Ações']) {
    assert.match(page, new RegExp(`title: '${title}'`));
  }
  assert.match(page, /activeQueue === 'reservado'.*'Reserva'/s);
  assert.match(page, /activeQueue === 'despachado'.*'Despacho'/s);
  assert.match(page, /activeQueue === 'reservado'.*'Venda'.*'Origem'/s);
  assert.match(page, /className=\{styles\.productName\}/);
  assert.match(styles, /\.productName[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/);
});

test('mantém Pack e Venda distintos e abre a venda interna', () => {
  assert.match(stockRoute, /ml_order_id: item\.pedidos\?\.ml_order_id/);
  assert.match(stockRoute, /ml_pack_id: item\.pedidos\?\.ml_pack_id/);
  assert.doesNotMatch(stockRoute, /pedido_ml_link_id/);
  assert.match(page, /<b>Pack<\/b>/);
  assert.match(page, /<b>Venda<\/b>/);
  assert.match(page, /href=\{`\/pedidos\?venda=/);
});

test('expõe reservas ativas e as desconta da disponibilidade', () => {
  assert.match(stockRoute, /\.in\('estado_envio_interno', \['reservado', 'despachado'\]\)/);
  assert.match(stockRoute, /\.is\('estornada_em', null\)/);
  assert.match(stockRoute, /calcularEntradasVisiveisEstoqueInterno\(\s*entradas,\s*saidasAtivas\.map/s);
  assert.match(stockRoute, /estado_envio_interno === 'reservado'/);
  assert.match(stockRoute, /estado_envio_interno === 'despachado'/);
  assert.match(stockRoute, /reservadosQuantidade:/);
  assert.match(page, /indisponível para outra reserva/);
  assert.doesNotMatch(page, /Q_segura|estoque_fornecedor/);
});

test('preserva as transições válidas e restringe a exclusão manual', () => {
  assert.match(situationRoute, /situacao_estoque[^\n]*revisao|movimento\.situacao_estoque/s);
  assert.match(situationRoute, /Somente itens em revisão podem ter a situação alterada/);
  assert.match(situationRoute, /\['delivered', 'returned', 'manual'\]/);
  assert.match(situationRoute, /Somente inserções manuais ainda em revisão podem ser excluídas/);
  assert.match(situationRoute, /\.eq\('status_devolucao', 'manual'\)[\s\S]*?\.eq\('situacao_estoque', 'revisao'\)/);
  assert.match(page, /Marcar não aproveitável/);
  assert.match(page, /Excluir entrada manual/);
  assert.match(page, /result\?\.mlSyncWarning/);
});

test('usa filtros persistentes, erros visíveis e atualização preservada', () => {
  for (const filter of ['fila', 'busca', 'origem', 'condicao', 'dataDe', 'dataAte', 'pagina']) {
    assert.match(page, new RegExp(`params\\.set\\('${filter}'`));
  }
  assert.match(page, /Os dados anteriores foram preservados/);
  assert.match(page, /Nenhum item encontrado com os filtros atuais/);
  assert.match(page, /window\.setInterval\(refresh, 30_000\)/);
  assert.match(page, /storageKey=\{`estoque-bentevi-/);
});

test('mantém inserção manual simples e sempre em revisão', () => {
  assert.match(page, /Adicionar item ao estoque interno/);
  assert.match(page, /Busque e confirme o produto antes de inserir/);
  assert.match(page, /A entrada não ficará disponível imediatamente/);
  assert.match(page, /Adicionar para revisão/);
  assert.match(stockRoute, /status_devolucao: 'manual'/);
  assert.match(stockRoute, /situacao_estoque: 'revisao'/);
  assert.match(stockRoute, /disponivel_venda: false/);
});

test('fornece Drawer de detalhes sem fabricar histórico', () => {
  for (const label of ['Visão geral', 'Rastreabilidade', 'Produto e quantidade', 'Origem e venda', 'Estado atual']) {
    assert.match(drawer, new RegExp(label));
  }
  assert.match(drawer, /somente marcos com data registrada no ledger/i);
  assert.match(drawer, /Pack ML/);
  assert.match(drawer, /Venda ML/);
  assert.match(drawer, /Abrir venda na Bentevi/);
});

test('aplica identidade dark Bentevi sem criar novo sistema visual', () => {
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /var\(--bentevi-surface/);
  assert.match(styles, /var\(--bentevi-border/);
  assert.match(styles, /\.summaryBand/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
});
