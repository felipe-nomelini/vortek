const assert = require('node:assert/strict');
const test = require('node:test');

const {
  requestDsliteResume,
} = require('../src/lib/dslite/resume-request.ts');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('preserva erro HTTP da rota interna sem tentar a URL pública', async () => {
  const calls = [];
  const result = await requestDsliteResume({
    urls: ['http://internal/api/dslite/pedido', 'https://public/api/dslite/pedido'],
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    fetcher: async (url) => {
      calls.push(url);
      return response(409, {
        error: 'Pedido bloqueado por divergência de identidade do anúncio.',
      });
    },
  });

  assert.deepEqual(calls, ['http://internal/api/dslite/pedido']);
  assert.deepEqual(result, {
    json: null,
    error: 'Pedido bloqueado por divergência de identidade do anúncio.',
  });
});

test('encerra o fallback quando a resposta HTTP tem corpo inválido', async () => {
  const calls = [];
  const result = await requestDsliteResume({
    urls: ['http://internal/api/dslite/pedido', 'https://public/api/dslite/pedido'],
    headers: {},
    body: '{}',
    fetcher: async (url) => {
      calls.push(url);
      return response(500, null);
    },
  });

  assert.deepEqual(calls, ['http://internal/api/dslite/pedido']);
  assert.deepEqual(result, {
    json: null,
    error: 'Resposta inválida da retomada DSLite (HTTP 500)',
  });
});

test('usa a URL pública somente após falha de rede na rota interna', async () => {
  const calls = [];
  const result = await requestDsliteResume({
    urls: ['http://internal/api/dslite/pedido', 'https://public/api/dslite/pedido'],
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    fetcher: async (url) => {
      calls.push(url);
      if (calls.length === 1) throw new TypeError('fetch failed');
      return response(202, { success: true, jobId: 'job-1' });
    },
  });

  assert.deepEqual(calls, [
    'http://internal/api/dslite/pedido',
    'https://public/api/dslite/pedido',
  ]);
  assert.deepEqual(result, {
    json: { success: true, jobId: 'job-1' },
    error: null,
  });
});

test('retorna a última falha de rede quando nenhuma URL responde', async () => {
  const errors = ['internal unavailable', 'public unavailable'];
  const result = await requestDsliteResume({
    urls: ['http://internal', 'https://public'],
    headers: {},
    body: '{}',
    fetcher: async () => {
      throw new TypeError(errors.shift());
    },
  });

  assert.deepEqual(result, { json: null, error: 'public unavailable' });
});
