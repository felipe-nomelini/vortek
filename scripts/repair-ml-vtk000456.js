#!/usr/bin/env node
/* Corrige o vínculo 50 cm do VTK000456 criando uma única oferta de 30 cm. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { extractShippingCost } = require('./lib/ml-p0-phase5c');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const SKU = 'VTK000456';
const PRODUCT_ID = '8e3ae3fe-a402-481f-983f-9493bf7085bc';
const SELLER_ID = 3294514937;
const GTIN = '7898461967658';
const CATEGORY_ID = 'MLB1645';
const CATALOG_PRODUCT_ID = 'MLB18971070';
const WRONG_ITEMS = ['MLB4841991561', 'MLB7149272254'];
const WRONG_CATALOG = 'MLB21605404';
const FAMILY_NAME = 'Ventilador de Coluna Ventisol Turbo 6 30 cm';
const INITIAL_PRICE = 599.90;
const LISTING_TYPE = 'gold_special';
const TAX_RATE = 0.04;
const FINAL_MARGIN = 0.50;
const PUT_TARGET_MARGIN = 0.5025;
const REPORT_DIR = path.resolve('reports/ml-vtk000456-identity-repair');
const SOURCE = 'repair-ml-vtk000456-2026-08-19';

fs.mkdirSync(REPORT_DIR, { recursive: true });
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const writeJson = (name, value) => fs.writeFileSync(
  path.join(REPORT_DIR, name),
  `${JSON.stringify(value, null, 2)}\n`,
);
const normalize = (value) => String(value ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const attr = (item, id) => {
  const found = (item?.attributes || []).find((row) => String(row?.id).toUpperCase() === id);
  return found?.value_name ?? found?.value_id ?? null;
};
const sqlLiteral = (value) => value === null || value === undefined
  ? 'null'
  : `'${String(value).replaceAll("'", "''")}'`;

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let postCount = 0;
let pricePutCount = 0;
let safetyPauseCount = 0;

async function ml(token, resource, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'POST') {
    if (resource !== '/items' || postCount >= 1 || options.itemCreation !== true) {
      throw new Error(`forbidden_post:${resource}`);
    }
    postCount += 1;
  }
  if (method === 'PUT') {
    const isPrice = options.priceUpdate === true && pricePutCount < 1;
    const isPause = options.safetyPause === true && safetyPauseCount < 1;
    if (!isPrice && !isPause) throw new Error(`forbidden_put:${resource}`);
    if (isPrice) pricePutCount += 1;
    if (isPause) safetyPauseCount += 1;
  }
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    request_id: response.headers.get('x-request-id') || response.headers.get('x-correlation-id'),
    data,
  };
}

function financial({ price, fee, shipping, cost }) {
  const tax = Math.round(price * TAX_RATE * 100) / 100;
  const profit = Math.round((price - fee - shipping - cost - tax) * 100) / 100;
  return { price, fee, shipping, cost, tax, profit, margin: profit / price };
}

async function quote(token, price, cost, itemId = null) {
  const fees = await ml(
    token,
    `/sites/MLB/listing_prices?price=${price.toFixed(2)}&category_id=${CATEGORY_ID}&listing_type_id=${LISTING_TYPE}`,
  );
  if (!fees.ok) throw new Error(`fee_quote_http_${fees.status}`);
  const fee = Number(fees.data?.sale_fee_amount);
  const params = new URLSearchParams({
    ...(itemId ? { item_id: itemId } : { dimensions: '41x22x40,2860' }),
    verbose: 'true',
    item_price: price.toFixed(2),
    listing_type_id: LISTING_TYPE,
    mode: 'me2',
    condition: 'new',
    logistic_type: 'drop_off',
    free_shipping: 'true',
  });
  const shippingResult = await ml(token, `/users/${SELLER_ID}/shipping_options/free?${params}`);
  if (!shippingResult.ok) throw new Error(`shipping_quote_http_${shippingResult.status}`);
  const shipping = Number(extractShippingCost(shippingResult.data));
  if (!Number.isFinite(fee) || !Number.isFinite(shipping)) throw new Error('financial_quote_incomplete');
  return { values: financial({ price, fee, shipping, cost }), fee_raw: fees.data, shipping_raw: shippingResult.data };
}

async function ensureWrongItemBlocks() {
  for (const itemId of WRONG_ITEMS) {
    const { data, error } = await supabase.from('ml_manual_blocklist')
      .select('id').eq('ml_item_id', itemId).eq('ativo', true).limit(1).maybeSingle();
    if (error) throw new Error(`blocklist_read:${error.message}`);
    const reason = `${SKU}: produto local 30 cm; item/catálogo remoto 50 cm. Bloqueio por item.`;
    if (data?.id) {
      const update = await supabase.from('ml_manual_blocklist').update({
        sku: null, motivo: reason, created_by: SOURCE,
      }).eq('id', data.id);
      if (update.error) throw new Error(`blocklist_update:${update.error.message}`);
    } else {
      const insert = await supabase.from('ml_manual_blocklist').insert({
        sku: null, ml_item_id: itemId, ativo: true, motivo: reason, created_by: SOURCE,
      });
      if (insert.error) throw new Error(`blocklist_insert:${insert.error.message}`);
    }
  }
}

function identity(item) {
  const fields = {
    seller: Number(item?.seller_id) === SELLER_ID,
    sku: normalize(item?.seller_custom_field || attr(item, 'SELLER_SKU')) === normalize(SKU),
    gtin: normalize(attr(item, 'GTIN')) === normalize(GTIN),
    brand: normalize(attr(item, 'BRAND')) === 'ventisol',
    model: normalize(attr(item, 'MODEL')).includes('turbo 6'),
    diameter: normalize(attr(item, 'DIAMETER')) === '30 cm',
    voltage: normalize(attr(item, 'VOLTAGE')) === '127v',
    category: item?.category_id === CATEGORY_ID,
    catalog: item?.catalog_product_id === CATALOG_PRODUCT_ID,
    catalog_listing: item?.catalog_listing === true,
  };
  return { fields, passed: Object.values(fields).every(Boolean) };
}

async function scanRemoteInventory(token) {
  const ids = [];
  const seenScrollIds = new Set();
  let scrollId = '';
  let expectedTotal = null;
  for (let page = 0; page < 1000; page += 1) {
    const query = scrollId
      ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : 'search_type=scan&limit=100';
    const result = await ml(token, `/users/${SELLER_ID}/items/search?${query}`);
    if (!result.ok) throw new Error(`inventory_scan_http_${result.status}`);
    if (expectedTotal === null) expectedTotal = Number(result.data?.paging?.total || 0);
    const current = (result.data?.results || []).map(String);
    ids.push(...current);
    if (!current.length || new Set(ids).size >= expectedTotal) break;
    if (!result.data?.scroll_id || seenScrollIds.has(result.data.scroll_id)) break;
    seenScrollIds.add(result.data.scroll_id);
    scrollId = result.data.scroll_id;
  }
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== expectedTotal) {
    throw new Error(`remote_inventory_unreliable:${uniqueIds.length}/${expectedTotal}`);
  }
  const items = [];
  const fields = 'id,seller_id,seller_custom_field,status,catalog_product_id,catalog_listing,category_id,attributes';
  for (let index = 0; index < uniqueIds.length; index += 20) {
    const batch = uniqueIds.slice(index, index + 20);
    const result = await ml(token, `/items?ids=${batch.join(',')}&attributes=${fields}`);
    if (!result.ok) throw new Error(`inventory_items_http_${result.status}`);
    for (const row of result.data || []) {
      if (Number(row.code) === 200 && row.body?.id) items.push(row.body);
    }
  }
  if (items.length !== uniqueIds.length) {
    throw new Error(`remote_inventory_details_unreliable:${items.length}/${uniqueIds.length}`);
  }
  return { expected_total: expectedTotal, captured: uniqueIds.length, items };
}

function psql(sql) {
  const command = 'docker exec -i supabase-db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At';
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '192.168.1.160', command], {
    input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`psql_failed:${String(result.stderr || result.stdout).trim()}`);
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function persistSql(item, finance) {
  const wrongIds = WRONG_ITEMS.map(sqlLiteral).join(',');
  return `
\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('ml-repair:${SKU}', 0));
create temp table repair_result(result text, listing_id uuid, transaction_id bigint) on commit preserve rows;
do $repair$
declare v_product public.produtos%rowtype; v_listing uuid; v_count integer;
begin
  select * into v_product from public.produtos where id='${PRODUCT_ID}'::uuid for update;
  if not found or v_product.sku <> '${SKU}' or coalesce(v_product.gtin,'') <> '${GTIN}' then
    raise exception 'identity_drift_local_product';
  end if;
  if v_product.ml_item_id not in (${wrongIds}) and v_product.ml_item_id <> '${item.id}' then
    raise exception 'concurrent_product_link:%', v_product.ml_item_id;
  end if;
  select count(*) into v_count from public.produtos where id <> '${PRODUCT_ID}'::uuid and ml_item_id='${item.id}';
  if v_count > 0 then raise exception 'concurrent_item_link'; end if;
  perform 1 from public.anuncios_ml where produto_id='${PRODUCT_ID}'::uuid or sku='${SKU}' or ml_item_id='${item.id}' for update;
  delete from public.anuncios_ml where ml_item_id in (${wrongIds});
  insert into public.anuncios_ml(
    ml_item_id,produto_id,sku,titulo,tipo,preco_ml,vendidos,visitas,qualidade,status,catalogo,thumbnail,permalink
  ) values (
    '${item.id}','${PRODUCT_ID}'::uuid,'${SKU}',${sqlLiteral(item.title)},'gold_special',${Number(item.price).toFixed(2)},
    ${Number(item.sold_quantity || 0)},0,0,'ativo'::public.ml_status,true,
    ${sqlLiteral(item.pictures?.[0]?.secure_url || item.thumbnail || null)},${sqlLiteral(item.permalink || null)}
  ) on conflict(ml_item_id) do update set
    produto_id=excluded.produto_id,sku=excluded.sku,titulo=excluded.titulo,tipo=excluded.tipo,
    preco_ml=excluded.preco_ml,status=excluded.status,catalogo=excluded.catalogo,
    thumbnail=excluded.thumbnail,permalink=excluded.permalink,updated_at=now()
  returning id into v_listing;
  update public.produtos set
    ml_item_id='${item.id}',ml_status='ativo'::public.ml_status,custom_price=${Number(item.price).toFixed(2)},
    ml_fee=${(finance.fee / finance.price).toFixed(6)},ml_shipping=${finance.shipping.toFixed(2)},updated_at=now()
  where id='${PRODUCT_ID}'::uuid;
  insert into repair_result values('REPAIR_SUCCESS',v_listing,txid_current());
end $repair$;
commit;
select row_to_json(r) from repair_result r;`;
}

async function main() {
  const startedAt = now();
  const [{ data: product, error: productError }, { data: offers }, { data: integration }] = await Promise.all([
    supabase.from('produtos').select('*').eq('id', PRODUCT_ID).single(),
    supabase.from('produto_fornecedor_ofertas').select('*').eq('produto_id', PRODUCT_ID),
    supabase.from('integracoes').select('access_token,conectado').eq('tipo', 'mercadolivre').order('updated_at', { ascending: false }).limit(1).single(),
  ]);
  if (productError || !product) throw new Error(`product_unavailable:${productError?.message || ''}`);
  const account = await assertAllowedMercadoLivreToken(integration.access_token, SOURCE);
  if (Number(account.userId) !== SELLER_ID) throw new Error(`seller_mismatch:${account.userId}`);
  const token = integration.access_token;

  const [catalog, catalogSearch, oldItems, feeShipping, imageResults] = await Promise.all([
    ml(token, `/products/${CATALOG_PRODUCT_ID}`),
    ml(token, `/products/search?status=active&site_id=MLB&listing_strategy=catalog_required&product_identifier=${GTIN}`),
    Promise.all(WRONG_ITEMS.map((id) => ml(token, `/items/${id}?include_attributes=all`))),
    quote(token, INITIAL_PRICE, Number(product.custo)),
    Promise.all((product.imagens || []).map(async (url) => {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      return { url, status: response.status, content_type: response.headers.get('content-type'), ok: response.ok && String(response.headers.get('content-type')).startsWith('image/') };
    })),
  ]);
  const exactCatalog = (catalogSearch.data?.results || []).some((row) => row.id === CATALOG_PRODUCT_ID);
  const catalogDiameter = normalize(attr(catalog.data, 'DIAMETER'));
  const oldAudit = oldItems.map((result) => ({
    id: result.data?.id, status: result.data?.status, catalog_product_id: result.data?.catalog_product_id,
    diameter: attr(result.data, 'DIAMETER'), identity: identity(result.data),
  }));
  const initialFinance = feeShipping.values;

  const payload = {
    family_name: FAMILY_NAME,
    category_id: CATEGORY_ID,
    catalog_product_id: CATALOG_PRODUCT_ID,
    catalog_listing: true,
    price: INITIAL_PRICE,
    currency_id: 'BRL',
    available_quantity: Number(product.estoque),
    buying_mode: 'buy_it_now',
    listing_type_id: LISTING_TYPE,
    condition: 'new',
    pictures: (product.imagens || []).map((source) => ({ source })),
    attributes: [
      { id: 'BRAND', value_id: '82653', value_name: 'Ventisol' },
      { id: 'LINE', value_id: '8062811', value_name: 'Coluna' },
      { id: 'MODEL', value_id: '11860495', value_name: 'Turbo 6' },
      { id: 'FAN_TYPE', value_id: '291721', value_name: 'De pé' },
      { id: 'DIAMETER', value_id: '124571', value_name: '30 cm' },
      { id: 'FREQUENCY', value_id: '8219790', value_name: '60 Hz' },
      { id: 'STRUCTURE_COLOR', value_id: '52049', value_name: 'Preto' },
      { id: 'VOLTAGE', value_id: '39205162', value_name: '127V' },
      { id: 'BLADES_COLOR', value_id: '2247758', value_name: 'Preto' },
      { id: 'BLADES_MATERIAL', value_id: '6350782', value_name: 'Plástico' },
      { id: 'BLADES_NUMBER', value_id: '1000324', value_name: '6' },
      { id: 'POWER', value_id: '3658971', value_name: '52 W' },
      { id: 'HEIGHT', value_id: '13410255', value_name: '1.16 m' },
      { id: 'POWER_SUPPLY_TYPE', value_id: '8152567', value_name: 'Corrente elétrica' },
      { id: 'SPEEDS_NUMBER', value_id: '1000288', value_name: '3' },
      { id: 'WITH_TURBO_FUNCTION', value_id: '242085', value_name: 'Sim' },
      { id: 'GTIN', value_name: GTIN },
      { id: 'MANUFACTURER', value_id: '82653', value_name: 'Ventisol' },
      { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' },
      { id: 'SELLER_SKU', value_name: SKU },
    ],
    sale_terms: [
      { id: 'WARRANTY_TYPE', value_id: '2230279', value_name: 'Garantia de fábrica' },
      { id: 'WARRANTY_TIME', value_name: '12 meses' },
    ],
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: true },
    seller_custom_field: SKU,
  };
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const gates = {
    product: product.sku === SKU && product.gtin === GTIN && /30\s*cm/i.test(product.nome),
    stock: Number(product.estoque) > 0,
    catalog: catalog.ok && catalog.data?.status === 'active' && exactCatalog && catalogDiameter === '30 cm',
    wrong_items_paused: oldAudit.every((row) => row.status === 'paused'),
    wrong_catalog_confirmed: oldAudit.every((row) => row.catalog_product_id === WRONG_CATALOG && normalize(row.diameter) === '50 cm'),
    images: imageResults.length > 0 && imageResults.every((row) => row.ok),
    financial: initialFinance.margin >= FINAL_MARGIN,
  };
  const preflight = { started_at: startedAt, mode: APPLY ? 'apply' : 'dry_run', product, offers, catalog: catalog.data, old_items: oldAudit, images: imageResults, finance: initialFinance, gates, payload_hash: payloadHash, payload };
  writeJson('preflight.json', preflight);
  if (!Object.values(gates).every(Boolean)) throw new Error(`preflight_failed:${JSON.stringify(gates)}`);
  if (!APPLY) {
    writeJson('summary.json', { result: 'DRY_RUN_READY', payload_hash: payloadHash, gates, writes: { ml_post: 0, ml_put: 0, local: 0 } });
    console.log(JSON.stringify({ result: 'DRY_RUN_READY', payload_hash: payloadHash, price: INITIAL_PRICE, margin: initialFinance.margin }));
    return;
  }

  await ensureWrongItemBlocks();
  const inventory = await scanRemoteInventory(token);
  const correctExisting = inventory.items.filter((candidate) => identity(candidate).passed);
  writeJson('duplicate-check.json', {
    inventory: { expected_total: inventory.expected_total, captured: inventory.captured },
    exact_matches: correctExisting.map((candidate) => candidate.id),
  });
  if (correctExisting.length > 0) {
    throw new Error(`correct_remote_duplicate:${correctExisting.map((candidate) => candidate.id).join(',')}`);
  }

  const post = await ml(token, '/items', { method: 'POST', itemCreation: true, body: payload });
  writeJson('post-response.json', post);
  if (!post.ok || !post.data?.id) throw new Error(`post_failed_http_${post.status}:${post.data?.message || post.data?.error || ''}`);
  const itemId = String(post.data.id);
  let item = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const read = await ml(token, `/items/${itemId}?include_attributes=all`);
    item = read.data;
    if (read.ok && item?.id && !String(item?.sub_status || '').includes('picture_download_pending')) break;
    await sleep(attempt * 1000);
  }
  let identityResult = identity(item);
  if (!identityResult.passed) {
    await ml(token, `/items/${itemId}`, { method: 'PUT', safetyPause: true, body: { status: 'paused' } });
    writeJson('remote-readback.json', { item, identity: identityResult, safety_paused: true });
    throw new Error(`post_identity_drift:${JSON.stringify(identityResult.fields)}`);
  }

  let postQuote = await quote(token, Number(item.price), Number(product.custo), itemId);
  if (postQuote.values.margin < FINAL_MARGIN) {
    const feeRate = postQuote.values.fee / postQuote.values.price;
    const required = (Number(product.custo) + postQuote.values.shipping) / (1 - feeRate - TAX_RATE - PUT_TARGET_MARGIN);
    const newPrice = Math.ceil(required * 100) / 100;
    const update = await ml(token, `/items/${itemId}`, { method: 'PUT', priceUpdate: true, body: { price: newPrice } });
    writeJson('price-update.json', update);
    if (!update.ok) throw new Error(`price_update_failed_http_${update.status}`);
    item = (await ml(token, `/items/${itemId}?include_attributes=all`)).data;
    postQuote = await quote(token, Number(item.price), Number(product.custo), itemId);
  } else {
    writeJson('price-update.json', { executed: false, reason: 'margin_already_protected' });
  }
  if (postQuote.values.margin < FINAL_MARGIN) throw new Error(`protective_margin_failed:${postQuote.values.margin}`);
  identityResult = identity(item);
  if (!identityResult.passed) throw new Error(`final_identity_drift:${JSON.stringify(identityResult.fields)}`);
  const transaction = psql(persistSql(item, postQuote.values));
  const [{ data: localProduct }, { data: localListings }, { data: blocks }] = await Promise.all([
    supabase.from('produtos').select('id,sku,gtin,ml_item_id,ml_status,custom_price,ml_fee,ml_shipping').eq('id', PRODUCT_ID).single(),
    supabase.from('anuncios_ml').select('id,ml_item_id,produto_id,sku,titulo,preco_ml,status,catalogo,permalink').eq('sku', SKU),
    supabase.from('ml_manual_blocklist').select('ml_item_id,sku,ativo,motivo').in('ml_item_id', WRONG_ITEMS).eq('ativo', true),
  ]);
  const finalRead = (await ml(token, `/items/${itemId}?include_attributes=all`)).data;
  const summary = {
    result: 'VTK000456_IDENTITY_REPAIR_SUCCESS', item_id: itemId,
    catalog_product_id: finalRead.catalog_product_id, title: finalRead.title,
    diameter: attr(finalRead, 'DIAMETER'), status: finalRead.status,
    price: finalRead.price, stock: finalRead.available_quantity,
    financial: postQuote.values, identity: identity(finalRead), transaction,
    local: { product: localProduct, listings: localListings, wrong_item_blocks: blocks },
    old_remote_items: oldAudit, writes: { posts: postCount, price_puts: pricePutCount, safety_pauses: safetyPauseCount, local_transaction: 1 },
  };
  writeJson('remote-readback.json', { item: finalRead, identity: summary.identity });
  writeJson('financial.json', postQuote);
  writeJson('local-readback.json', summary.local);
  writeJson('summary.json', summary);
  console.log(JSON.stringify({ result: summary.result, item_id: itemId, price: finalRead.price, margin: postQuote.values.margin, transaction_id: transaction.transaction_id }));
}

main().catch((error) => {
  const summary = { result: 'VTK000456_IDENTITY_REPAIR_FAILED', error: error.message, writes: { posts: postCount, price_puts: pricePutCount, safety_pauses: safetyPauseCount }, at: now() };
  writeJson('summary.json', summary);
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
});
