const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const root = process.cwd();
const worker = fs.readFileSync(path.join(root, 'src/services/ui-read-model.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260922160000_ui_catalog_read_models.sql'), 'utf8');
const subject = load('src/services/ui-read-model-query.ts', { 'server-only': {} });

test('códigos de anúncios padrão e catálogo entram no documento de busca do produto', () => {
  assert.match(worker, /\.\.\.linkedListings\.map\(\(listing\) => listing\.itemId\)/);
  assert.match(worker, /loadProductMlListings/);
  assert.match(migration, /projection\.search_document ilike '%' \|\| trim\(p_search\) \|\| '%'/);
});

test('busca por anúncio consulta diretamente a projeção paginada uma única vez', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { data: [{ product: { id: 'produto-1' } }], total: 1 }, error: null };
  } };
  const result = await subject.queryProductReadModel(client, {
    p_search: 'mlb7295377986', p_page: 1, p_page_size: 100,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'search_ui_product_projection');
  assert.equal(calls[0].args.p_search, 'mlb7295377986');
  assert.equal(result.total, 1);
});

test('código ausente não exige consulta paralela às tabelas canônicas', () => {
  const query = fs.readFileSync(path.join(root, 'src/services/ui-read-model-query.ts'), 'utf8');
  assert.doesNotMatch(query, /\.from\('(anuncios_ml|catalogo_ml_snapshot|produtos)'\)/);
});
