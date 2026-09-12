const assert = require('node:assert/strict');
const test = require('node:test');

const originalFetch = global.fetch;
const originalEnv = {
  token: process.env.GITHUB_OPS_TOKEN,
  owner: process.env.GITHUB_OWNER,
  repo: process.env.GITHUB_REPO,
};

test.after(() => {
  global.fetch = originalFetch;
  process.env.GITHUB_OPS_TOKEN = originalEnv.token;
  process.env.GITHUB_OWNER = originalEnv.owner;
  process.env.GITHUB_REPO = originalEnv.repo;
});

test('comenta e fecha somente issues abertas de integração recuperada', async () => {
  process.env.GITHUB_OPS_TOKEN = 'test-token';
  process.env.GITHUB_OWNER = 'owner';
  process.env.GITHUB_REPO = 'repo';

  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if ((options.method || 'GET') === 'GET') {
      return {
        ok: true,
        text: async () =>
          JSON.stringify([
            {
              number: 10,
              body: 'vortek-fingerprint:integration_status:integration_status:WAHA: STARTING',
              state: 'open',
            },
            {
              number: 11,
              body: 'vortek-fingerprint:critical_error:job_error',
              state: 'open',
            },
          ]),
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ html_url: 'https://example.test/issue/10' }),
    };
  };

  const { resolveOpenIntegrationOpsIssues } = require('../src/services/github-ops.ts');
  const result = await resolveOpenIntegrationOpsIssues('Recuperado.');

  assert.deepEqual(result, { resolved: 1 });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[1].url, /issues\/10\/comments$/);
  assert.equal(calls[2].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[2].body), {
    state: 'closed',
    state_reason: 'completed',
  });
});

test('fecha somente alertas stale das tasks comprovadamente recuperadas', async () => {
  process.env.GITHUB_OPS_TOKEN = 'test-token';
  process.env.GITHUB_OWNER = 'owner';
  process.env.GITHUB_REPO = 'repo';

  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if ((options.method || 'GET') === 'GET') {
      return {
        ok: true,
        text: async () => JSON.stringify([
          { number: 20, body: 'vortek-fingerprint:critical_error:sync_schedule_stale:sync_dslite_preco_estoque', state: 'open' },
          { number: 21, body: 'vortek-fingerprint:critical_error:sync_schedule_stale:sync_dslite_catalogo', state: 'open' },
          { number: 22, body: 'vortek-fingerprint:critical_error:job_error:sync_dslite_preco_estoque', state: 'open' },
        ]),
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify({ html_url: 'https://example.test/issue/20' }),
    };
  };

  const { resolveRecoveredScheduledTaskOpsIssues } = require('../src/services/github-ops.ts');
  const result = await resolveRecoveredScheduledTaskOpsIssues(
    ['sync_dslite_preco_estoque'],
    'Recuperado.',
  );

  assert.deepEqual(result, { resolved: 1 });
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /issues\/20\/comments$/);
  assert.match(String(calls[1].body), /sync_dslite_preco_estoque/);
  assert.match(calls[2].url, /issues\/20$/);
});

test('sanitiza payloads e textos antes de publicar no GitHub', () => {
  const { sanitizeOpsPayload, sanitizeOpsText } = require('../src/services/github-ops.ts');
  const secret = 'a'.repeat(64);
  const payload = sanitizeOpsPayload({
    access_token: secret,
    nested: { authorization: `Bearer ${secret}`, email: 'pessoa@example.com' },
    status: 'erro',
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /pessoa@example\.com/);
  assert.match(serialized, /dado protegido/);
  assert.equal(payload.status, 'erro');
  assert.doesNotMatch(sanitizeOpsText(`Authorization: Bearer ${secret}`), new RegExp(secret));
});

test('fecha somente a ocorrência recuperada do mesmo registro', async () => {
  process.env.GITHUB_OPS_TOKEN = 'test-token';
  process.env.GITHUB_OWNER = 'owner';
  process.env.GITHUB_REPO = 'repo';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if ((options.method || 'GET') === 'GET') return {
      ok: true,
      text: async () => JSON.stringify([
        { number: 30, body: 'vortek-fingerprint:critical_error:job_error:dslite_criar_pedido:pedido:111:invalid_ncm_778' },
        { number: 31, body: 'vortek-fingerprint:critical_error:job_error:dslite_criar_pedido:pedido:222:invalid_ncm_778' },
      ]),
    };
    return { ok: true, text: async () => JSON.stringify({ html_url: 'https://example.test/issue/30' }) };
  };
  const { resolveRecoveredCriticalJobOpsIssues } = require('../src/services/github-ops.ts');
  const result = await resolveRecoveredCriticalJobOpsIssues([
    'vortek-fingerprint:critical_error:job_error:dslite_criar_pedido:pedido:111:invalid_ncm_778',
  ], 'Recuperado.');
  assert.deepEqual(result, { resolved: 1 });
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.match(calls.find((call) => call.method === 'PATCH').url, /issues\/30$/);
});
