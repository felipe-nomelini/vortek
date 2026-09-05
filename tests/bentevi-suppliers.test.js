const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/fornecedores/page.tsx');
const styles = read('src/app/(app)/fornecedores/fornecedores.module.css');
const route = read('src/app/api/fornecedores/route.ts');
const syncRoute = read('src/app/api/fornecedores/sync/route.ts');
const statusRoute = read('src/app/api/fornecedores/[id]/status/route.ts');
const wrapper = read('src/app/(app)/fornecedores/cadastros/page.tsx');
const purchases = read('src/app/(app)/compras/page.tsx');
const { hasPermission } = require('../src/lib/permissions.ts');
const { evaluateScheduledTaskHealth } = require('../src/lib/sync/registry.ts');

test('BNT-D15 organiza o diretório com hierarquia operacional Bentevi', () => {
  for (const column of ['Fornecedor', 'Modalidades', 'Situação', 'Contato', 'Última sincronização', 'Ações']) {
    assert.match(page, new RegExp(`title: '${column}'`));
  }
  for (const metric of ['Operacionais', 'Inativos', 'Sincronização com atenção']) {
    assert.match(page, new RegExp(metric));
  }
  assert.match(page, /ativo: operationalStatus/);
  assert.match(page, /useState<OperationalStatus>\('active'\)/);
  assert.match(page, /Ver fornecedor/);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.doesNotMatch(page, /rowSelection/);
});

test('BNT-D15 elimina ações sem contrato e limita tags ao estado operacional', () => {
  assert.doesNotMatch(page, /Visualizar payload DSLite|Ver no DSLite|console\.log/);
  assert.doesNotMatch(page, /payload_dslite/);
  assert.match(page, /<Tag color=\{supplier\.ativo/);
  assert.match(page, /modalityLine\('Cross-docking'/);
  assert.match(page, /modalityLine\('Dropshipping'/);
  assert.match(page, /<Badge status=\{supplier\.sync_health/);
});

test('BNT-D15 mantém sincronização e mudança de estado observáveis e contextuais', () => {
  assert.match(page, /Sincronização DSLite em andamento/);
  assert.match(page, /Sincronização concluída com atenção/);
  assert.match(page, /Modal\.useModal\(\)/);
  assert.match(page, /products_active/);
  assert.match(page, /supplier_offers_active/);
  assert.match(page, /ml_pause_candidates/);
  assert.match(page, /Reativação bloqueada/);
  assert.match(page, /supplier\.activation_blocked/);
});

test('API BNT-D15 exige leitura, usa DTO explícito e resumo global', () => {
  assert.match(route, /authorizeApiRequest\(request, 'purchases\.read'\)/);
  assert.match(route, /LIST_FIELDS = 'id,dslite_id,apelido,nome,cnpj,email,telefone,status_dslite,crossdocking,dropshipping,ativo,dropshipping_retired_at,dslite_ultima_sync'/);
  assert.match(route, /SUMMARY_FIELDS = 'ativo,dslite_ultima_sync,status_dslite,crossdocking,dropshipping'/);
  assert.doesNotMatch(route, /\.select\(['"]\*['"]\)/);
  assert.doesNotMatch(route, /payload_dslite|supplier_pix_key|endereco/);
  assert.match(route, /summary:/);
  assert.match(route, /filters:/);
  assert.match(route, /Cache-Control': 'no-store'/);
});

test('API BNT-D15 preserva filtros legados e adiciona estado e frescor canônicos', () => {
  for (const field of ['status_dslite', 'crossdocking', 'dropshipping']) {
    assert.match(route, new RegExp(`searchParams\\.get\\('${field}'\\)`));
  }
  assert.match(route, /searchParams\.get\('ativo'\)/);
  assert.match(route, /searchParams\.get\('freshness'\)/);
  assert.match(route, /getSyncTaskByKey\('sync_dslite_fornecedores'\)/);
  assert.match(route, /evaluateScheduledTaskHealth/);
  assert.match(route, /dropshipping_retired_at/);

  const nowMs = Date.parse('2026-09-03T15:00:00.000Z');
  assert.equal(evaluateScheduledTaskHealth({
    intervalMinutes: 30,
    lastRunAt: '2026-09-03T14:00:00.000Z',
    nowMs,
  }).state, 'healthy');
  assert.equal(evaluateScheduledTaskHealth({
    intervalMinutes: 30,
    lastRunAt: '2026-09-03T10:00:00.000Z',
    nowMs,
  }).state, 'stale');
});

test('gestão administra fornecedores; operador e visualizador ficam em leitura', () => {
  for (const role of ['admin', 'gerente']) {
    assert.equal(hasPermission(role, 'suppliers.manage'), true);
  }
  for (const role of ['operador', 'visualizador']) {
    assert.equal(hasPermission(role, 'purchases.read'), true);
    assert.equal(hasPermission(role, 'suppliers.manage'), false);
  }
  assert.match(syncRoute, /authorizeApiRequest\(request, 'suppliers\.manage'\)/);
  assert.equal(statusRoute.match(/authorizeApiRequest\([^,]+, 'suppliers\.manage'\)/g)?.length, 2);
});

test('rota histórica e consumidor de Compras preservam o contrato existente', () => {
  assert.equal(wrapper.trim(), "export { default } from '../page';");
  assert.match(purchases, /\/api\/fornecedores\?limit=100&sortBy=apelido&sortOrder=asc/);
  assert.match(purchases, /supplier\.dslite_id/);
  assert.match(purchases, /supplier\.apelido \|\| supplier\.nome/);
  assert.match(route, /\n      limit,\n/);
  assert.match(route, /dslite_id/);
  assert.doesNotMatch(route, /operationalStatus \|\| 'active'/);
});
