const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/clientes/page.tsx');
const styles = read('src/app/(app)/clientes/clientes.module.css');
const route = read('src/app/api/clientes/route.ts');
const migration = read('supabase/migrations/20260902200000_bnt_d13_client_search.sql');

test('BNT-D13 organiza o diretório com somente as informações essenciais', () => {
  for (const column of ['Cliente', 'Tipo', 'Documento', 'Localização', 'Contato', 'Pedidos', 'Ações']) {
    assert.match(page, new RegExp(`title: '${column}'`));
  }
  for (const metric of ['Total de clientes', 'Pessoa física', 'Pessoa jurídica']) {
    assert.match(page, new RegExp(metric));
  }
  assert.match(page, /Ver cliente/);
  assert.doesNotMatch(page, /rowSelection/);
  assert.doesNotMatch(page, /key: 'edit'/);
});

test('BNT-D13 exibe dados completos conforme decisão do usuário', () => {
  assert.match(page, /formatDocument\(value\)/);
  assert.match(page, /client\.email/);
  assert.match(page, /client\.phone/);
  assert.match(page, /client\.address/);
  assert.doesNotMatch(page, /maskDocument|maskEmail|maskPhone/);
});

test('BNT-D13 possui busca, filtro rápido e estados explícitos', () => {
  assert.match(page, /Buscar por nome, documento, ID ML, e-mail ou telefone/);
  assert.match(page, /aria-pressed/);
  assert.match(page, /Nenhum cliente corresponde aos filtros/);
  assert.match(page, /Contato não informado|Não informado/);
  assert.match(page, /Tentar novamente/);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.match(styles, /\.summaryActive/);
});

test('BNT-D13 mantém as colunas densas e alinhadas', () => {
  assert.match(page, /title: 'Cliente',[\s\S]*?width: 320/);
  assert.match(page, /title: 'Localização',[\s\S]*?width: 300/);
  assert.match(page, /title: 'Contato',[\s\S]*?width: 180/);
  assert.match(page, /title: 'Pedidos',[\s\S]*?width: 90,[\s\S]*?align: 'left'/);
  assert.match(page, /title: 'Ações',[\s\S]*?width: 120/);
  assert.match(page, /storageKey="clientes-bentevi-v2"/);
  assert.match(styles, /\.ordersCell\s*{[\s\S]*?align-items: flex-start/);
});

test('BNT-D13 usa contrato agregado único e autorização de vendas', () => {
  assert.match(route, /authorizeApiRequest\(request, 'sales\.read'\)/);
  assert.match(route, /rpc\('search_clientes_paginated'/);
  assert.match(route, /Cache-Control': 'no-store'/);
  assert.doesNotMatch(route, /\.from\('pedidos'\)/);
  assert.equal(fs.existsSync(path.join(root, 'src/app/api/clientes/resumo/route.ts')), false);
});

test('RPC BNT-D13 vincula pedidos pelo buyer id oficial', () => {
  assert.match(migration, /order_count\.buyer_ml_id = cliente\.ml_id/);
  assert.match(migration, /latest_address\.buyer_ml_id = cliente\.ml_id/);
  assert.doesNotMatch(migration, /contato_nome/);
  assert.doesNotMatch(migration, /ml_nickname.*pedido|pedido.*ml_nickname/);
  assert.match(migration, /idx_pedidos_buyer_ml_id_sale_date/);
});

test('RPC BNT-D13 preserva segurança e paginação determinística', () => {
  assert.match(migration, /stable/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.match(migration, /client\.id asc/);
  assert.match(migration, /least\(greatest\(coalesce\(p_page_size, 100\), 1\), 100\)/);
});
