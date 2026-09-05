const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const config = require('../src/lib/integration-configuration.ts');
const heading = load('src/components/configuracoes/ConfiguracoesTabHeading.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'), antd: require('antd'),
  '@/theme/bentevi': require('../src/theme/bentevi.ts'),
});
const contracts = require('../src/lib/configuracoes/contracts.ts');
const dto = load('src/lib/integration-config-dto.ts', { './integration-configuration': config });
const sentinel = 'SENTINEL_PRIVATE_CREDENTIAL';
const dslite = { tipo: 'dslite', url: 'https://api.master.dev.dslite.com.br', access_token: sentinel, updated_at: '2026-09-05T00:00:00Z', conectado: false };
const fiscal = { tipo: 'brasilnfe', access_token: sentinel };

test('painel tem dez integrações e distingue ausência, cadastro parcial e credencial presente', () => {
  const overview = config.integrationSummaries([dslite], { SMTP_HOST: 'smtp.invalid', OPENROUTER_API_KEY: sentinel });
  assert.equal(overview.length, 10);
  assert.equal(overview.find(i => i.tipo === 'smtp').state, 'incomplete');
  assert.equal(overview.find(i => i.tipo === 'push').state, 'missing');
  assert.equal(overview.find(i => i.tipo === 'openrouter').state, 'configured');
  assert.equal(overview.find(i => i.tipo === 'dslite').state, 'configured');
  assert.doesNotMatch(JSON.stringify(overview), /SENTINEL_PRIVATE/);
});

test('precedência efetiva preserva MP runtime e Brasil NFe ERP', () => {
  const row = { access_token: 'erp', refresh_token: 'erp-user' };
  assert.equal(config.resolveIntegrationConfiguration('mercadopago', row, { MERCADOPAGO_ACCESS_TOKEN: 'runtime' }).token.value, 'runtime');
  assert.equal(config.resolveIntegrationConfiguration('brasilnfe', row, { BRASILNFE_TOKEN: 'runtime' }).token.value, 'erp');
  assert.equal(config.resolveIntegrationConfiguration('brasilnfe', {}, { BRASILNFE_TOKEN: 'runtime' }).token.value, 'runtime');
  assert.equal(config.integrationSummaries([], { MERCADOPAGO_ACCESS_TOKEN: sentinel }).find(i => i.tipo === 'mercadopago').editable, false);
});

test('DTO não reproduz secrets via campos, URL ou erros', () => {
  const result = dto.toIntegrationConfigDto({ ...fiscal, client_secret: sentinel, refresh_token: sentinel, url: `https://user:${sentinel}@api.brasilnfe.com.br/services/`, last_refresh_error: sentinel, last_refresh_error_code: sentinel }, { BRASILNFE_TOKEN: sentinel, BRASILNFE_USER_TOKEN: sentinel });
  assert.equal(result.url, null);
  assert.equal(result.effective.tokenOrigin, 'erp');
  assert.equal(result.runtime.tokenConfigured, true);
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE/);
});

test('contratos recusam conectado, campos desconhecidos, token vazio; aceitam remoção explícita', () => {
  for (const tipo of ['dslite', 'brasilnfe', 'mercadopago']) {
    for (const values of [{ conectado: true }, { access_token: '' }, { access_token: '   ' }, { arbitrary: true }, {}]) assert.equal(contracts.integrationConfigurationSchema.safeParse({ tipo, values }).success, false);
    assert.equal(contracts.integrationConfigurationSchema.safeParse({ tipo, values: { access_token: null } }).success, true);
  }
});

test('destinos rejeitam SSRF, caminhos incorretos e produção em teste DSLite', async () => {
  for (const url of ['http://api.master.dev.dslite.com.br', 'https://127.0.0.1', 'https://api.master.dev.dslite.com.br.evil.invalid', 'https://user:pass@api.master.dev.dslite.com.br', 'https://api.master.dev.dslite.com.br?token=secret', 'https://api.master.dev.dslite.com.br/v1']) assert.equal(config.integrationUrlAllowed('dslite', url, true), false);
  let called = false;
  const result = await config.probeIntegration('dslite', { ...dslite, url: 'https://api.dslite.com.br' }, {}, async () => { called = true; });
  assert.equal(result.code, 'blocked'); assert.equal(called, false);
});

