/* Prepara anúncios de kits simples BKR1 cadastrados a partir de uma planilha.
 *
 * Uso:
 *   node scripts/prepare-bkr1-kit-sheet-listings.js --file "/caminho/Elixir.xls"
 *   node scripts/prepare-bkr1-kit-sheet-listings.js --file "/caminho/Elixir.xls" --mirror-images
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local' });

const FILE_INDEX = process.argv.indexOf('--file');
const SOURCE_FILE = FILE_INDEX >= 0 ? path.resolve(process.argv[FILE_INDEX + 1] || '') : '';
const MIRROR_IMAGES = process.argv.includes('--mirror-images');
const SUPPLIER_ID = '108';
const CATEGORY_ID = 'MLB278076';
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '5'));
const BUCKET = 'product-images';
const STORAGE_PREFIX =
  'https://supabase.vortek.shop/storage/v1/object/public/product-images/';
const REPORT_ROOT = path.join(process.cwd(), 'reports', 'ml-anuncio-batches');

const SHEET_CONFIGS = {
  elixir: {
    brand: 'Elixir',
    models: {
      1421: '11002',
      1422: '11027',
      1423: '11052',
      1424: '12002',
      1425: '12027',
      1426: '12052',
      1427: '12102',
      1428: '16002',
      1429: '16027',
      1430: '19052',
      2042: 'Cordas 013 Medium 80/20 Nanoweb',
      2043: '16052',
      2496: '19002',
      2497: '19102',
    },
    attributes: {},
  },
  nig: {
    brand: 'NIG',
    models: {
      1403: 'N475',
      1404: 'N500',
      1405: 'N511',
      1406: 'N63',
      1407: 'N64',
      1417: 'NPB520',
      1418: 'NPB560',
    },
    attributes: {
      1403: {
        instrument: 'Violão acústico',
        materials: 'Nylon cristal e bordões de aço revestido com cobre prateado',
        tension: 'Média',
      },
      1404: {
        instrument: 'Violão acústico',
        materials: 'Aço com bronze 85/15',
        gauges: '.010 - .050',
      },
      1405: {
        instrument: 'Violão acústico',
        materials: 'Aço com bronze 85/15',
        gauges: '.011 - .050',
        tension: 'Média',
      },
      1406: {
        instrument: 'Guitarra elétrica',
        materials: 'Aço niquelado',
        gauges: '.009 - .042',
        tension: 'Leve',
      },
      1407: {
        instrument: 'Guitarra elétrica',
        materials: 'Aço niquelado',
        gauges: '.010 - .046',
        tension: 'Média',
      },
      1417: {
        instrument: 'Violão acústico',
        materials: 'Aço com fósforo bronze',
        gauges: '.011 - .050',
        tension: 'Média',
      },
      1418: {
        instrument: 'Violão acústico',
        materials: 'Aço com fósforo bronze',
        gauges: '.010 - .047',
      },
    },
  },
};
const SHEET_SLUG = path
  .basename(SOURCE_FILE, path.extname(SOURCE_FILE))
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const SHEET_CONFIG = SHEET_CONFIGS[SHEET_SLUG];

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function text(value) {
  return String(value ?? '').trim();
}

function digits(value) {
  return text(value).replace(/\D/g, '');
}

function unique(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sourceId(sourceSku) {
  return Number(text(sourceSku).match(/^(\d+)/)?.[1] || 0);
}

function sourceQuantity(sourceSku) {
  return Number(text(sourceSku).match(/K(\d+)$/i)?.[1] || 0);
}

function instrument(name) {
  return /guitarra/i.test(text(name)) ? 'Guitarra elétrica' : 'Violão acústico';
}

function tension(name) {
  const value = text(name);
  if (/custom light/i.test(value)) return 'Custom Light';
  if (/super light/i.test(value)) return 'Super Light';
  if (/extra light/i.test(value)) return 'Extra Light';
  if (/medium/i.test(value)) return 'Medium';
  if (/\blight\b/i.test(value)) return 'Light';
  return '';
}

function gauges(description) {
  const match = text(description).match(
    /calibre\s*:\s*(?:[^(\n]{0,50}\()?(\.?\d{2,3})\s*[-–]\s*(\.?\d{2,3})/i,
  );
  if (!match) return '';
  const normalize = (value) => `.${value.replace(/\D/g, '').padStart(3, '0')}`;
  return `${normalize(match[1])} - ${normalize(match[2])}`;
}

function imageList(value) {
  return Array.isArray(value) ? unique(value).slice(0, 12) : [];
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function pricePreview(product) {
  const cost = Number(product.custo || 0);
  const shipping = Number(product.ml_shipping || 0);
  const fee = Number(product.ml_fee || 0.15);
  const strategy =
    cost <= 400
      ? { margin: 0.15, minProfit: 20 }
      : cost <= 1000
        ? { margin: 0.2, minProfit: 60 }
        : { margin: 0.25, minProfit: 150 };
  const denominator = 1 - 0.04 - fee;
  if (!(cost > 0) || denominator <= 0) return null;
  return round2(
    Math.max(
      (cost + shipping + cost * strategy.margin) / denominator,
      (cost + shipping + strategy.minProfit) / denominator,
    ),
  );
}

async function mlAccount() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) {
    throw new Error(`Token ML indisponível: ${error?.message || 'sem token'}`);
  }
  const account = await assertAllowedMercadoLivreToken(
    data.access_token,
    'prepare-bkr1-kit-sheet-listings',
  );
  return {
    token: data.access_token,
    userId: String(account.userId),
    nickname: String(account.nickname || ''),
  };
}

async function fetchMl(account, apiPath) {
  const response = await fetch(`https://api.mercadolibre.com${apiPath}`, {
    headers: { Authorization: `Bearer ${account.token}` },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${apiPath} HTTP ${response.status}: ${payload?.message || 'erro'}`,
    );
  }
  return payload;
}

async function searchLiveSku(account, sku) {
  for (const field of ['sku', 'seller_sku']) {
    const result = await fetchMl(
      account,
      `/users/${account.userId}/items/search?${field}=${encodeURIComponent(sku)}&limit=100`,
    );
    const ids = Array.isArray(result?.results) ? result.results.map(String) : [];
    if (ids.length) return ids;
  }
  return [];
}

async function normalizeImage(sourceUrl) {
  const response = await fetch(sourceUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Vortek/1.0 BKR1-kit-image-audit' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = text(response.headers.get('content-type')).split(';')[0];
  if (!contentType.startsWith('image/')) {
    throw new Error(`content-type ${contentType || 'ausente'}`);
  }
  const source = Buffer.from(await response.arrayBuffer());
  if (!source.length || source.length > 10 * 1024 * 1024) {
    throw new Error(`tamanho inválido ${source.length}`);
  }
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new Error('dimensões ausentes');
  if (metadata.width < 250 || metadata.height < 250) {
    throw new Error(`dimensões insuficientes ${metadata.width}x${metadata.height}`);
  }
  let pipeline = sharp(source).rotate().flatten({ background: '#ffffff' });
  if (Math.max(metadata.width, metadata.height) <= 500) {
    pipeline = pipeline.resize({
      width: 800,
      height: 800,
      fit: 'inside',
      withoutEnlargement: false,
    });
  }
  return pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function mirrorImage(product, sourceUrl, position) {
  if (sourceUrl.startsWith(STORAGE_PREFIX)) {
    const response = await fetch(sourceUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (
      response.status !== 200 ||
      !text(response.headers.get('content-type')).startsWith('image/')
    ) {
      throw new Error(`imagem Vortek indisponível HTTP ${response.status}`);
    }
    return sourceUrl;
  }
  if (!MIRROR_IMAGES) throw new Error('image_mirror_required');
  const normalized = await normalizeImage(sourceUrl);
  const hash = crypto
    .createHash('sha256')
    .update(sourceUrl)
    .update(normalized)
    .digest('hex')
    .slice(0, 20);
  const objectPath =
    `catalog/bkr1-kits/${SHEET_SLUG}/${product.sku}/` +
    `${String(position + 1).padStart(2, '0')}-${hash}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, normalized, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
  if (error && !/already exists/i.test(error.message || '')) {
    throw new Error(`upload: ${error.message}`);
  }
  const publicUrl = `${STORAGE_PREFIX}${objectPath}`;
  const validation = await fetch(publicUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  if (
    validation.status !== 200 ||
    !text(validation.headers.get('content-type')).startsWith('image/')
  ) {
    throw new Error(`URL pública inválida HTTP ${validation.status}`);
  }
  return publicUrl;
}

async function prepareImages(product) {
  const sources = imageList(product.imagens);
  const prepared = [];
  const failures = [];
  for (let index = 0; index < sources.length; index += 1) {
    try {
      prepared.push(await mirrorImage(product, sources[index], index));
    } catch (error) {
      failures.push({ url: sources[index], error: error.message });
    }
  }
  if (!prepared.length) {
    return { ok: false, reason: failures[0]?.error || 'sem imagem válida', failures };
  }
  if (MIRROR_IMAGES && JSON.stringify(prepared) !== JSON.stringify(sources)) {
    const { error } = await supabase
      .from('produtos')
      .update({ imagens: prepared })
      .eq('id', product.id);
    if (error) {
      return { ok: false, reason: `falha ao atualizar imagens: ${error.message}`, failures };
    }
  }
  return { ok: true, images: prepared, failures };
}

function attributesFor(row, product, quantity) {
  const source = sourceId(row.sku_origem);
  const verified = SHEET_CONFIG.attributes[source] || {};
  const verifiedInstrument = verified.instrument || instrument(product.nome);
  const verifiedGauges = verified.gauges || gauges(product.descricao);
  const verifiedTension = verified.tension || tension(product.nome);
  return [
    { id: 'BRAND', value_name: SHEET_CONFIG.brand },
    { id: 'MODEL', value_name: SHEET_CONFIG.models[source] },
    { id: 'RECOMMENDED_INSTRUMENT', value_name: verifiedInstrument },
    { id: 'SALE_FORMAT', value_id: '1359392', value_name: 'Kit' },
    { id: 'UNITS_PER_PACK', value_name: String(quantity) },
    { id: 'STRINGS_NUMBER', value_name: '6' },
    ...(verifiedGauges
      ? [{ id: 'GAUGES', value_name: verifiedGauges }]
      : []),
    ...(verified.materials
      ? [{ id: 'MATERIALS', value_name: verified.materials }]
      : []),
    ...(verifiedTension
      ? [{ id: 'TENSION', value_name: verifiedTension }]
      : []),
  ];
}

async function main() {
  if (!SOURCE_FILE || !fs.existsSync(SOURCE_FILE)) {
    throw new Error('Informe uma planilha válida com --file.');
  }
  if (!SHEET_CONFIG) {
    throw new Error(
      `Planilha sem configuração segura: ${path.basename(SOURCE_FILE)}.`,
    );
  }
  const workbook = XLSX.readFile(SOURCE_FILE);
  const sheet = workbook.Sheets.Produtos || workbook.Sheets[workbook.SheetNames[0]];
  const sheetRows = XLSX.utils
    .sheet_to_json(sheet, { defval: '', raw: false })
    .filter((row) => text(row['Código (SKU)']));
  const sourceSkus = unique(sheetRows.map((row) => row['Código (SKU)']));
  const account = await mlAccount();

  const { data: kits, error } = await supabase
    .from('produto_kits')
    .select(
      'produto_id,sku_origem,ativo,produto:produtos!produto_kits_produto_id_fkey(*),componentes:produto_kit_componentes(componente_produto_id,quantidade,componente:produtos!produto_kit_componentes_componente_produto_id_fkey(id,sku,nome,gtin,ativo,estoque,ml_item_id))',
    )
    .eq('fornecedor_dslite_id', SUPPLIER_ID)
    .in('sku_origem', sourceSkus);
  if (error) throw error;
  if ((kits || []).length !== sourceSkus.length) {
    const found = new Set((kits || []).map((row) => text(row.sku_origem)));
    throw new Error(
      `Kits não cadastrados: ${sourceSkus.filter((sku) => !found.has(sku)).join(', ')}`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_ROOT, `bkr1-${SHEET_SLUG}-kits-${stamp}`);
  fs.mkdirSync(reportDir, { recursive: true });
  const ready = [];
  const blocked = [];
  const imageReport = [];

  for (const row of kits || []) {
    const product = row.produto;
    const componentRow = Array.isArray(row.componentes) ? row.componentes[0] : null;
    const quantity = Number(componentRow?.quantidade || 0);
    const block = (reason, details = null) => {
      blocked.push({
        produtoId: text(product?.id),
        sku: text(product?.sku),
        sourceSku: text(row.sku_origem),
        reason,
        details,
      });
    };
    if (!row.ativo || !product?.ativo) {
      block('inactive_kit');
      continue;
    }
    if (!product?.sku || !product?.nome || !(Number(product?.custo) > 0)) {
      block('invalid_product_core_data');
      continue;
    }
    if (!(Number(product.estoque) > 0)) {
      block('out_of_stock');
      continue;
    }
    if (!componentRow || row.componentes.length !== 1 || quantity !== sourceQuantity(row.sku_origem)) {
      block('invalid_simple_kit_link');
      continue;
    }
    if (
      !componentRow.componente?.ativo ||
      !componentRow.componente?.ml_item_id ||
      !(Number(componentRow.componente?.estoque) >= quantity)
    ) {
      block('component_unavailable_or_unlisted');
      continue;
    }
    if (text(product.ml_item_id) || text(product.ml_status) !== 'sem_anuncio') {
      block('already_has_listing');
      continue;
    }
    const { data: localListings, error: localError } = await supabase
      .from('anuncios_ml')
      .select('ml_item_id,sku,status')
      .or(`produto_id.eq.${product.id},sku.eq.${product.sku}`);
    if (localError) throw localError;
    if ((localListings || []).length) {
      block('local_listing_link_exists', localListings);
      continue;
    }
    const liveItems = await searchLiveSku(account, product.sku);
    if (liveItems.length) {
      block('live_ml_sku_exists', liveItems);
      continue;
    }
    const componentItem = await fetchMl(
      account,
      `/items/${encodeURIComponent(componentRow.componente.ml_item_id)}?attributes=category_id,status`,
    );
    if (text(componentItem.category_id) !== CATEGORY_ID) {
      block('component_category_mismatch', {
        expected: CATEGORY_ID,
        actual: componentItem.category_id,
      });
      continue;
    }
    if (!SHEET_CONFIG.models[sourceId(row.sku_origem)]) {
      block('missing_verified_model');
      continue;
    }
    const imageResult = await prepareImages(product);
    imageReport.push({
      produtoId: product.id,
      sku: product.sku,
      oldImages: imageList(product.imagens),
      ...imageResult,
    });
    if (!imageResult.ok) {
      block('image_preparation_failed', imageResult);
      continue;
    }
    ready.push({
      produtoId: text(product.id),
      sku: text(product.sku),
      nome: text(product.nome),
      fornecedor: 'BKR1',
      dsliteFornecedorId: SUPPLIER_ID,
      categoryId: CATEGORY_ID,
      custo: round2(product.custo),
      estoque: Number(product.estoque),
      suggestedPricePreview: pricePreview(product),
      description: text(product.descricao),
      attributeOverrides: attributesFor(row, product, quantity),
      preflight: {
        strictEvidence: true,
        sourceSheet: path.basename(SOURCE_FILE),
        sourceSku: text(row.sku_origem),
        componentSku: text(componentRow.componente.sku),
        componentGtin: digits(componentRow.componente.gtin),
        componentQuantity: quantity,
        trustedOptionalAttributeOverrides: true,
        imagesOnVortekStorage: imageResult.images.every((url) =>
          url.startsWith(STORAGE_PREFIX),
        ),
        categoryEvidence: `Componente ${componentRow.componente.ml_item_id} em ${CATEGORY_ID}`,
        descriptionFormat: 'paragraphs_and_bullet_points',
      },
    });
  }

  ready.sort((left, right) => left.sku.localeCompare(right.sku, 'pt-BR'));
  const batches = chunks(ready, BATCH_SIZE);
  batches.forEach((items, index) => {
    const number = String(index + 1).padStart(3, '0');
    fs.writeFileSync(
      path.join(reportDir, `${number}-bkr1-kit-${SHEET_SLUG}-${number}.json`),
      JSON.stringify(
        {
          batchNumber: index + 1,
          batchId: `bkr1-kit-${SHEET_SLUG}-${number}`,
          strategy: 'one_item_then_verify',
          items,
        },
        null,
        2,
      ),
    );
  });
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceFile: SOURCE_FILE,
    account: { userId: account.userId, nickname: account.nickname },
    mode: MIRROR_IMAGES ? 'mirror_images_and_prepare' : 'audit_only',
    sheetCount: sourceSkus.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    batchCount: batches.length,
    reportDir,
  };
  fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportDir, 'ready-items.json'), JSON.stringify(ready, null, 2));
  fs.writeFileSync(path.join(reportDir, 'blocked-items.json'), JSON.stringify(blocked, null, 2));
  fs.writeFileSync(path.join(reportDir, 'image-report.json'), JSON.stringify(imageReport, null, 2));
  fs.writeFileSync(
    path.join(REPORT_ROOT, `bkr1-${SHEET_SLUG}-kits-latest-path.txt`),
    `${reportDir}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
  if (blocked.some((row) => row.reason !== 'out_of_stock')) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
