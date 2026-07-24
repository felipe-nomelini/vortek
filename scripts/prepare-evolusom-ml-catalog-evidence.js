const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const SOURCE_DIR = process.env.ML_BATCH_SOURCE_DIR;
const CONCURRENCY = Math.max(1, Number(process.env.ML_CATALOG_CONCURRENCY || '4'));
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '10'));

if (!SOURCE_DIR) {
  throw new Error('Defina ML_BATCH_SOURCE_DIR com o diretório dos lotes Evolusom.');
}

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function comparableGtin(value) {
  return digits(value).replace(/^0+/, '');
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

async function getAccessToken() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) {
    throw new Error(`Token Mercado Livre indisponível: ${error?.message || 'sem token'}`);
  }
  return data.access_token;
}

async function fetchMl(token, apiPath) {
  const response = await fetch(`https://api.mercadolibre.com${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(
      `${apiPath} retornou HTTP ${response.status}: ${data?.message || text.slice(0, 200)}`,
    );
  }
  return data;
}

async function mapLimit(rows, limit, mapper) {
  const output = new Array(rows.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < rows.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(rows[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, rows.length) }, () => worker()),
  );
  return output;
}

function catalogGtins(product) {
  return (product?.attributes || [])
    .filter((attribute) => String(attribute?.id).toUpperCase() === 'GTIN')
    .flatMap((attribute) => attribute?.values || [])
    .map((value) => comparableGtin(value?.name || value?.id))
    .filter(Boolean);
}

function catalogAttributeOverrides(product) {
  return (product?.attributes || [])
    .filter((attribute) => hasText(attribute?.id))
    .map((attribute) => ({
      id: String(attribute.id),
      value_id: hasText(attribute.value_id)
        ? String(attribute.value_id)
        : hasText(attribute?.values?.[0]?.id)
          ? String(attribute.values[0].id)
          : '',
      value_name: hasText(attribute.value_name)
        ? String(attribute.value_name)
        : hasText(attribute?.values?.[0]?.name)
          ? String(attribute.values[0].name)
          : '',
    }))
    .filter((attribute) => hasText(attribute.value_id) || hasText(attribute.value_name));
}

async function loadProducts(ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase
      .from('produtos')
      .select('id,sku,nome,gtin,ml_item_id,ml_status')
      .in('id', ids.slice(index, index + 100));
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return new Map(rows.map((row) => [String(row.id), row]));
}

async function main() {
  const sourcePath = path.resolve(SOURCE_DIR);
  const readyItems = JSON.parse(
    fs.readFileSync(path.join(sourcePath, 'ready-items.json'), 'utf8'),
  );
  const productById = await loadProducts(
    readyItems.map((item) => String(item.produtoId)),
  );
  const token = await getAccessToken();
  const categoryCache = new Map();

  async function getCategory(categoryId) {
    if (!categoryCache.has(categoryId)) {
      categoryCache.set(
        categoryId,
        fetchMl(token, `/categories/${encodeURIComponent(categoryId)}`),
      );
    }
    return categoryCache.get(categoryId);
  }

  const audited = await mapLimit(readyItems, CONCURRENCY, async (item, index) => {
    const local = productById.get(String(item.produtoId));
    const gtin = comparableGtin(local?.gtin);
    const prefix = `[${index + 1}/${readyItems.length}] ${item.sku}`;

    if (!local || !gtin) {
      console.log(`${prefix} blocked missing_local_gtin`);
      return { ok: false, item, reason: 'missing_local_gtin' };
    }
    if (hasText(local.ml_item_id) || String(local.ml_status) !== 'sem_anuncio') {
      console.log(`${prefix} blocked already_listed`);
      return { ok: false, item, reason: 'already_listed' };
    }

    try {
      const search = await fetchMl(
        token,
        `/products/search?status=active&site_id=MLB&q=${encodeURIComponent(
          digits(local.gtin),
        )}`,
      );
      const exactProducts = (search?.results || []).filter((product) =>
        catalogGtins(product).includes(gtin),
      );
      if (exactProducts.length !== 1) {
        console.log(`${prefix} blocked catalog_exact_count=${exactProducts.length}`);
        return {
          ok: false,
          item,
          reason:
            exactProducts.length === 0
              ? 'catalog_exact_gtin_not_found'
              : 'catalog_exact_gtin_ambiguous',
          details: { found: exactProducts.length },
        };
      }

      const catalog = exactProducts[0];
      if ((catalog.children_ids || []).length > 0) {
        console.log(`${prefix} blocked catalog_parent_product`);
        return { ok: false, item, reason: 'catalog_parent_product' };
      }

      const normalizedName = String(local.nome || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (
        /resistenc/.test(normalizedName) &&
        /(ducha|chuveiro)/.test(normalizedName) &&
        String(catalog.domain_id) === 'MLB-SHOWER_HEADS'
      ) {
        console.log(`${prefix} blocked catalog_product_type_mismatch`);
        return {
          ok: false,
          item,
          reason: 'catalog_product_type_mismatch',
          details: {
            catalogProductId: catalog.id,
            catalogDomainId: catalog.domain_id,
          },
        };
      }

      const discoveredDomains = await fetchMl(
        token,
        `/sites/MLB/domain_discovery/search?q=${encodeURIComponent(local.nome)}`,
      );
      const predictedDomain = String(discoveredDomains?.[0]?.domain_id || '');
      if (!predictedDomain || predictedDomain !== String(catalog.domain_id || '')) {
        console.log(
          `${prefix} blocked catalog_domain_mismatch catalog=${catalog.domain_id || ''} predicted=${predictedDomain}`,
        );
        return {
          ok: false,
          item,
          reason: 'catalog_domain_mismatch',
          details: {
            catalogProductId: catalog.id,
            catalogDomainId: catalog.domain_id,
            predictedDomainId: predictedDomain,
            predictedCategoryId: String(discoveredDomains?.[0]?.category_id || ''),
          },
        };
      }

      const catalogItems = await fetchMl(
        token,
        `/products/${encodeURIComponent(catalog.id)}/items?limit=100`,
      );
      const categoryCounts = new Map();
      for (const listing of catalogItems?.results || []) {
        const categoryId = String(listing?.category_id || '');
        if (!categoryId) continue;
        categoryCounts.set(categoryId, (categoryCounts.get(categoryId) || 0) + 1);
      }

      const candidates = [];
      for (const [categoryId, count] of categoryCounts.entries()) {
        const category = await getCategory(categoryId);
        const domainId = String(category?.settings?.catalog_domain || '');
        if (
          domainId === String(catalog.domain_id) &&
          category?.settings?.listing_allowed !== false
        ) {
          candidates.push({
            id: categoryId,
            name: String(category.name || categoryId),
            domainId,
            count,
          });
        }
      }
      candidates.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
      const category = candidates[0];
      if (!category) {
        console.log(`${prefix} blocked catalog_category_not_found`);
        return {
          ok: false,
          item,
          reason: 'catalog_category_not_found',
          details: {
            catalogProductId: catalog.id,
            catalogDomainId: catalog.domain_id,
          },
        };
      }

      console.log(
        `${prefix} ok ${catalog.id} ${category.id} ${category.domainId}`,
      );
      return {
        ok: true,
        item: {
          ...item,
          categoryId: category.id,
          attributeOverrides: catalogAttributeOverrides(catalog),
          catalogEvidence: {
            source: 'mercado_livre_products_search_exact_gtin',
            catalogProductId: String(catalog.id),
            catalogProductName: String(catalog.name || ''),
            catalogDomainId: String(catalog.domain_id || ''),
            predictedDomainId: predictedDomain,
            categoryId: category.id,
            categoryName: category.name,
            linkedListingsInCategory: category.count,
            validatedGtin: digits(local.gtin),
          },
        },
      };
    } catch (error) {
      console.log(`${prefix} blocked catalog_api_error ${error.message}`);
      return {
        ok: false,
        item,
        reason: 'catalog_api_error',
        details: { error: error.message },
      };
    }
  });

  const approved = audited.filter((row) => row.ok).map((row) => row.item);
  const blocked = audited
    .filter((row) => !row.ok)
    .map(({ item, reason, details }) => ({
      produtoId: item.produtoId,
      sku: item.sku,
      nome: item.nome,
      reason,
      details: details || null,
    }));
  const reasonCounts = blocked.reduce((counts, row) => {
    counts[row.reason] = (counts[row.reason] || 0) + 1;
    return counts;
  }, {});

  const outputDir = path.join(sourcePath, 'catalog-evidence');
  fs.mkdirSync(outputDir, { recursive: true });
  for (const fileName of fs.readdirSync(outputDir)) {
    if (/^\d{3}-evolusom-catalog-create-\d{3}\.json$/.test(fileName)) {
      fs.unlinkSync(path.join(outputDir, fileName));
    }
  }

  const batches = [];
  for (let index = 0; index < approved.length; index += BATCH_SIZE) {
    const number = batches.length + 1;
    const fileName = `${String(number).padStart(3, '0')}-evolusom-catalog-create-${String(number).padStart(3, '0')}.json`;
    const manifest = {
      batchNumber: number,
      batchId: `evolusom-catalog-create-${String(number).padStart(3, '0')}`,
      strategy: 'exact_gtin_catalog_evidence',
      executionHints: {
        dryRunFirst: true,
        createSequentially: true,
        strictEvidence: true,
        stopAfterConsecutiveFailures: 3,
      },
      items: approved.slice(index, index + BATCH_SIZE),
    };
    fs.writeFileSync(
      path.join(outputDir, fileName),
      JSON.stringify(manifest, null, 2),
    );
    batches.push(fileName);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceDir: sourcePath,
    selected: readyItems.length,
    approved: approved.length,
    blocked: blocked.length,
    batchSize: BATCH_SIZE,
    batchCount: batches.length,
    blockedReasonCounts: reasonCounts,
    safetyRule:
      'GTIN local exato em produto ativo do catálogo ML, produto filho específico, domínio confirmado também pelo preditor oficial e categoria já usada no mesmo domínio.',
  };
  fs.writeFileSync(
    path.join(outputDir, 'approved-items.json'),
    JSON.stringify(approved, null, 2),
  );
  fs.writeFileSync(
    path.join(outputDir, 'blocked-items.json'),
    JSON.stringify(blocked, null, 2),
  );
  fs.writeFileSync(
    path.join(outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
