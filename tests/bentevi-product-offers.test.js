const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/produtos/ofertas/page.tsx');
const styles = read('src/app/(app)/produtos/ofertas/ofertas.module.css');
const route = read('src/app/api/produtos/ofertas/route.ts');
const domain = read('src/lib/products/supplier-offers.ts');
const migration = read('supabase/migrations/20260902110000_bnt_d09_supplier_offers_search.sql');

test('BNT-D09 organiza ofertas como comparação operacional', () => {
  for (const label of [
    'Ofertas vinculadas',
    'Elegíveis agora',
    'Com problema',
    'Produtos com alternativas',
    'Operacionais',
    'Alternativas',
    'Históricas',
  ]) assert.match(page, new RegExp(label));

  for (const column of [
    'Oferta do fornecedor',
    'Produto Bentevi',
    'Fornecedor',
    'Disponibilidade',
    'Custo comparado',
    'Situação',
    'Ações',
  ]) assert.match(page, new RegExp(column));

  assert.match(page, /Menor custo elegível/);
  assert.match(page, /Preferencial.*manual/);
  assert.match(page, /Ver oferta/);
  assert.doesNotMatch(page, /Sem Anúncio ML|Lucro Médio|receitaPotencial/);
  assert.match(styles, /var\(--bentevi-primary/);
});

test('BNT-D09 classifica uma oferta no backend em precedência única', () => {
  const positions = [
    "return 'historical'",
    "return 'offer_inactive'",
    "return 'product_inactive'",
    "return 'invalid_cost'",
    "return 'out_of_stock'",
    "return 'eligible'",
  ].map((needle) => domain.indexOf(needle));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.match(domain, /isBlockedDropshippingDsliteSupplier/);
  assert.match(migration, /when not base\.supplier_active or base\.payment_mode = 'balance_account' then 'historical'/);
  assert.match(migration, /when not base\.offer_active then 'offer_inactive'/);
  assert.match(migration, /when not base\.product_active then 'product_inactive'/);
  assert.match(migration, /when coalesce\(base\.cost, 0\) <= 0 then 'invalid_cost'/);
  assert.match(migration, /when coalesce\(base\.stock, 0\) <= 0 then 'out_of_stock'/);
});

test('BNT-D09 pagina, filtra e compara no banco em uma única RPC', () => {
  assert.match(route, /rpc\('search_supplier_offers_paginated'/);
  assert.doesNotMatch(route, /loadProdutoOfertaRows|calculateSuggestedPrice|estoque_interno_movimentacoes/);
  assert.match(migration, /row_number\(\) over/);
  assert.match(migration, /min\(classified\.cost\) filter \(where classified\.status = 'eligible'\)/);
  assert.match(migration, /limit|sort_position <= v_offset \+ v_page_size/i);
  assert.match(migration, /offer\.offer_id asc/);
  assert.doesNotMatch(migration, /create index/i);
});

test('BNT-D09 mantém histórico sem ação e não converte estoque interno em oferta', () => {
  assert.match(domain, /offer\?\.is_internal_stock !== true/);
  assert.match(domain, /offer\?\.is_kit_supplier !== true/);
  assert.match(page, /Conta-saldo aposentada/);
  assert.match(page, /detalhe e ações da oferta permanecem desabilitados até a BNT-D10/);
  assert.match(page, /row\.isHomologationFixture/);
  assert.match(page, /disabled>Ver oferta/);
});

test('RPC BNT-D09 aplica privilégio mínimo e search_path seguro', () => {
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
});

test('BNT-D09 reutiliza a amostra real protegida sem escrita operacional', () => {
  assert.match(route, /loadBntD07VisualReview\(\)/);
  assert.match(route, /listBntD09VisualReview/);
  assert.match(domain, /isHomologationFixture: true/);
  assert.doesNotMatch(domain, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});
