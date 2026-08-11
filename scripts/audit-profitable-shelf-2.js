const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-profitable-shelf-2-2026-08-10');
const OUTPUT_PATH = path.join(REPORT_DIR, 'final-log.json');
const SUCCESS_PATH = path.join(REPORT_DIR, 'success-log.json');
const REVIEW_PATH = path.join(REPORT_DIR, 'review-log.json');
const OPERATION_SUMMARY_PATH = path.join(REPORT_DIR, 'operation-summary.json');
const WAIT = process.argv.includes('--wait');
const WAIT_MS = Number(process.env.AUDIT_WAIT_MS || 20000);
const MAX_ATTEMPTS = Number(process.env.AUDIT_MAX_ATTEMPTS || 12);

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function manifestItems() {
  return fs.readdirSync(REPORT_DIR)
    .filter((name) => /^\d{3}-profitable-shelf-2-create-\d{3}\.json$/.test(name))
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(REPORT_DIR, name), 'utf8')).items || []);
}

async function linkedProducts(items) {
  const rows = [];
  for (let index = 0; index < items.length; index += 200) {
    const ids = items.slice(index, index + 200).map((item) => String(item.produtoId));
    const { data, error } = await supabase
      .from('produtos')
      .select('id,sku,ml_item_id,ml_status')
      .in('id', ids);
    if (error) throw new Error(error.message);
    rows.push(...(data || []).filter((product) => String(product.ml_item_id || '').trim()));
  }
  return rows;
}

async function accessToken() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) throw new Error(error?.message || 'Token ML ausente');
  return data.access_token;
}

async function fetchItems(products, token) {
  const observed = [];
  for (let index = 0; index < products.length; index += 20) {
    const batch = products.slice(index, index + 20);
    const ids = batch.map((product) => product.ml_item_id).join(',');
    const response = await fetch(
      `https://api.mercadolibre.com/items?ids=${encodeURIComponent(ids)}&include_attributes=all`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`Consulta ML falhou: HTTP ${response.status}`);
    const data = await response.json();
    const byId = new Map(batch.map((product) => [String(product.ml_item_id), product]));
    for (const entry of Array.isArray(data) ? data : []) {
      const item = entry?.body || {};
      const product = byId.get(String(item.id));
      observed.push({
        sku: product?.sku || null,
        produto_id: product?.id || null,
        mlb: item.id || null,
        title: item.title || null,
        price: item.price ?? null,
        status: item.status || null,
        sub_status: Array.isArray(item.sub_status) ? item.sub_status : [],
        category_id: item.category_id || null,
        listing_type_id: item.listing_type_id || null,
        pictures: Array.isArray(item.pictures) ? item.pictures.length : 0,
        permalink: item.permalink || null,
        http: entry?.code || null,
      });
    }
  }
  return observed;
}