test('teste DSLite faz apenas GET de categorias, com redirect bloqueado', async () => {
  const result = await config.probeIntegration('dslite', dslite, {}, async (url, init) => {
    assert.match(url, /\/v1\/CrossDocking\/Categoria\?/); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Token, sentinel); return Response.json({ detalhesConsulta: {}, categorias: [] });
  });
  assert.equal(result.ok, true); assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE/);
});

test('teste fiscal é leitura em ambiente 2 e não retorna documentos', async () => {
  const result = await config.probeIntegration('brasilnfe', fiscal, {}, async (url, init) => {
    assert.equal(url, 'https://api.brasilnfe.com.br/services/fiscal/ObterNotasFiscais');
    const body = JSON.parse(init.body);
    assert.equal(body.TipoAmbiente, 2); assert.equal(body.TipoDocumentoFiscal, 1);
    assert.equal(body.DtInicio, '2026-09-04T00:00:00');
    assert.equal(body.IdentificadorInterno, 'BENTEVI_DEV_CONNECTION_CHECK');
    return Response.json({ Notas: [{ private: sentinel }], Error: null });
  }, new Date('2026-09-05T01:00:00Z'));
  assert.equal(result.ok, true); assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE/);
});

test('testes recusam HTTP 200 com payload inválido, erros, timeout e falha de rede', async () => {
  for (const payload of [null, {}, { Notas: [], Error: sentinel }, { Notas: [], erros: [{ descricao: sentinel }] }, { Notas: [], status: 1 }]) {
    const result = await config.probeIntegration('brasilnfe', fiscal, {}, async () => Response.json(payload));
    assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE/);
  }
  assert.equal((await config.probeIntegration('brasilnfe', fiscal, {}, async () => Response.json({ Notas: [] }))).ok, true);
  for (const name of ['TimeoutError', 'Error']) {
    const result = await config.probeIntegration('dslite', dslite, {}, async () => { const error = new Error(sentinel); error.name = name; throw error; });
    assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE/);
  }
  assert.equal((await config.probeIntegration('dslite', dslite, {}, async () => new Response(sentinel, { status: 401 }))).ok, false);
});

function mockDb(responses) {
  const calls = [];
  const client = { from(table) {
    calls.push(['from', table]);
    const query = {};
    for (const method of ['select', 'eq', 'order', 'update', 'insert', 'in']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
    query.maybeSingle = async () => responses.shift();
    query.then = (resolve) => Promise.resolve(responses.shift()).then(resolve);
    return query;
  } };
  return { client, calls };
}
function dependencies(db, admin = true) {
  return {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => db.client },
    '@/lib/auth/admin': { requireAdminUser: async () => admin ? { ok: true, user: { id: 'admin' }, nome: 'Admin' } : { ok: false, response: Response.json({ erro: 'Não autorizado' }, { status: 403 }) } },
    '@/lib/configuracoes/contracts': contracts,
    '@/lib/integration-config-dto': dto,
    '@/lib/integration-configuration': config,
    '@/services/configuration-audit': { recordConfigurationAudit: async () => [] },
  };
}
test('GET administrativo é sanitizado e não executa probes; falha de leitura não vira desconexão', async () => {
  const db = mockDb([{ data: [dslite], error: null }, { data: null, error: { message: sentinel } }]);
  const route = load('src/app/api/integracoes/config/route.ts', dependencies(db));
  const success = await route.GET(); assert.equal(success.status, 200); assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await success.text(), /SENTINEL_PRIVATE/);
  const failed = await route.GET(); assert.equal(failed.status, 500); assert.doesNotMatch(await failed.text(), /SENTINEL_PRIVATE/);
  assert.equal(db.calls.some(call => call[0] === 'update'), false);
});

test('PATCH administrativo exige admin e rejeita conectado antes de acessar o banco', async () => {
  const db = mockDb([]);
  for (const admin of [false, true]) {
    const route = load('src/app/api/integracoes/config/route.ts', dependencies(db, admin));
    const result = await route.PATCH(new Request('https://dev.bentevi.shop/api/integracoes/config', { method: 'PATCH', body: JSON.stringify({ tipo: 'dslite', values: { conectado: true } }) }));
    assert.equal(result.status, admin ? 422 : 403);
  }
  assert.equal(db.calls.length, 0);
});

