const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const PDF_PATH = path.resolve(
  process.env.ML_SHELF_PDF || '/home/felipe/Downloads/produtos-2026-08-10 (5).pdf',
);
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || 20));
const REPORT_DIR = path.resolve('reports/ml-profitable-shelf-2-2026-08-10');
const LISTING_TYPE = 'auto';

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function text(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hasImage(product) {
  return Array.isArray(product?.imagens) && product.imagens.some((value) => text(value));
}

function validPackage(product) {
  return [product?.altura, product?.largura, product?.profundidade, product?.peso_bruto]
    .map(Number)
    .every((value) => Number.isFinite(value) && value > 0);
}

function freight(product) {
  const stored = Number(product?.ml_shipping || 0);
  if (stored > 0) return { value: stored, source: 'erp' };
  const cost = Number(product?.custo || 0);
  const dimensions = [product?.altura, product?.largura, product?.profundidade].map(Number);
  const volume = dimensions.reduce((total, value) => total * value, 1);
  const highVolume = Number(product?.peso_bruto || 0) > 10 ||
    dimensions.some((value) => value > 100) || volume > 100000;
  if (cost > 400 || highVolume) return { value: 110, source: 'heuristic' };
  if (cost < 50) return { value: 6.5, source: 'heuristic' };
  if (cost <= 150) return { value: 25, source: 'heuristic' };
  return { value: 55, source: 'heuristic' };
}

function formulaPreview(product) {
  const cost = Number(product.custo);
  const shipping = freight(product);
  const mlFee = Number(product.ml_fee || 0.15);
  const margin = cost + shipping.value < 50 ? 0.08 : 0.25;
  const denominator = 1 - mlFee - 0.05 - margin;
  if (denominator <= 0) return null;
  return {
    cost,
    shipping: shipping.value,
    shippingSource: shipping.source,
    mlFee,
    das: 0.05,
    margin,
    price: Math.round(((cost + shipping.value) / denominator) * 100) / 100,
  };
}

function truncateWords(value, maxLength = 60) {
  const clean = text(value);
  if (clean.length <= maxLength) return clean;
  const sliced = clean.slice(0, maxLength + 1);
  const cut = sliced.lastIndexOf(' ');
  return (cut >= 36 ? sliced.slice(0, cut) : clean.slice(0, maxLength)).trim();
}

function seoFamilyName(product) {
  const raw = text(product.nome);
  const brand = text(product.marca);
  const palheta = raw.match(/\bpalheta\b/i);
  if (palheta && /\bbori\b/i.test(raw)) {
    const units = raw.match(/\b(\d+)\s*(?:un|unidades?)\b/i)?.[1] || '10';
    const gauge = raw.match(/\b(\d+[,.]\d+)\s*mm\b/i)?.[1]?.replace(',', '.');
    const color = raw.match(/\(([^)]+)\)/)?.[1] ||
      raw.match(/\b(azul|vermelho|verde(?:\s+esc)?|rosa|roxo|preto|amarelo)\b/i)?.[1];
    const parts = [`Kit ${units} Palhetas Bori`];
    if (gauge) parts.push(`${gauge}mm`);
    if (color) parts.push(text(color));
    parts.push('Para Guitarra E Violao');
    return truncateWords(parts.join(' '));
  }

  let name = raw
    .replace(/(\d+)\s*"/g, '$1 Polegadas ')
    .replace(/[-|/]+/g, ' ')
    .replace(/[()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (brand && !normalized(name).includes(normalized(brand))) name = `${name} ${brand}`;
  return truncateWords(name).replace(/[-|/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function blockReason(product) {
  if (!text(product?.sku)) return 'missing_sku';
  if (!text(product?.nome)) return 'missing_name';
  if (!text(product?.descricao)) return 'missing_description';
  if (!hasImage(product)) return 'missing_image';
  if (!validPackage(product)) return 'invalid_package';
  if (!(Number(product?.custo) > 0)) return 'invalid_cost';
  if (!(Number(product?.estoque) > 0)) return 'out_of_stock';
  if (!(Number(product?.ml_fee) > 0 && Number(product?.ml_fee) < 0.7)) return 'invalid_ml_fee';
  if (/\bwahl\b/i.test(`${product?.marca || ''} ${product?.nome || ''}`)) return 'blocked_brand_wahl';
  const seo = seoFamilyName(product);
  if (!seo || seo.length > 60 || /[-|/]/.test(seo)) return 'invalid_seo_title';
  if (!formulaPreview(product)) return 'invalid_price_formula';
  return null;
}

function pdfSkus() {
  if (!fs.existsSync(PDF_PATH)) throw new Error(`PDF não encontrado: ${PDF_PATH}`);
  const parsed = spawnSync('pdftotext', ['-layout', PDF_PATH, '-'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (parsed.error || parsed.status !== 0) {
    throw new Error(parsed.error?.message || parsed.stderr || 'Falha ao ler PDF');
  }
  return [...new Set((parsed.stdout.match(/VTK\d{6}/g) || []))];
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
    rows.push(...pageRows.map((row) => row.product || {}));
    if (pageRows.length === 0 || rows.length >= Number(data?.total || 0)) break;
  }
  return rows;
}

async function linkedProductIds(productIds) {
  const linked = new Set();
  for (let index = 0; index < productIds.length; index += 200) {
    const { data, error } = await supabase
      .from('anuncios_ml')
      .select('produto_id')
      .in('produto_id', productIds.slice(index, index + 200));
    if (error) throw new Error(error.message);
    for (const row of data || []) linked.add(String(row.produto_id));
  }
  return linked;
}

async function main() {
  const skus = pdfSkus();
  if (skus.length !== 689) throw new Error(`PDF deveria ter 689 SKUs únicos, mas contém ${skus.length}`);
  const candidates = await loadCandidates();
  const bySku = new Map(candidates.map((product) => [String(product.sku), product]));
  const missing = skus.filter((sku) => !bySku.has(sku));
  const extra = candidates.filter((product) => !skus.includes(String(product.sku)));
  if (missing.length > 0 || extra.length > 0 || candidates.length !== 689) {
    throw new Error(`PDF e ERP divergentes: ausentes=${missing.length}, extras=${extra.length}, ERP=${candidates.length}`);
  }
  const linked = await linkedProductIds(candidates.map((product) => product.id));
  const ready = [];
  const blocked = [];
  const reasonCounts = {};

  for (const sku of skus) {
    const product = bySku.get(sku);
    const reason = linked.has(String(product.id))
      ? 'already_linked_in_erp'
      : text(product.ml_item_id)
        ? 'already_has_ml_item_id'
        : blockReason(product);
    if (reason) {
      blocked.push({
        produtoId: product.id,
        sku,
        nome: product.nome,
        fornecedor: product.fornecedor,
        reason,
      });
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      continue;
    }
    ready.push({
      produtoId: product.id,
      sku,
      nome: product.nome,
      fornecedor: product.fornecedor,
      custo: Number(product.custo),
      estoque: Number(product.estoque),
      pricingMode: 'profitable_shelf_2',
      listingType: LISTING_TYPE,
      familyName: seoFamilyName(product),
      strictFirstCategory: true,
      formulaPreview: formulaPreview(product),
    });
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const fileName of fs.readdirSync(REPORT_DIR)) {
    if (/^\d{3}-profitable-shelf-2-create-\d{3}\.json$/.test(fileName)) {
      fs.unlinkSync(path.join(REPORT_DIR, fileName));
    }
  }
  const batches = [];
  for (let index = 0; index < ready.length; index += BATCH_SIZE) {
    const number = batches.length + 1;
    const fileName = `${String(number).padStart(3, '0')}-profitable-shelf-2-create-${String(number).padStart(3, '0')}.json`;
    const manifest = {
      batchNumber: number,
      batchId: `profitable-shelf-2-create-${String(number).padStart(3, '0')}`,
      strategy: 'profitable_shelf_2',
      items: ready.slice(index, index + BATCH_SIZE),
    };
    fs.writeFileSync(path.join(REPORT_DIR, fileName), JSON.stringify(manifest, null, 2));
    batches.push(fileName);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sourcePdf: PDF_PATH,
    sourcePdfSha256: crypto.createHash('sha256').update(fs.readFileSync(PDF_PATH)).digest('hex'),
    pdfSkus: skus.length,
    erpCandidates: candidates.length,
    readyForMlPreflight: ready.length,
    blockedBeforeMlPreflight: blocked.length,
    blockedReasonCounts: reasonCounts,
    batchSize: BATCH_SIZE,
    batchCount: batches.length,
    priceRule: {
      formula: '(custo + frete) / (1 - taxa_ml - 0.05 - margem)',
      offensive: 'custo + frete < 50 => 8%',
      defensive: 'custo + frete >= 50 => 25%',
    },
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'ready-items.json'), JSON.stringify(ready, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, 'blocked-base.json'), JSON.stringify(blocked, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