async function persistStatuses(rows) {
  const activeProductIds = rows.filter((row) => row.status === 'active').map((row) => row.produto_id);
  const pausedProductIds = rows.filter((row) => row.status !== 'active').map((row) => row.produto_id);
  const activeItemIds = rows.filter((row) => row.status === 'active').map((row) => row.mlb);
  const pausedItemIds = rows.filter((row) => row.status !== 'active').map((row) => row.mlb);

  for (const [table, column, ids, statusColumn, status] of [
    ['produtos', 'id', activeProductIds, 'ml_status', 'ativo'],
    ['produtos', 'id', pausedProductIds, 'ml_status', 'pausado'],
    ['anuncios_ml', 'ml_item_id', activeItemIds, 'status', 'ativo'],
    ['anuncios_ml', 'ml_item_id', pausedItemIds, 'status', 'pausado'],
  ]) {
    if (ids.length === 0) continue;
    const { error } = await supabase.from(table).update({ [statusColumn]: status }).in(column, ids);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function attachModerations(rows, token) {
  const moderated = rows.filter((row) => row.status === 'under_review');
  if (moderated.length === 0) return;
  const meResponse = await fetch('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meResponse.ok) return;
  const me = await meResponse.json();
  for (const row of moderated) {
    const url = new URL(`https://api.mercadolibre.com/moderations/infractions/${me.id}`);
    url.searchParams.set('related_item_id', row.mlb);
    url.searchParams.set('language', 'PT');
    url.searchParams.set('limit', '20');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => null);
    row.moderations = response.ok ? (data?.infractions || []) : [];
  }
}

async function main() {
  const products = await linkedProducts(manifestItems());
  const token = await accessToken();
  let rows = [];

  for (let attempt = 1; attempt <= (WAIT ? MAX_ATTEMPTS : 1); attempt += 1) {
    rows = await fetchItems(products, token);
    const pending = rows.filter(
      (row) => row.status === 'paused' && row.sub_status.includes('picture_download_pending'),
    ).length;
    const active = rows.filter((row) => row.status === 'active').length;
    console.log(`[audit] attempt=${attempt} total=${rows.length} active=${active} pending=${pending}`);
    if (!WAIT || pending === 0 || attempt === MAX_ATTEMPTS) break;
    await sleep(WAIT_MS);
  }

  await attachModerations(rows, token);
  await persistStatuses(rows);
  const report = {
    generated_at: new Date().toISOString(),
    total: rows.length,
    active: rows.filter((row) => row.status === 'active').length,
    picture_download_pending: rows.filter(
      (row) => row.status === 'paused' && row.sub_status.includes('picture_download_pending'),
    ).length,
    other_status: rows.filter(
      (row) => !(row.status === 'active') && !row.sub_status.includes('picture_download_pending'),
    ).length,
    listings: rows.sort((a, b) => String(a.sku).localeCompare(String(b.sku))),
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  const activeListings = report.listings.filter((row) => row.status === 'active');
  const reviewListings = report.listings.filter((row) => row.status !== 'active');
  fs.writeFileSync(
    SUCCESS_PATH,
    JSON.stringify({
      generated_at: report.generated_at,
      total: activeListings.length,
      listings: activeListings.map((row) => ({
        sku: row.sku,
        mlb: row.mlb,
        title: row.title,
        price: row.price,
        permalink: row.permalink,
      })),
    }, null, 2),
  );
  fs.writeFileSync(
    REVIEW_PATH,
    JSON.stringify({ generated_at: report.generated_at, total: reviewListings.length, listings: reviewListings }, null, 2),
  );

  const base = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, 'summary.json'), 'utf8'));
  const preflightFiles = fs.readdirSync(path.join(REPORT_DIR, 'preflight-results'))
    .filter((name) => /^\d{3}-.+-result\.json$/.test(name));
  const preflight = preflightFiles.map((name) =>
    JSON.parse(fs.readFileSync(path.join(REPORT_DIR, 'preflight-results', name), 'utf8'))
  );
  const approved = preflight.reduce((total, batch) => total + (batch.created || []).length, 0);
  const rejected = preflight.reduce((total, batch) => total + (batch.failed || []).length, 0);
  fs.writeFileSync(
    OPERATION_SUMMARY_PATH,
    JSON.stringify({
      generated_at: report.generated_at,
      pdf_skus: base.pdfSkus,
      erp_candidates: base.erpCandidates,
      ml_preflight: {
        checked: approved + rejected,
        approved,
        rejected,
      },
      publication: {
        created: report.total,
        active: activeListings.length,
        under_review_or_blocked: reviewListings.length,
        not_created: base.pdfSkus - report.total,
      },
      blocked_breakdown: {
        before_ml_preflight: base.blockedBeforeMlPreflight,
        missing_image: base.blockedReasonCounts?.missing_image || 0,
        invalid_package: base.blockedReasonCounts?.invalid_package || 0,
        missing_description: base.blockedReasonCounts?.missing_description || 0,
        rejected_by_ml_preflight: rejected,
        approved_but_not_created_due_to_gtin_or_category: approved - report.total,
      },
    }, null, 2),
  );
  console.log(JSON.stringify({ output: OUTPUT_PATH, ...report, listings: undefined }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
