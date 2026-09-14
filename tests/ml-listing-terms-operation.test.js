const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeMlListingTermsWith } = require('../scripts/lib/ml-listing-terms-operation');

function item(patch = {}) {
  return {
    id: 'MLB1', status: 'active', price: 60, listing_type_id: 'gold_pro',
    shipping: { free_shipping: true }, title: 'Produto', available_quantity: 4,
    ...patch,
  };
}

test('altera tipo, confirma, altera frete e confirma sem tocar preço/estoque/título', async () => {
  const calls = [];
  const responses = [
    { ok: true, status: 200, data: item() },
    { ok: true, status: 200, data: {} },
    { ok: true, status: 200, data: item({ listing_type_id: 'gold_special' }) },
    { ok: true, status: 200, data: {} },
    { ok: true, status: 200, data: item({ listing_type_id: 'gold_special', shipping: { free_shipping: false } }) },
  ];
  const request = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body || null });
    return responses.shift();
  };

  const result = await normalizeMlListingTermsWith(request, 'MLB1');
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET', 'PUT', 'GET']);
  assert.equal(calls[1].body, JSON.stringify({ id: 'gold_special' }));
  assert.equal(calls[3].body, JSON.stringify({ shipping: { free_shipping: false } }));
});

test('não escreve quando o anúncio já está correto ou sai do recorte', async () => {
  for (const current of [
    item({ listing_type_id: 'gold_special', shipping: { free_shipping: false } }),
    item({ price: 70 }),
    item({ status: 'paused' }),
  ]) {
    const calls = [];
    const result = await normalizeMlListingTermsWith(async (_path, options = {}) => {
      calls.push(options.method || 'GET');
      return { ok: true, status: 200, data: current };
    }, 'MLB1');
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['GET']);
  }
});

test('interrompe antes de escrever quando o frete grátis se torna obrigatório', async () => {
  const calls = [];
  const result = await normalizeMlListingTermsWith(async (_path, options = {}) => {
    calls.push(options.method || 'GET');
    return { ok: true, status: 200, data: item({ tags: ['mandatory_free_shipping'] }) };
  }, 'MLB1');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'mandatory_free_shipping');
  assert.deepEqual(calls, ['GET']);
});

test('não envia frete depois que o preço muda no read-back da exposição', async () => {
  const calls = [];
  const responses = [
    { ok: true, status: 200, data: item() },
    { ok: true, status: 200, data: {} },
    { ok: true, status: 200, data: item({ price: 71, listing_type_id: 'gold_special' }) },
  ];
  const result = await normalizeMlListingTermsWith(async (_path, options = {}) => {
    calls.push(options.method || 'GET');
    return responses.shift();
  }, 'MLB1');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ml_listing_unexpected_field_change');
  assert.deepEqual(calls, ['GET', 'POST', 'GET']);
});
