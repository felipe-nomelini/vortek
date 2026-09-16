const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(relativePath, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Dependência não simulada: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const eligibility = load('src/lib/supplier-oracle-eligibility.ts', {});

function fakeClient(tables) {
  return {
    from(name) {
      let rows = tables[name] || [];
      const query = {
        select() { return this; },
        eq(field, value) { rows = rows.filter((row) => row[field] === value); return this; },
        gt(field, value) { rows = rows.filter((row) => row[field] > value); return this; },
        in(field, values) { rows = rows.filter((row) => values.includes(row[field])); return this; },
        is(field, value) { rows = rows.filter((row) => row[field] === value); return this; },
        or() { return this; },
        order(field, options) { rows = [...rows].sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (options.ascending ? 1 : -1)); return this; },
        limit(count) { rows = rows.slice(0, count); return this; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return query;
    },
  };
}

function previewRoute(tables, auth = { ok: true }) {
  return load('src/app/api/compras/liquidacoes/preview/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => auth },
    '@/lib/supabase': { createServiceClient: () => fakeClient(tables) },
    '@/lib/fiscal/cnpj.js': { normalizeCnpj: (value) => String(value || '').replace(/\D/g, ''), isValidCnpj: () => true },
    '@/lib/homologation-fixture': { canUseHomologationFixtures: () => true, isHomologationFixtureId: () => false, isHomologationFixtureSource: () => false },
    '@/lib/supplier-oracle-eligibility': eligibility,
  });
}

function fixtures() {
  const purchase = (id, dsid, status) => ({
    id, dsid, data_criacao: '2026-09-16T10:00:00Z', fornecedor_id: '108',
    supplier_payment_mode: 'prepaid_pix', supplier_payment_status: 'pending', supplier_payment_amount: 50,
    status: 'Aguardando Pagamento Fornecedor', status_dslite: 'Confirmado',
    supply_status: status, supplier_settlement_id: null,
  });
  const sale = (id, dsid, labelType) => ({
    id, numero: 100, dslite_id: dsid, situacao: 'pendente', ml_claim_id: null,
    snapshot_incompleto: false, snapshot_pendencias: [], snapshot_source: null,
    label_type: labelType, label_delivery_channel: 'dslite',
    label_delivered_at: labelType === 'real' ? '2026-09-16T11:00:00Z' : null,
  });
  return {
    fornecedores: [{ id: 'supplier', dslite_id: '108', apelido: 'Fornecedor', nome: 'Fornecedor', cnpj: '11222333000181', supplier_pix_key: 'pix@example.com', ativo: true }],
    compras: [purchase('00000000-0000-0000-0000-000000000001', '10', 'ready'), purchase('00000000-0000-0000-0000-000000000002', '20', 'unknown')],
    pedidos: [sale('sale1', '10', 'real'), sale('sale2', '20', 'provisional')],
    supplier_settlement_items: [],
  };
}

test('preview inclui apenas compra pronta e explica exclusão sem criar efeitos', async () => {
  const route = previewRoute(fixtures());
  const response = await route.GET(new Request('https://app.bentevi.shop/api/compras/liquidacoes/preview?fornecedorId=108'));
  assert.equal(response.status, 200);
  assert.equal(response.body.included.length, 1);
  assert.equal(response.body.excluded.length, 1);
  assert.equal(response.body.totalBruto, 50);
  assert.deepEqual(response.body.excluded[0].reasons.map((reason) => reason.code), [
    'label_not_real', 'label_not_delivered', 'supply_not_ready',
  ]);
  assert.equal(response.body.account.pixKeyMasked.includes('pix@example.com'), false);
});

test('conta compartilhada bloqueia todas as compras sem misturar fornecedores', async () => {
  const tables = fixtures();
  tables.fornecedores.push({ ...tables.fornecedores[0], id: 'other', dslite_id: '2' });
  const response = await previewRoute(tables).GET(new Request('https://app.bentevi.shop/api/compras/liquidacoes/preview?fornecedorId=108'));
  assert.equal(response.body.included.length, 0);
  assert.equal(response.body.excluded.length, 2);
  assert.equal(response.body.excluded[0].reasons[0].code, 'invalid_account');
});

test('preview rejeita acesso sem autorização e identificador inválido', async () => {
  const unauthorized = { ok: false, response: { status: 401 } };
  const denied = await previewRoute(fixtures(), unauthorized).GET(new Request('https://app.bentevi.shop/api/compras/liquidacoes/preview?fornecedorId=108'));
  assert.equal(denied.status, 401);
  const invalid = await previewRoute(fixtures()).GET(new Request('https://app.bentevi.shop/api/compras/liquidacoes/preview?fornecedorId=abc'));
  assert.equal(invalid.status, 422);
});
