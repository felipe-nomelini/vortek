const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const NextResponse = { json: (body, options) => ({ body, status: options?.status || 200 }) };
const id = '00000000-0000-4000-8000-000000000011';
const secondId = '00000000-0000-4000-8000-000000000012';
const context = { params: Promise.resolve({ id }) };
const service = load('src/lib/supplier-oracle-settlement.ts', { 'node:crypto': require('node:crypto'), 'next/server': { NextResponse } });

function route(file, input = {}) {
  const calls = [];
  const module = load(file, {
    'next/server': { NextResponse }, zod: require('zod'),
    '@/lib/api-request-auth': { authorizeApiRequest: async (_request, permission) => {
      calls.push(['permission', permission]);
      return input.auth || { ok: true, userId: '00000000-0000-4000-8000-000000000001' };
    } },
    '@/lib/supabase': { createServiceClient: () => ({ from: (table) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
      calls.push(['read', table]);
      return { data: { fornecedor_dslite_id: '108' }, error: null };
    } }) }) }), rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return { data: { id, status: 'prepared', version: 1, replayed: false }, error: null };
    } }) },
    '@/lib/supplier-oracle-settlement': {
      ...service,
      supplierOracleWritesEnabled: () => Boolean(input.enabled),
      supplierOracleBatchAllowed: () => input.batchAllowed !== false,
      supplierOracleBatchMode: () => input.batchAllowed === false ? 'disabled' : 'enabled',
    },
  });
  return { module, calls };
}

const prepareFile = 'src/app/api/compras/liquidacoes/preparar/route.ts';
const confirmFile = 'src/app/api/compras/liquidacoes/[id]/confirmar/route.ts';
const cancelFile = 'src/app/api/compras/liquidacoes/[id]/cancelar/route.ts';
const body = { fornecedorId: '108', compraIds: [id], creditoCentavos: 5000, chaveIdempotencia: 'oracle-api-001' };
const post = (value) => new Request('https://app.bentevi.shop/api/compras/liquidacoes/preparar', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
});

test('writers da ORC-03 ficam desligados e não tocam no banco produtivo', async () => {
  for (const file of [prepareFile, confirmFile, cancelFile]) {
    const { module, calls } = route(file);
    const response = file === prepareFile
      ? await module.POST(post(body))
      : await module.POST(post({ versaoEsperada: 1 }), context);
    assert.equal(response.status, 503);
    assert.deepEqual(calls.map(([kind]) => kind), ['permission']);
  }
});

test('acesso negado precede a flag e qualquer chamada privilegiada', async () => {
  const { module, calls } = route(prepareFile, { enabled: true, auth: { ok: false, response: { status: 403 } } });
  assert.equal((await module.POST(post(body))).status, 403);
  assert.deepEqual(calls.map(([kind]) => kind), ['permission']);
});

test('preparação envia centavos exatos, fingerprint estável e ator autenticado', async () => {
  const { module, calls } = route(prepareFile, { enabled: true });
  assert.equal((await module.POST(post(body))).status, 201);
  const rpc = calls.find(([kind]) => kind === 'rpc');
  assert.equal(rpc[1], 'supplier_oracle_prepare');
  assert.equal(rpc[2].p_credit_amount, 50);
  assert.equal(rpc[2].p_actor, '00000000-0000-4000-8000-000000000001');
  assert.match(rpc[2].p_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(service.supplierOracleFingerprint({ supplierId: '108', purchaseIds: [id, secondId], creditCents: 100 }),
    service.supplierOracleFingerprint({ supplierId: '108', purchaseIds: [secondId, id], creditCents: 100 }));
});

test('API rejeita compra repetida e confirma/cancela pela versão esperada', async () => {
  const invalid = route(prepareFile, { enabled: true });
  assert.equal((await invalid.module.POST(post({ ...body, compraIds: [id, id] }))).status, 422);
  assert.equal(invalid.calls.filter(([kind]) => kind === 'rpc').length, 0);
  const confirm = route(confirmFile, { enabled: true });
  assert.equal((await confirm.module.POST(post({ versaoEsperada: 1, referenciaPix: 'ABC' }), context)).status, 200);
  assert.equal(confirm.calls.find(([kind]) => kind === 'rpc')[1], 'supplier_oracle_confirm');
  const cancel = route(cancelFile, { enabled: true });
  assert.equal((await cancel.module.POST(post({ versaoEsperada: 1 }), context)).status, 200);
  assert.equal(cancel.calls.find(([kind]) => kind === 'rpc')[1], 'supplier_oracle_cancel');
});

test('lote fica fechado mesmo com o núcleo individual ativado', async () => {
  const prepare = route(prepareFile, { enabled: true, batchAllowed: false });
  assert.equal((await prepare.module.POST(post(body))).status, 403);
  assert.equal(prepare.calls.some(([kind]) => kind === 'rpc'), false);
  const confirm = route(confirmFile, { enabled: true, batchAllowed: false });
  assert.equal((await confirm.module.POST(post({ versaoEsperada: 1 }), context)).status, 403);
  assert.equal(confirm.calls.some(([kind]) => kind === 'rpc'), false);
});

test('modo canário só libera o fornecedor escolhido; sem configuração o lote fica fechado', () => {
  const prior = {
    writes: process.env.ORACULO_SETTLEMENT_WRITES_ENABLED,
    mode: process.env.ORACULO_SETTLEMENT_BATCH_MODE,
    supplier: process.env.ORACULO_SETTLEMENT_CANARY_SUPPLIER_ID,
  };
  try {
    process.env.ORACULO_SETTLEMENT_WRITES_ENABLED = 'true';
    delete process.env.ORACULO_SETTLEMENT_BATCH_MODE;
    assert.equal(service.supplierOracleBatchAllowed('108'), false);
    process.env.ORACULO_SETTLEMENT_BATCH_MODE = 'canary';
    process.env.ORACULO_SETTLEMENT_CANARY_SUPPLIER_ID = '108';
    assert.equal(service.supplierOracleBatchAllowed('108'), true);
    assert.equal(service.supplierOracleBatchAllowed('109'), false);
    delete process.env.ORACULO_SETTLEMENT_WRITES_ENABLED;
    assert.equal(service.supplierOracleBatchAllowed('108'), false);
  } finally {
    for (const [key, value] of Object.entries({
      ORACULO_SETTLEMENT_WRITES_ENABLED: prior.writes,
      ORACULO_SETTLEMENT_BATCH_MODE: prior.mode,
      ORACULO_SETTLEMENT_CANARY_SUPPLIER_ID: prior.supplier,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
