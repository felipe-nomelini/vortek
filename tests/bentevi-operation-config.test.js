const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const contracts = require('../src/lib/configuracoes/contracts.ts');
const operation = require('../src/lib/orders/operational-view.ts');

test('contrato operacional aceita somente as três seções controladas', () => {
  assert.equal(contracts.operationConfigurationPatchSchema.safeParse({ section: 'orders', delayedAfterMinutes: 30 }).success, true);
  assert.equal(contracts.operationConfigurationPatchSchema.safeParse({ section: 'orders', delayedAfterMinutes: 2 }).success, false);
  assert.equal(contracts.operationConfigurationPatchSchema.safeParse({ section: 'supplier_feed', supplierId: '00000000-0000-0000-0000-000000000001', xmlUrl: 'https://example.com/feed.xml' }).success, false);
  assert.equal(contracts.operationConfigurationPatchSchema.safeParse({ section: 'supplier_feed', supplierId: '00000000-0000-0000-0000-000000000001', xmlUrl: 'https://app.dslite.com.br/getXMLCrossdocking/teste' }).success, true);
});

test('prazo persistido altera a classificação de atenção', () => {
  const now = Date.parse('2026-09-04T12:00:00Z');
  const order = { data_venda: '2026-09-04T11:30:00Z', situacao: 'pendente' };
  assert.equal(operation.getOperationalUrgencyReasons(order, 60, now).length, 0);
  assert.match(operation.getOperationalUrgencyReasons(order, 20, now)[0], /DSLite/);
});

test('API é admin-only, no-store e não devolve o segredo XML', () => {
  const route = read('src/app/api/configuracoes/operacao/route.ts');
  assert.match(route, /requireAdminUser/);
  assert.match(route, /Cache-Control': 'no-store/);
  assert.match(route, /xmlFeedConfigured: Boolean/);
  assert.doesNotMatch(route, /xmlUrl:\s*supplier\.dslite_catalog_xml_url/);
  assert.match(route, /default_return_address/);
  assert.match(route, /recordConfigurationAudit/);
});

test('runtime não contém IDs nominais nem JSON legado como fonte operacional', () => {
  const policy = read('src/lib/dslite/supplier-policy.ts');
  const xmlSync = read('src/app/api/sync/preco-estoque-xml/route.ts');
  const stock = read('src/lib/estoque-interno.ts');
  assert.doesNotMatch(policy, /BLOCKED_DROPSHIPPING|\['2', '134'\]/);
  assert.doesNotMatch(xmlSync, /dslite_catalog_xml_urls|getSyncRuntimeJson/);
  assert.doesNotMatch(stock, /1634853936|21011550/);
});

test('migration preserva legado e consolida fontes com constraints', () => {
  const migration = read('supabase/migrations/20260904233000_bnt_cfg_04_operation.sql');
  assert.match(migration, /order_operational_delay_minutes between 5 and 1440/);
  assert.match(migration, /dropshipping_retired_at/);
  assert.match(migration, /dslite_catalog_xml_url/);
  assert.match(migration, /delete from public\.sync_runtime_config/);
  assert.match(migration, /migration interrompida/);
});

test('tab Operação separa parâmetros editáveis de regras protegidas', () => {
  const page = read('src/app/(app)/configuracoes/page.tsx');
  const tab = read('src/components/configuracoes/OperacaoTab.tsx');
  assert.match(page, /key: "operacao"/);
  assert.match(page, /<OperacaoTab messageApi=\{messageApi\}/);
  assert.match(tab, /Atenção dos pedidos/);
  assert.match(tab, /Estoque interno/);
  assert.match(tab, /Fornecedores e reconciliação XML/);
  assert.match(tab, /Regras protegidas/);
});
