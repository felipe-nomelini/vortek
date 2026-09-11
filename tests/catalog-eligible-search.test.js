const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCatalogEligibleSearchPath,
  collectCatalogEligibleItemIds,
} = require('../src/lib/catalogo/eligible-search.ts');

test('mantém os filtros de elegibilidade ao avançar pelo cursor', () => {
  const path = buildCatalogEligibleSearchPath({
    sellerId: 123,
    statusMl: 'active',
    scrollId: 'cursor com espaço',
  });

  const url = new URL(path, 'https://api.mercadolibre.com');
  assert.equal(url.pathname, '/users/123/items/search');
  assert.equal(url.searchParams.get('search_type'), 'scan');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('tags'), 'catalog_listing_eligible');
  assert.equal(url.searchParams.get('status'), 'active');
  assert.equal(url.searchParams.get('scroll_id'), 'cursor com espaço');
});

test('encerra na primeira resposta quando já alcançou o total informado', async () => {
  const paths = [];
  const result = await collectCatalogEligibleItemIds({
    sellerId: 123,
    statusMl: 'all',
    fetchPage: async (path) => {
      paths.push(path);
      return {
        ok: true,
        data: {
          results: ['MLB1', 'MLB2'],
          scroll_id: 'cursor-que-nao-deve-ser-usado',
          paging: { total: 2 },
        },
      };
    },
  });

  assert.deepEqual(result, { ok: true, itemIds: ['MLB1', 'MLB2'] });
  assert.equal(paths.length, 1);
});

test('preserva filtros em todas as páginas e elimina IDs repetidos', async () => {
  const paths = [];
  const pages = [
    { results: ['MLB1', 'MLB2'], scroll_id: 'cursor-1', paging: { total: 3 } },
    { results: ['MLB2', 'MLB3'], scroll_id: 'cursor-2', paging: { total: 3 } },
  ];
  const result = await collectCatalogEligibleItemIds({
    sellerId: 456,
    statusMl: 'paused',
    fetchPage: async (path) => {
      paths.push(path);
      return { ok: true, data: pages.shift() };
    },
  });

  assert.deepEqual(result, { ok: true, itemIds: ['MLB1', 'MLB2', 'MLB3'] });
  assert.equal(paths.length, 2);
  for (const path of paths) {
    const url = new URL(path, 'https://api.mercadolibre.com');
    assert.equal(url.searchParams.get('tags'), 'catalog_listing_eligible');
    assert.equal(url.searchParams.get('status'), 'paused');
  }
  assert.equal(new URL(paths[1], 'https://api.mercadolibre.com').searchParams.get('scroll_id'), 'cursor-1');
});

test('interrompe um cursor repetido sem devolver uma lista enganosa', async () => {
  let calls = 0;
  const result = await collectCatalogEligibleItemIds({
    sellerId: 123,
    statusMl: 'all',
    fetchPage: async () => {
      calls += 1;
      return {
        ok: true,
        data: {
          results: [`MLB${calls}`],
          scroll_id: 'cursor-repetido',
          paging: { total: 5 },
        },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.itemIds, []);
  assert.match(result.error, /cursor repetido/i);
  assert.equal(calls, 2);
});

test('propaga falha de autenticação sem resultados parciais', async () => {
  const result = await collectCatalogEligibleItemIds({
    sellerId: 123,
    statusMl: 'all',
    fetchPage: async () => ({ ok: false, error: 'token inválido', authFatal: true }),
  });

  assert.deepEqual(result, {
    ok: false,
    itemIds: [],
    error: 'token inválido',
    authFatal: true,
  });
});
