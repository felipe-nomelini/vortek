const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const loadIntegrationModule = require('./helpers/load-integration-module');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/anuncios/page.tsx');
const styles = read('src/app/(app)/anuncios/anuncios.module.css');
const route = read('src/services/ml-listings-query.ts');
const statusRoute = read('src/app/api/anuncios/status-lote/route.ts');
const detailRoute = read('src/app/api/ml/anuncio/preco-detalhe/route.ts') + read('src/services/pricing-detail.ts');
const priceRoute = read('src/app/api/ml/anuncio/atualizar-preco/route.ts');
const fixture = read('src/lib/ml/listings-dashboard.ts');
const migration = read('supabase/migrations/20260902170000_bnt_d11_ml_listings_search.sql');
const { selectMlListingRows } = loadIntegrationModule('src/lib/ml/listings-dashboard.ts', {
  '@/lib/products/bnt-d07-visual-review': { pricingFor: () => ({ profit: null, margin: null }) },
});

test('BNT-D11 organiza anúncios por decisão operacional', () => {
  for (const label of ['Total monitorado', 'Ativos', 'Pausados', 'Qualidade em risco', 'Preço em revisão']) {
    assert.match(page, new RegExp(label));
  }
  for (const column of ['Anúncio', 'Produto', 'Preço e resultado', 'Histórico acumulado', 'Qualidade', 'Estado', 'Catálogo', 'Ações']) {
    assert.match(page, new RegExp(`title: '${column}'`));
  }
  assert.match(page, /Analisar/);
  assert.match(page, /Análise do anúncio/);
  assert.match(styles, /var\(--bentevi-primary/);
});

test('BNT-D11 separa as contagens dos rótulos nas filas rápidas', () => {
  assert.match(page, /styles\.quickViewLabel/);
  assert.equal((page.match(/styles\.quickViewCount/g) || []).length, 7);
  assert.match(page, /Com vendas/);
  assert.match(page, /Com visitas, sem vendas/);
  assert.match(styles, /\.quickViewCount[\s\S]*linear-gradient\(135deg, rgba\(255, 189, 14, 0\.14\), rgba\(255, 189, 14, 0\.02\)\)/);
  assert.match(styles, /font-variant-numeric: tabular-nums/);
});

test('BNT-D11 pagina, filtra, resume e ordena em uma única RPC', () => {
  assert.match(route, /rpc\('search_ml_listings_paginated'/);
  assert.doesNotMatch(route, /\.from\('anuncios_ml'\)/);
  assert.match(migration, /row_number\(\) over/);
  assert.match(migration, /'metrics', jsonb_build_object/);
  assert.match(migration, /'queueCounts', jsonb_build_object/);
  assert.match(migration, /listing\.item_id asc/);
  assert.doesNotMatch(migration, /create index/i);
  assert.equal(fs.existsSync(path.join(root, 'src/app/api/anuncios/resumo/route.ts')), false);
});

test('BNT-D11 só classifica qualidade quando a fonte é o endpoint de performance', () => {
  assert.match(migration, /qualidade_info ->> 'source' = 'mercado_livre_performance'/);
  assert.match(migration, /quality_available and quality_score < 80/);
  assert.match(fixture, /qualityInfo\?\.source === 'mercado_livre_performance'/);
  assert.match(page, /Leitura não disponível/);
  assert.match(page, /Nota disponível somente no Mercado Livre/);
  assert.match(route, /soldOnly/);
});

test('BNT-D11 preserva diagnóstico de catálogo e instruções dos objetivos', () => {
  const syncRoute = read('src/app/api/sync/anuncios/route.ts');
  assert.match(syncRoute, /mercado_livre_catalog_quality/);
  assert.match(syncRoute, /catalog_quality\/status\?item_id=/);
  assert.match(syncRoute, /regras:/);
  assert.match(syncRoute, /performance_message/);
  assert.match(syncRoute, /catalog_quality: normalizeCatalogQuality/);
  assert.match(page, /catalog_quality\?\.missing_attributes/);
  assert.match(fixture, /qualityUnavailableReason/);
  assert.match(route, /qualityScore: row\.qualityAvailable \? row\.qualityScore : null/);
});

test('BNT-D11 prioriza anúncios ativos com visitas e sem vendas', () => {
  assert.match(route, /visited_unsold/);
  assert.match(fixture, /focus === 'visited_unsold'/);
  assert.match(fixture, /row\.observedStatus === 'active' && row\.visits > 0 && row\.sold <= 0/);
  assert.match(route, /focus === 'visited_unsold' \? 'visits' : 'product'/);
  assert.match(page, /sortBy: 'visits', sortOrder: 'desc'/);

  const base = {
    itemId: 'MLB1', productId: 'P1', productSku: 'SKU1', productName: 'Produto', listingTitle: 'Produto',
    thumbnail: null, permalink: null, listingType: 'standard', catalogProductId: null, relatedItemId: null,
    price: 10, profit: 1, marginPercent: 10, sold: 0, visits: 5, qualityScore: 70, qualityAvailable: true,
    qualityPrimaryIssue: null, qualityInfo: null, qualityUnavailableReason: null, observedStatus: 'active',
    localStatus: 'ativo', blockReason: null, blockedUntil: null, lastError: null, catalogStatus: 'sem_catalogo',
    priceToWin: null, catalogSyncedAt: null, listingSyncedAt: null, isOperational: true, latestPublish: null,
  };
  const result = selectMlListingRows([
    base,
    { ...base, itemId: 'MLB2', visits: 12 },
    { ...base, itemId: 'MLB3', sold: 1, visits: 30 },
    { ...base, itemId: 'MLB4', observedStatus: 'paused', visits: 20 },
  ], {
    page: 1, pageSize: 100, search: '', focus: 'visited_unsold', quality: 'all', catalog: 'all',
    profitability: 'all', priceMin: null, priceMax: null, sortBy: 'visits', sortOrder: 'desc', soldOnly: false,
  });
  assert.equal(result.metrics.visitedUnsold, 2);
  assert.deepEqual(result.data.map((row) => row.itemId), ['MLB2', 'MLB1']);
});

test('BNT-D11 usa alíquota dinâmica e mantém cálculo de rentabilidade no backend', () => {
  assert.match(route, /loadPricingRequestContext/);
  assert.match(route, /loadProductPricing/);
  assert.match(migration, /base\.price \* p_tax_rate/);
  assert.doesNotMatch(migration, /base\.price \* 0\.0[45]/);
  assert.match(migration, /raise exception 'p_tax_rate inválida/);
});

test('BNT-D11 altera um preço único nos anúncios padrão e catálogo vinculados', () => {
  assert.match(page, /scope: 'linked'/);
  assert.match(page, /O mesmo preço será aplicado ao anúncio padrão e ao anúncio de catálogo/);
  assert.match(page, /result\.type === 'catalog'/);
  assert.match(priceRoute, /getPricingExecutionBlock/);
  assert.match(page, /useMlPricePublishTracking/);
  assert.match(page, /atualizar-preco\/status\?outboxId/);
});

test('BNT-D11 detecta preço automático antes de habilitar edição manual', () => {
  assert.match(detailRoute, /automaticPricing/);
  assert.match(detailRoute, /hasMlAutomaticPrice\(item\)/);
  assert.match(priceRoute, /getPricingExecutionBlock/);
  assert.match(page, /details\.automaticPricing\?\.active/);
  assert.match(page, /Preço automático ativo no Mercado Livre/);
});

test('BNT-D11 altera status somente pelo anúncio operacional e relata cada item', () => {
  assert.match(page, /row\.isOperational && row\.productId/);
  assert.match(page, /Anúncios irmãos de catálogo não serão alterados diretamente/);
  assert.match(page, /\/api\/anuncios\/status-lote/);
  assert.match(statusRoute, /select\('id, sku, ml_item_id, custom_price, estoque, ml_status'\)/);
  assert.match(statusRoute, /items,/);
  for (const outcome of ['queued', 'already_target', 'unchanged', 'skipped_no_item', 'skipped_ineligible', 'failed']) {
    assert.match(statusRoute, new RegExp(outcome));
  }
});

test('BNT-D11 acompanha atualização observada sem polling silencioso', () => {
  assert.match(page, /\/api\/sync\/anuncios\/job/);
  assert.match(page, /\/api\/sync\/anuncios\/status\?jobId/);
  assert.match(page, /syncFailures/);
  assert.match(page, /Tentar novamente/);
  assert.doesNotMatch(page, /catch \{\}/);
});

test('BNT-D11 reutiliza a amostra real protegida e bloqueia mutações', () => {
  assert.match(route, /loadBntD07VisualReview\(\)/);
  assert.match(route, /listBntD11VisualReview/);
  assert.match(fixture, /isHomologationFixture: true/);
  assert.match(page, /Amostra protegida, somente leitura/);
  assert.match(page, /Atualização, preço, situação e links externos permanecem bloqueados/);
  assert.doesNotMatch(fixture, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});

test('RPC BNT-D11 aplica privilégio mínimo e search_path seguro', () => {
  assert.match(migration, /stable/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
});

test('BNT-D11 exporta o conjunto filtrado pelo relatório redesenhado', () => {
  assert.match(page, /Exportar o conjunto filtrado em PDF/);
  assert.match(page, /\/api\/anuncios\/exportar-pdf/);
  for (const filter of ['focus', 'soldOnly', 'quality', 'catalog', 'profitability', 'search', 'priceMin', 'priceMax']) {
    assert.match(page, new RegExp(filter));
  }
  assert.match(page, /appendRemoteSortParams\(params, sort\)/);
});
