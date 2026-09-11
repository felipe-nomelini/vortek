const test = require('node:test'); const assert = require('node:assert/strict');
const load = require('./helpers/load-integration-module');
const audit = load('src/services/pricing-audit.ts', { zod: require('zod') });
const { reconcileAnuncioMlFromItem } = load('src/lib/ml/reconcile-anuncio.ts', {
  '@/services/pricing-audit': audit, '@/lib/ml/status': { mapMlStatusToLocalStatus: () => 'ativo' },
  '@/lib/ml/operational-listing': { resolveMlPublishBlockPatch: () => ({}) },
});
const existing = { id: 'A1', produto_id: 'P1', ml_item_id: 'MLB1', preco_ml: 100, status: 'ativo', titulo: 'Item', permalink: null, thumbnail: null };
const item = { id: 'MLB1', price: 100, status: 'active', title: 'Item', last_updated: '2026-09-07T01:00:00Z' };
test('leitura igual passa pela trilha, sem declarar mudança econômica', async () => {
  let request;
  const result = await reconcileAnuncioMlFromItem({ rpc: async (_, args) => { request = args; return { data: args.p_rows }; } }, item, 'observed_sync', existing);
  assert.equal(result.updated, false); assert.equal(request.p_observed_at, item.last_updated);
});
test('falha de auditoria não retorna sucesso ao produtor', async () => {
  const result = await reconcileAnuncioMlFromItem({ rpc: async () => ({ error: { message: 'internal' } }) }, { ...item, price: 110 }, 'items_webhook', existing);
  assert.equal(result.ok, false); assert.equal(result.error, 'pricing_observation_persistence_failed');
});
test('fonte velha rejeitada pelo SQL propaga conflito sem falsificar preço aplicado', async () => {
  const result = await reconcileAnuncioMlFromItem({ rpc: async () => ({ data: [{ ml_item_id: 'MLB1', preco_ml: 120 }] }) }, { ...item, price: 110 }, 'items_webhook', existing);
  assert.equal(result.ok, false); assert.equal(result.error, 'pricing_observation_outdated_or_conflicting');
});
test('reconciliação observada corrige a classificação de catálogo sem alterar preço', async () => {
  let request;
  const result = await reconcileAnuncioMlFromItem({ rpc: async (_, args) => { request = args; return { data: args.p_rows }; } }, { ...item, catalog_listing: true }, 'observed_sync', { ...existing, catalogo: false });
  assert.equal(result.ok, true);
  assert.equal(result.updated, true);
  assert.equal(request.p_rows[0].catalogo, true);
  assert.equal(request.p_rows[0].preco_ml, 100);
});
