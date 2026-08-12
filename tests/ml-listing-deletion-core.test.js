const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deleteMlListingPermanentlyWith,
} = require('../src/lib/ml/listing-deletion-core.ts');

test('fecha, tenta novamente no 409 e confirma deleted', async () => {
  const calls = [];
  const responses = [
    { ok: true, status: 200, data: { status: 'paused', sub_status: [] } },
    { ok: true, status: 200, data: { status: 'closed', sub_status: [] } },
    { ok: false, status: 409, data: null, error: { code: 'conflict', message: 'lock' } },
    { ok: true, status: 200, data: { status: 'closed', sub_status: ['deleted'] } },
    { ok: true, status: 200, data: { status: 'closed', sub_status: ['deleted'] } },
  ];
  const request = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body || null });
    return responses.shift();
  };

  const result = await deleteMlListingPermanentlyWith(request, 'MLB1', async () => {});
  assert.equal(result.ok, true);
  assert.equal(result.alreadyDeleted, false);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PUT', 'PUT', 'PUT', 'GET']);
  assert.equal(calls[1].body, JSON.stringify({ status: 'closed' }));
  assert.equal(calls[2].body, JSON.stringify({ deleted: true }));
});

test('under_review/forbidden vai direto para exclusão', async () => {
  const methods = [];
  const responses = [
    { ok: true, status: 200, data: { status: 'under_review', sub_status: ['forbidden'] } },
    { ok: true, status: 200, data: { status: 'closed', sub_status: ['deleted'] } },
    { ok: true, status: 200, data: { status: 'closed', sub_status: ['deleted'] } },
  ];
  const request = async (_path, options = {}) => {
    methods.push(options.method || 'GET');
    return responses.shift();
  };

  const result = await deleteMlListingPermanentlyWith(request, 'MLB2', async () => {});
  assert.equal(result.ok, true);
  assert.deepEqual(methods, ['GET', 'PUT', 'GET']);
});