test('PATCH invalida conexão, preserva secrets omitidos e faz controle de concorrência', async () => {
  const db = mockDb([{ data: dslite }, { data: { ...dslite, conectado: false } }]);
  const route = load('src/app/api/integracoes/config/route.ts', dependencies(db));
  const response = await route.PATCH(new Request('https://dev.bentevi.shop/api/integracoes/config', { method: 'PATCH', body: JSON.stringify({ tipo: 'dslite', values: { url: dslite.url } }) }));
  assert.equal(response.status, 200);
  const update = db.calls.find(c => c[0] === 'update')[1];
  assert.equal(update.conectado, false); assert.equal(Object.hasOwn(update, 'access_token'), false);
  assert.ok(db.calls.some(c => c[0] === 'eq' && c[1] === 'updated_at' && c[2] === dslite.updated_at));
});

test('resultado de teste obsoleto não valida uma configuração nova', async () => {
  const db = mockDb([{ data: dslite }, { data: null, error: null }]);
  const deps = dependencies(db);
  deps['@/lib/integration-configuration'] = { ...config, probeIntegration: async () => ({ ok: true, code: 'ok' }) };
  const route = load('src/services/integration-connection-test.ts', deps);
  const response = await route.testSavedIntegration('dslite');
  assert.equal(response.status, 409);
  assert.ok(db.calls.some(c => c[0] === 'eq' && c[1] === 'updated_at'));
});

test('interface mantém salvamento explícito e responsáveis existentes', () => {
  const source = fs.readFileSync('src/components/configuracoes/IntegracoesTab.tsx', 'utf8');
  assert.doesNotMatch(source, /onBlur|values:.*conectado|\/api\/integracao\/ml\/connect/);
  for (const text of ['Salvar alterações', 'Cancelar', '<Drawer', 'Remover valor cadastrado', 'tab=operacao']) assert.ok(source.includes(text));
});

test('shell reserva 24px abaixo das oito abas sem borda adicional', () => {
  const source = fs.readFileSync('src/app/(app)/configuracoes/page.tsx', 'utf8');
  assert.match(source, /margin: "0 0 24px"/);
  assert.doesNotMatch(source, /borderBottom:/);
  assert.equal(source.match(/key: "/g).length, 8);
});

test('cards renderizam dez serviços, assets locais e ações sem editar integrações runtime', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const overview = { integracoes: [], resumo: config.integrationSummaries([dslite], { MERCADOPAGO_ACCESS_TOKEN: sentinel }) };
  const states = ['missing', 'incomplete', 'configured', 'validated', 'reconnect', 'error'];
  overview.resumo.forEach((item, index) => { item.state = states[index % states.length]; });
  let hook = 0;
  const component = load('src/components/configuracoes/IntegracoesTab.tsx', {
    react: { ...React, useState: initial => React.useState(hook++ === 0 ? overview : hook === 2 ? false : initial) },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': require('next/link'), 'next/image': require('next/image'),
    antd: require('antd'), '@ant-design/icons': require('@ant-design/icons'),
    '@/lib/integration-configuration': config,
    './IntegracoesTab.module.css': { default: {}, __esModule: true },
    './ConfiguracoesTabHeading': heading,
  }).default;
  const html = renderToStaticMarkup(React.createElement(component, { messageApi: {} }));
  assert.equal((html.match(/data-integration=/g) || []).length, 10);
  for (const state of states) assert.ok(html.includes(config.INTEGRATION_STATE_LABELS[state]));
  assert.equal((html.match(/Gerenciada no servidor/g) || []).length, 6);
  assert.equal((html.match(/>Configurar</g) || []).length, 2);
  assert.equal((html.match(/>Ver detalhes</g) || []).length, 4);
  assert.match(html, /href="\/configuracoes\?tab=mercado-livre"/);
  assert.equal((html.match(/href="\/configuracoes\?tab=notificacoes"/g) || []).length, 3);
  assert.doesNotMatch(html, /Administrada pelo servidor\.|SENTINEL_PRIVATE|type="password"/);
  const assets = [...html.matchAll(/src="(\/branding\/integrations\/[^\"]+)"/g)];
  assert.equal(assets.length, 8);
  for (const [, asset] of assets) assert.ok(fs.existsSync(`public${asset}`));
});
