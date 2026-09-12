const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

function service(token = 'ml-oauth') {
  return load('src/services/mercadopago.ts', {
    '@/services/integration': { getValidMLToken: async () => token },
    '@/lib/mercadopago-account-money': require('../src/lib/mercadopago-account-money.ts'),
  });
}

test('relatórios usam a credencial OAuth do Mercado Livre', async () => {
  const api = service();
  let authorization = null;
  const result = await api.probeMercadoPagoReportAccess(async (_url, init) => {
    authorization = init.headers.Authorization;
    return Response.json({ results: [], paging: { total: 0, limit: 1, offset: 0 } });
  }, new Date('2026-09-12T12:00:00.000Z'));
  assert.equal(authorization, 'Bearer ml-oauth');
  assert.equal(result.ok, true);
  assert.match(result.message, /Mercado Livre/);
});

test('autorização recusada vira diagnóstico de reconexão sem expor resposta', async () => {
  const api = service();
  const result = await api.probeMercadoPagoReportAccess(async () => new Response('private-provider-body', { status: 401 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'authentication');
  assert.doesNotMatch(JSON.stringify(result), /private-provider-body/);
});
