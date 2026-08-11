const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-profitable-shelf-2-2026-08-10');
const PREFLIGHT_DIR = path.join(REPORT_DIR, 'preflight-results');
const OUTPUT_PATH = path.join(REPORT_DIR, 'no-gtin-pilots.json');
const EXCLUDED_CATEGORIES = new Set([
  'MLB431681',
  'MLB436012',
  'MLB445725',
  'MLB7060',
  'MLB3561',
  'MLB5914',
]);

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function sourceItems() {
  return fs.readdirSync(REPORT_DIR)
    .filter((name) => /^\d{3}-profitable-shelf-2-create-\d{3}\.json$/.test(name))
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(REPORT_DIR, name), 'utf8')).items || []);
}

function approvedRows() {
  return fs.readdirSync(PREFLIGHT_DIR)
    .filter((name) => /^\d{3}-.+-result\.json$/.test(name))
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(PREFLIGHT_DIR, name), 'utf8')).created || []);
}

async function main() {
  const sourceBySku = new Map(sourceItems().map((item) => [String(item.sku), item]));
  const approved = approvedRows();
  const skus = approved.map((row) => String(row.sku));
  const products = [];
  for (let index = 0; index < skus.length; index += 200) {
    const { data, error } = await supabase
      .from('produtos')
      .select('id,sku,gtin,ml_item_id,ml_status,ativo,estoque')
      .in('sku', skus.slice(index, index + 200));
    if (error) throw new Error(error.message);
    products.push(...(data || []));
  }
  const productBySku = new Map(products.map((product) => [String(product.sku), product]));
  const selectedByCategory = new Map();

  for (const row of approved) {
    const sku = String(row.sku);
    const categoryId = String(row.category?.id || '');
    const product = productBySku.get(sku);
    if (
      !categoryId || EXCLUDED_CATEGORIES.has(categoryId) || selectedByCategory.has(categoryId) ||
      !product || String(product.gtin || '').trim() || String(product.ml_item_id || '').trim() ||
      product.ml_status !== 'sem_anuncio' || product.ativo !== true || Number(product.estoque) <= 0
    ) continue;
    const source = sourceBySku.get(sku);
    if (!source) continue;
    selectedByCategory.set(categoryId, {
      ...source,
      categoryId,
      listingType: row.listingType,
      familyName: row.familyName,
      strictFirstCategory: true,
    });
  }

  const items = Array.from(selectedByCategory.values());
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({
      batchId: 'profitable-shelf-2-no-gtin-pilots',
      generatedAt: new Date().toISOString(),
      items,
    }, null, 2),
  );
  console.log(JSON.stringify({ output: OUTPUT_PATH, selected: items.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
