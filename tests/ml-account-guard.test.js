const assert = require('node:assert/strict');
const test = require('node:test');

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test('classifica token inválido sem acusar conta diferente', async () => {
  global.fetch = async () => new Response(
    JSON.stringify({ message: 'invalid access token' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );

  const { validateMercadoLivreTokenOwner } = require('../src/lib/ml-account-guard.ts');
  const result = await validateMercadoLivreTokenOwner('expired-token');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'token_invalid');
  assert.equal(result.error, 'invalid access token');
});

test('classifica indisponibilidade do provedor como falha transitória', async () => {
  global.fetch = async () => new Response(
    JSON.stringify({ message: 'service unavailable' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );

  const { validateMercadoLivreTokenOwner } = require('../src/lib/ml-account-guard.ts');
  const result = await validateMercadoLivreTokenOwner('token');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_error');
});

test('rejeita somente identidade válida pertencente a outra conta', async () => {
  global.fetch = async () => new Response(
    JSON.stringify({ id: 999999, nickname: 'OUTRA_CONTA' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  const { validateMercadoLivreTokenOwner } = require('../src/lib/ml-account-guard.ts');
  const result = await validateMercadoLivreTokenOwner('valid-other-account-token');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'account_not_allowed');
  assert.match(result.error, /^ml_account_not_allowed:/);
});

test('não permite token apenas pelo apelido Vortek', async () => {
  global.fetch = async () => new Response(
    JSON.stringify({ id: 999999, nickname: 'VORTEK' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  const { validateMercadoLivreTokenOwner } = require('../src/lib/ml-account-guard.ts');
  const result = await validateMercadoLivreTokenOwner('wrong-id-right-nickname');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'account_not_allowed');
});

test('aceita somente user_id VORTEKTECNOLOGIA em webhooks', () => {
  const { validateMercadoLivreWebhookUser } = require('../src/lib/ml-account-guard.ts');

  assert.deepEqual(validateMercadoLivreWebhookUser(3294514937), {
    allowed: true,
    userId: '3294514937',
    reason: 'allowed',
  });
  assert.deepEqual(validateMercadoLivreWebhookUser(86068464), {
    allowed: false,
    userId: '86068464',
    reason: 'user_id_not_allowed',
  });
  assert.deepEqual(validateMercadoLivreWebhookUser(undefined), {
    allowed: false,
    userId: null,
    reason: 'user_id_missing',
  });
});
