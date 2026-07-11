const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const BATCH_SIZE = Number(process.env.ML_BATCH_SIZE || '25');
const REPORT_ROOT = path.join(process.cwd(), 'reports', 'ml-anuncio-batches');

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function hasPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasImage(product) {
  return Array.isArray(product.imagens) && product.imagens.some(hasText);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isBlockedMlBrand(product) {
  return /\bwahl\b/.test(normalizeText(`${product?.marca || ''} ${product?.nome || ''}`));
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getPricingStrategy(cost) {
  if (cost <= 400) return { margin: 0.15, minProfit: 20 };
  if (cost <= 1000) return { margin: 0.2, minProfit: 60 };
  return { margin: 0.25, minProfit: 150 };
}

function calculateSuggestedPricePreview(product) {
  const cost = Number(product.custo || 0);
  const shipping = Number(product.ml_shipping || 0);
  const mlFee = Number(product.ml_fee || 0.15);
  const strategy = getPricingStrategy(cost);
  const denominator = 1 - (0.04 + mlFee);
  if (!Number.isFinite(cost) || cost <= 0 || denominator <= 0) return null;
  const priceByMargin = (cost + shipping + (cost * strategy.margin)) / denominator;
  const priceByMinProfit = (cost + shipping + strategy.minProfit) / denominator;
  return round2(Math.max(priceByMargin, priceByMinProfit));
}

function getBlockReason(product) {
  if (hasText(product.ml_item_id)) return 'already_has_ml_item_id';
  if (!hasText(product.sku)) return 'missing_sku';
  if (!hasText(product.nome)) return 'missing_name';
  if (!hasPositiveNumber(product.custo)) return 'invalid_cost';
  if (!hasPositiveNumber(product.estoque)) return 'out_of_stock';
  if (isBlockedMlBrand(product)) return 'blocked_brand_wahl';
  return null;
}

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function loadCandidates() {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.rpc('search_produtos_paginated', {
      p_search: null,
      p_supplier_dslite_ids: null,
      p_product_active_status: 'ativo',
      p_ml_status: 'sem_anuncio',
      p_estoque: 'com_estoque',
      p_price_min: null,
      p_price_max: null,
      p_price_field: 'cost',
      p_page: page,
      p_page_size: 100,
      p_sort_by: 'sku',
      p_sort_order: 'asc',
    });
    if (error) throw new Error(error.message);
    const pageRows = data?.data || [];
    rows.push(...pageRows);
    if (pageRows.length === 0 || rows.length >= Number(data?.total || 0)) break;
  }
  return rows;
}

async function loadLinkedProductIds(productIds) {
  const linked = new Set();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data, error } = await supabase
      .from('anuncios_ml')
      .select('produto_id')
      .in('produto_id', productIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const row of data || []) linked.add(String(row.produto_id));
  }
  return linked;
}

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_ROOT, stamp);
  fs.mkdirSync(reportDir, { recursive: true });

  const rows = await loadCandidates();
  const productIds = rows.map((row) => row.product?.id).filter(Boolean);
  const linkedProductIds = await loadLinkedProductIds(productIds);

  const actionable = [];
  const blocked = [];
  const skippedExisting = [];
  const reasonCounts = {};

  for (const row of rows) {
    const product = row.product || {};
    const productId = String(product.id || '').trim();
    if (!productId) continue;

    if (linkedProductIds.has(productId) || hasText(product.ml_item_id)) {
      skippedExisting.push({
        produtoId: productId,
        sku: product.sku || '',
        nome: product.nome || '',
        reason: hasText(product.ml_item_id) ? 'already_has_ml_item_id' : 'already_linked_in_anuncios_ml',
      });
      continue;
    }

    const reason = getBlockReason(product);
    if (reason) {
      blocked.push({
        produtoId: productId,
        sku: product.sku || '',
        nome: product.nome || '',
        fornecedor: product.fornecedor || null,
        dsliteFornecedorId: product.dslite_fornecedor_id || null,
        custo: round2(product.custo),
        estoque: Number(product.estoque || 0),
        reason,
      });
      reasonCounts[reason] = Number(reasonCounts[reason] || 0) + 1;
      continue;
    }

    const suggestedPricePreview = calculateSuggestedPricePreview(product);
    actionable.push({
      produtoId: productId,
      sku: product.sku || '',
      nome: product.nome || '',
      fornecedor: product.fornecedor || null,
      dsliteFornecedorId: product.dslite_fornecedor_id || null,
      custo: round2(product.custo),
      estoque: Number(product.estoque || 0),
      mlFee: Number(product.ml_fee || 0.15),
      mlShipping: round2(product.ml_shipping),
      customPrice: product.custom_price === null || product.custom_price === undefined ? null : round2(product.custom_price),
      suggestedPricePreview,
      priceSource: product.custom_price === null || product.custom_price === undefined ? 'pricing_strategy_preview' : 'custom_price',
      pricingStrategy: getPricingStrategy(Number(product.custo || 0)),
      strategyNotes: 'Na execução, usar schema/base_price do sistema para recalcular taxa ML real e respeitar custom_price quando existir.',
    });
  }

  actionable.sort((a, b) => {
    if (a.custo !== b.custo) return a.custo - b.custo;
    return String(a.sku).localeCompare(String(b.sku), 'pt-BR');
  });

  const batches = chunk(actionable, BATCH_SIZE).map((items, index) => ({
    batchNumber: index + 1,
    batchId: `ml-create-${String(index + 1).padStart(3, '0')}`,
    strategy: 'safe_small_batch',
    executionHints: {
      delayMs: 1500,
      listingType: 'gold_pro',
      useSchemaBasePrice: true,
      applyPricingStrategyAtRuntime: true,
      stopIfFailureRateOver: 0.5,
    },
    items,
  }));

  const summary = {
    generatedAt: new Date().toISOString(),
    batchSize: BATCH_SIZE,
    rpcCandidatesSeen: rows.length,
    skippedExistingCount: skippedExisting.length,
    readyCount: actionable.length,
    blockedCount: blocked.length,
    batchCount: batches.length,
    expectedOriginalCreateUniverse: actionable.length + blocked.length,
    priceRule: {
      upto400: { margin: 0.15, minProfit: 20 },
      upto1000: { margin: 0.2, minProfit: 60 },
      above1000: { margin: 0.25, minProfit: 150 },
      taxRate: 0.04,
      runtimeSourceOfTruth: 'src/services/pricing.ts + /api/ml/anuncio/schema',
    },
    blockedReasonCounts: reasonCounts,
    files: {
      batchesDir: reportDir,
      summary: path.join(reportDir, 'summary.json'),
      blocked: path.join(reportDir, 'blocked-items.json'),
      skippedExisting: path.join(reportDir, 'skipped-existing.json'),
    },
  };

  fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportDir, 'blocked-items.json'), JSON.stringify(blocked, null, 2));
  fs.writeFileSync(path.join(reportDir, 'skipped-existing.json'), JSON.stringify(skippedExisting, null, 2));
  batches.forEach((batch) => {
    fs.writeFileSync(
      path.join(reportDir, `${String(batch.batchNumber).padStart(3, '0')}-${batch.batchId}.json`),
      JSON.stringify(batch, null, 2),
    );
  });

  fs.writeFileSync(path.join(REPORT_ROOT, 'latest-path.txt'), `${reportDir}\n`);
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
