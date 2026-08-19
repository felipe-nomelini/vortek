#!/usr/bin/env node
/* Phase 5D: protect one catalog canary, gate on official quality, then persist locally. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { attributeValue, extractShippingCost, normalize } = require('./lib/ml-p0-phase5c');
const { EXPECTED, buildQualityInfo, chooseProtectivePrice, financialAt, mapListingType, mapStatus, minimumProtectivePrice, normalizeQuality, validateIdentity } = require('./lib/ml-p0-phase5d');

dotenv.config({ path: '.env.local', quiet: true });
const REPORT_DIR = path.resolve('reports/ml-p0-phase5d');
const HOLD = 'P0 PHASE 5D — SAFE PUBLICATION HOLD';
const SSH_HOST = '192.168.1.160';
const DB_CONTAINER = 'supabase-db';
const QUALITY_GATE = 65;
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DESCRIPTION = `VENTILADOR DE MESA VENTISOL TURBO 6 40 CM AZUL 127 V

Ventilador de mesa Ventisol Turbo 6P com hélice de seis pás, três níveis de velocidade e potência de 80 W. Esta versão é azul e opera em 127 V.

CARACTERÍSTICAS
- Marca: Ventisol
- Linha: Turbo 6P
- Tipo: ventilador de mesa
- Voltagem: 127 V
- Potência: 80 W
- Diâmetro: 40 cm
- Quantidade de pás: 6
- Velocidades: 3
- Cor das pás: azul

CONTEÚDO DA EMBALAGEM
- 1 ventilador de mesa Ventisol Turbo 6P 40 cm azul 127 V

Produto novo. Antes do uso, siga as orientações do manual do fabricante.`;
const metrics = { ml_gets: 0, ml_price_puts: 0, ml_description_writes: 0, ml_other_writes: 0, supabase_reads: 0, postgres_transactions: 0, second_sku_actions: 0 };
fs.mkdirSync(REPORT_DIR, { recursive: true });
const writeJson = (name, value) => fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);

function safeHeaders(headers) {
  const result = {};
  for (const key of ['x-request-id', 'x-correlation-id', 'x-trace-id', 'date', 'content-type']) if (headers.get(key)) result[key] = headers.get(key);
  return result;
}
const requestId = (headers) => headers.get('x-request-id') || headers.get('x-correlation-id') || headers.get('x-trace-id') || null;

async function mlRequest(token, resource, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'GET') metrics.ml_gets += 1;
  else if (method === 'PUT' && resource === `/items/${EXPECTED.itemId}` && options.priceWrite && metrics.ml_price_puts === 0) metrics.ml_price_puts += 1;
  else if (['POST', 'PUT'].includes(method) && resource.startsWith(`/items/${EXPECTED.itemId}/description`) && options.descriptionWrite && metrics.ml_description_writes === 0) metrics.ml_description_writes += 1;
  else { metrics.ml_other_writes += 1; throw new Error(`ml_write_forbidden:${method}:${resource}`); }
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(options.timeout || 60000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok && !options.allowError) throw new Error(`ml_http_${response.status}:${resource}:${data?.message || data?.error || 'unknown'}`);
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}

function createDb() {
  const url = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_configuration_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function dbSelect(db, table, select, configure) {
  metrics.supabase_reads += 1;
  let query = db.from(table).select(select); if (configure) query = configure(query);
  const { data, error } = await query; if (error) throw new Error(`supabase_${table}:${error.message}`); return data || [];
}
function sqlLiteral(value) { return value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`; }
function psql(sql) {
  const command = `docker exec -i ${DB_CONTAINER} psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At`;
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', SSH_HOST, command], { input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`psql_failed:${String(result.stderr || result.stdout).trim()}`);
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('psql_json_output_missing'); return JSON.parse(lines.at(-1));
}
function localReadbackSql() {
  return `select json_build_object('read_at',clock_timestamp(),'product',(select row_to_json(p) from (select id,sku,nome,gtin,ml_item_id,ml_status,estoque,custo,altura,largura,profundidade,peso_bruto,updated_at from public.produtos where id='${EXPECTED.productId}'::uuid)p),'item_listings',coalesce((select json_agg(row_to_json(a)) from (select * from public.anuncios_ml where ml_item_id='${EXPECTED.itemId}')a),'[]'::json),'product_listings',coalesce((select json_agg(row_to_json(a)) from (select * from public.anuncios_ml where produto_id='${EXPECTED.productId}'::uuid or sku='${EXPECTED.sku}')a),'[]'::json),'products_pointing_to_item',coalesce((select json_agg(row_to_json(p)) from (select id,sku,ml_item_id from public.produtos where ml_item_id='${EXPECTED.itemId}')p),'[]'::json));`;
}
function buildPersistenceSql(item, qualityInfo) {
  const quality = Number(qualityInfo.score);
  return `\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('ml-p0:${EXPECTED.sku}',0));
create temp table phase5d_result(result text,listing_id uuid,transaction_id bigint) on commit preserve rows;
do $phase5d$
declare v_product public.produtos%rowtype; v_existing public.anuncios_ml%rowtype; v_listing_id uuid; v_conflicts integer; v_updated integer;
begin
 select * into v_product from public.produtos where id='${EXPECTED.productId}'::uuid for update;
 if not found or v_product.sku<>'${EXPECTED.sku}' or coalesce(v_product.gtin,'')<>'${EXPECTED.gtin}' then raise exception 'LOCAL_PERSIST_FAILED:identity'; end if;
 perform 1 from public.anuncios_ml where ml_item_id='${EXPECTED.itemId}' or produto_id='${EXPECTED.productId}'::uuid or sku='${EXPECTED.sku}' for update;
 select count(*) into v_conflicts from public.produtos where id<>'${EXPECTED.productId}'::uuid and ml_item_id='${EXPECTED.itemId}'; if v_conflicts>0 then raise exception 'LOCAL_PERSIST_FAILED:foreign_product'; end if;
 select count(*) into v_conflicts from public.anuncios_ml where (produto_id='${EXPECTED.productId}'::uuid or sku='${EXPECTED.sku}') and ml_item_id<>'${EXPECTED.itemId}'; if v_conflicts>0 then raise exception 'LOCAL_PERSIST_FAILED:competing_listing'; end if;
 select * into v_existing from public.anuncios_ml where ml_item_id='${EXPECTED.itemId}';
 if v_product.ml_item_id='${EXPECTED.itemId}' and found and v_existing.produto_id='${EXPECTED.productId}'::uuid and v_existing.sku='${EXPECTED.sku}' then
  update public.anuncios_ml set titulo=${sqlLiteral(item.title)},tipo=${sqlLiteral(mapListingType(item.listing_type_id))},preco_ml=${Number(item.price).toFixed(2)},vendidos=${Number(item.sold_quantity || 0)},qualidade=${quality},qualidade_info=${sqlLiteral(JSON.stringify(qualityInfo))}::jsonb,status=${sqlLiteral(mapStatus(item.status))}::public.ml_status,catalogo=${item.catalog_listing === true},thumbnail=${sqlLiteral(item.pictures?.[0]?.secure_url || item.thumbnail || null)},permalink=${sqlLiteral(item.permalink || null)},updated_at=clock_timestamp() where id=v_existing.id;
  insert into phase5d_result values('ALREADY_CONSISTENT',v_existing.id,txid_current()); return;
 end if;
 if v_product.ml_item_id is not null or found or v_product.ml_status<>'sem_anuncio'::public.ml_status then raise exception 'LOCAL_PERSIST_FAILED:concurrent_state'; end if;
 insert into public.anuncios_ml(ml_item_id,produto_id,sku,titulo,tipo,preco_ml,vendidos,qualidade,qualidade_info,status,catalogo,thumbnail,permalink) values('${EXPECTED.itemId}','${EXPECTED.productId}'::uuid,'${EXPECTED.sku}',${sqlLiteral(item.title)},${sqlLiteral(mapListingType(item.listing_type_id))},${Number(item.price).toFixed(2)},${Number(item.sold_quantity || 0)},${quality},${sqlLiteral(JSON.stringify(qualityInfo))}::jsonb,${sqlLiteral(mapStatus(item.status))}::public.ml_status,${item.catalog_listing === true},${sqlLiteral(item.pictures?.[0]?.secure_url || item.thumbnail || null)},${sqlLiteral(item.permalink || null)}) returning id into v_listing_id;
 update public.produtos set ml_item_id='${EXPECTED.itemId}',ml_status='ativo'::public.ml_status where id='${EXPECTED.productId}'::uuid and sku='${EXPECTED.sku}' and ml_item_id is null and ml_status='sem_anuncio'::public.ml_status;
 get diagnostics v_updated=row_count; if v_updated<>1 then raise exception 'LOCAL_PERSIST_FAILED:conditional_update'; end if;
 insert into phase5d_result values('LOCAL_PERSIST_SUCCESS',v_listing_id,txid_current());
end $phase5d$;
commit;
select row_to_json(r) from (select result,listing_id,transaction_id,true as committed from phase5d_result)r;`;
}

async function fullInventory(token) {
  const ids = []; const seen = new Set(); let scroll = ''; let total = null; let pages = 0;
  while (pages < 1000) {
    const query = scroll ? `search_type=scan&scroll_id=${encodeURIComponent(scroll)}` : 'search_type=scan&limit=100';
    const page = (await mlRequest(token, `/users/${EXPECTED.sellerId}/items/search?${query}`)).data; pages += 1;
    if (total === null) total = Number(page?.paging?.total || 0); ids.push(...(page?.results || []).map(String));
    if (!(page?.results || []).length || new Set(ids).size >= total || !page.scroll_id || seen.has(page.scroll_id)) break;
    seen.add(page.scroll_id); scroll = page.scroll_id;
  }
  const unique = [...new Set(ids)]; const items = []; const fields = 'id,title,status,seller_custom_field,user_product_id,family_id,catalog_product_id,category_id,attributes';
  for (let i = 0; i < unique.length; i += 20) {
    const rows = (await mlRequest(token, `/items?ids=${unique.slice(i, i + 20).join(',')}&attributes=${fields}`)).data;
    for (const row of rows || []) if (Number(row.code) === 200 && row.body?.id) items.push(row.body);
  }
  if (unique.length !== total || items.length !== unique.length) throw new Error(`remote_inventory_unreliable:${unique.length}/${total}/${items.length}`);
  return { total, pages, items };
}
function sameProduct(item) {
  const checks = { sku: normalize(item.seller_custom_field || attributeValue(item, 'SELLER_SKU')) === normalize(EXPECTED.sku), gtin: normalize(attributeValue(item, 'GTIN')) === normalize(EXPECTED.gtin), catalog: String(item.catalog_product_id || '') === EXPECTED.catalogProductId, brand: normalize(attributeValue(item, 'BRAND')) === normalize(EXPECTED.brand), model: normalize(attributeValue(item, 'MODEL')).includes(normalize(EXPECTED.model)), voltage: normalize(attributeValue(item, 'VOLTAGE')) === normalize(EXPECTED.voltage) };
  return { checks, equivalent: checks.sku || checks.gtin || checks.catalog };
}
async function duplicateAudit(token) {
  const inventory = await fullInventory(token);
  const matches = inventory.items.map((item) => ({ item, identity: sameProduct(item) })).filter((row) => row.identity.equivalent).map((row) => ({ id: row.item.id, status: row.item.status, title: row.item.title, ...row.identity }));
  return { checked_at: now(), inventory: { total: inventory.total, pages: inventory.pages, reliable: true }, matches, target_present: matches.some((row) => row.id === EXPECTED.itemId), competing_matches: matches.filter((row) => row.id !== EXPECTED.itemId) };
}
async function feeQuote(token, price, item) {
  const params = new URLSearchParams({ price: Number(price).toFixed(2), category_id: item.category_id, listing_type_id: item.listing_type_id, currency_id: 'BRL', logistic_type: item.shipping?.logistic_type || 'drop_off', shipping_mode: 'me2' });
  const data = (await mlRequest(token, `/sites/MLB/listing_prices?${params}`)).data; const rows = Array.isArray(data) ? data : [data]; const quote = rows.find((row) => row?.listing_type_id === item.listing_type_id) || rows[0];
  const amount = Number(quote?.sale_fee_amount); if (!Number.isFinite(amount)) throw new Error('fee_quote_missing'); return { checked_at: now(), amount, raw: quote };
}
async function shippingQuote(token, price) {
  const params = new URLSearchParams({ item_id: EXPECTED.itemId, verbose: 'true', item_price: Number(price).toFixed(2), listing_type_id: EXPECTED.listingTypeId, mode: 'me2', condition: 'new', free_shipping: 'true' });
  const data = (await mlRequest(token, `/users/${EXPECTED.sellerId}/shipping_options/free?${params}`)).data; const amount = extractShippingCost(data); if (!Number.isFinite(amount)) throw new Error('shipping_quote_missing'); return { checked_at: now(), amount, raw: data };
}
async function performanceRead(token, up = EXPECTED.userProductId) {
  const attempts = [];
  for (const endpoint of [`/user-product/${encodeURIComponent(up)}/performance`, `/item/${EXPECTED.itemId}/performance`]) {
    const response = await mlRequest(token, endpoint, { allowError: true }); attempts.push({ endpoint, http_status: response.status, body: response.data });
    if (response.ok && normalizeQuality(response.data) !== null) return { checked_at: now(), endpoint, http_status: response.status, performance: response.data, score: normalizeQuality(response.data), attempts };
  }
  return { checked_at: now(), endpoint: attempts.at(-1)?.endpoint, http_status: attempts.at(-1)?.http_status, performance: null, score: null, attempts };
}
async function maybeDescription(token, quality) {
  const current = await mlRequest(token, `/items/${EXPECTED.itemId}/description`, { allowError: true }); const missing = current.status === 404 || !String(current.data?.plain_text || '').trim();
  const report = { checked_at: now(), required: Number(quality.score) < QUALITY_GATE, current_http: current.status, current_description_present: !missing, writes: [], evidence: ['Ventisol official product page', 'DSLite produto 70704'] };
  if (!(Number(quality.score) < QUALITY_GATE) || !missing) return report;
  const method = current.status === 404 ? 'POST' : 'PUT'; const endpoint = `/items/${EXPECTED.itemId}/description?api_version=2`;
  const response = await mlRequest(token, endpoint, { method, descriptionWrite: true, body: { plain_text: DESCRIPTION }, allowError: true });
  report.writes.push({ endpoint: `${method} ${endpoint}`, http_status: response.status, request_id: requestId(response.headers), response_headers: safeHeaders(response.headers), response_body: response.data, text: DESCRIPTION });
  if (response.ok) { const readback = await mlRequest(token, `/items/${EXPECTED.itemId}/description`, { allowError: true }); report.readback = { http_status: readback.status, body: readback.data, match: String(readback.data?.plain_text || '').trim() === DESCRIPTION.trim() }; }
  return report;
}
function compareLocalRemote(local, item, quality) {
  const listing = local.item_listings?.[0] || null;
  const fields = [['product.ml_item_id', EXPECTED.itemId, local.product?.ml_item_id], ['listing.ml_item_id', EXPECTED.itemId, listing?.ml_item_id], ['SKU', EXPECTED.sku, listing?.sku], ['produto_id', EXPECTED.productId, listing?.produto_id], ['title', item.title, listing?.titulo], ['price', Number(item.price), Number(listing?.preco_ml)], ['status', mapStatus(item.status), listing?.status], ['listing_type', mapListingType(item.listing_type_id), listing?.tipo], ['catalog', item.catalog_listing === true, listing?.catalogo], ['quality', Number(quality), Number(listing?.qualidade)], ['permalink', item.permalink, listing?.permalink]].map(([field, remote, localValue]) => ({ field, local: localValue, remote, status: String(localValue) === String(remote) ? 'MATCH' : 'DIVERGENT' }));
  const unique = local.item_listings?.length === 1 && local.product_listings?.length === 1 && local.products_pointing_to_item?.length === 1;
  return { fields, unique, material_drift: !unique || fields.some((row) => row.status === 'DIVERGENT') };
}

async function main() {
  const startedAt = now();
  const policy = { generated_at: now(), mode: 'SAFE_PUBLICATION_MODE', protective_margin_min_percent: 50, quality_gate_percent: 65, industrial_flow: ['IDENTITY', 'DUPLICITY', 'CREATION', 'PROTECTIVE_PRICE', 'QUALITY', 'VALIDATION', 'LOCAL_PERSISTENCE'], commercial_optimization: 'COMMERCIAL_OPTIMIZATION_PENDING' };
  writeJson('policy-change.json', policy);
  const db = createDb(); const integrations = await dbSelect(db, 'integracoes', 'tipo,access_token,conectado', (query) => query.eq('tipo', 'mercadolivre')); const integration = integrations[0];
  if (!integration?.conectado || !integration?.access_token) throw new Error('ml_integration_unavailable');
  const account = await assertAllowedMercadoLivreToken(integration.access_token, 'ml-p0-phase5d'); if (Number(account.userId) !== EXPECTED.sellerId) throw new Error(`seller_mismatch:${account.userId}`); const token = integration.access_token;
  const [products, offers, localListings] = await Promise.all([dbSelect(db, 'produtos', '*', (q) => q.eq('id', EXPECTED.productId)), dbSelect(db, 'produto_fornecedor_ofertas', '*', (q) => q.eq('produto_id', EXPECTED.productId)), dbSelect(db, 'anuncios_ml', '*', (q) => q.or(`produto_id.eq.${EXPECTED.productId},sku.eq.${EXPECTED.sku},ml_item_id.eq.${EXPECTED.itemId}`))]);
  const product = products[0]; if (!product || product.sku !== EXPECTED.sku || normalize(product.gtin) !== normalize(EXPECTED.gtin)) throw new Error('IDENTITY_DRIFT:local_product');
  const offer = offers.find((row) => row.id === product.oferta_preferencial_id); const cost = Number(offer?.custo ?? product.custo); if (Math.abs(cost - EXPECTED.cost) > 0.01) throw new Error(`IDENTITY_DRIFT:cost:${cost}`);
  const preItem = (await mlRequest(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`)).data; const identity = validateIdentity(preItem); const duplicate = await duplicateAudit(token);
  writeJson('pre-update-readback.json', { checked_at: now(), item: preItem, identity, duplicate, local: { product, preferred_offer: offer, listings: localListings } });
  if (!identity.passed || !duplicate.target_present || duplicate.competing_matches.length || Number(preItem.available_quantity) !== EXPECTED.quantity || preItem.status !== 'active') throw new Error('IDENTITY_DRIFT:pre_price_gate');
  const [floorShipping, floorFee] = await Promise.all([shippingQuote(token, EXPECTED.authorizedFloor), feeQuote(token, EXPECTED.authorizedFloor, preItem)]); const conservativeShipping = Math.max(EXPECTED.priorShipping, floorShipping.amount);
  const minimum = minimumProtectivePrice({ cost, shipping: conservativeShipping, commissionRate: EXPECTED.commissionRate, taxRate: EXPECTED.taxRate, marginRate: EXPECTED.protectiveMargin }); const price = chooseProtectivePrice({ authorizedFloor: EXPECTED.authorizedFloor, minimumPrice: minimum });
  let fee = floorFee; let shipping = floorShipping; if (price !== EXPECTED.authorizedFloor) [shipping, fee] = await Promise.all([shippingQuote(token, price), feeQuote(token, price, preItem)]);
  const shippingUsed = Math.max(EXPECTED.priorShipping, shipping.amount); const financial = financialAt({ price, fee: fee.amount, shipping: shippingUsed, cost });
  const priceCalc = { calculated_at: now(), prior_price: Number(preItem.price), authorized_floor: EXPECTED.authorizedFloor, theoretical_minimum: minimum, selected_price: price, cost, commission_quote: fee, prior_shipping: EXPECTED.priorShipping, current_shipping_quote: shipping, shipping_used: shippingUsed, tax_rate: EXPECTED.taxRate, target_margin_percent: 50, calculation: financial, approved: financial.margin_percent + 1e-9 >= 50 };
  writeJson('protective-price-calculation.json', priceCalc); if (!priceCalc.approved) throw new Error('PROTECTIVE_PRICE_FAILED');
  const update = await mlRequest(token, `/items/${EXPECTED.itemId}`, { method: 'PUT', priceWrite: true, body: { price }, allowError: true });
  const updateReport = { attempted_at: now(), endpoint: `PUT /items/${EXPECTED.itemId}`, request_body: { price }, http_status: update.status, request_id: requestId(update.headers), response_headers: safeHeaders(update.headers), response_body: update.data }; writeJson('price-update-response.json', updateReport); if (!update.ok) throw new Error(`PROTECTIVE_PRICE_FAILED:http_${update.status}`);
  const postItem = (await mlRequest(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`)).data; const postIdentity = validateIdentity(postItem); const [postShipping, postFee] = await Promise.all([shippingQuote(token, Number(postItem.price)), feeQuote(token, Number(postItem.price), postItem)]); const postShippingUsed = Math.max(EXPECTED.priorShipping, floorShipping.amount, postShipping.amount); const postFinancial = financialAt({ price: Number(postItem.price), fee: postFee.amount, shipping: postShippingUsed, cost });
  writeJson('post-price-readback.json', { checked_at: now(), item: postItem, identity: postIdentity, financial: { fee: postFee, shipping: postShipping, shipping_used: postShippingUsed, values: postFinancial, protective_price_ok: postFinancial.margin_percent + 1e-9 >= 50 } });
  if (!postIdentity.passed || Number(postItem.available_quantity) !== EXPECTED.quantity || Number(postItem.price) !== price) throw new Error('IDENTITY_DRIFT:post_price'); if (postFinancial.margin_percent + 1e-9 < 50) throw new Error('PROTECTIVE_PRICE_FAILED:post');
  const qualityBefore = await performanceRead(token, postItem.user_product_id); writeJson('quality-before.json', qualityBefore); const remediation = await maybeDescription(token, qualityBefore); writeJson('quality-remediation.json', remediation);
  let qualityAfter = qualityBefore;
  if (metrics.ml_description_writes > 0 && remediation.writes[0]?.http_status >= 200 && remediation.writes[0]?.http_status < 300) for (let attempt = 1; attempt <= 6; attempt += 1) { await sleep(attempt === 1 ? 3000 : 10000); qualityAfter = await performanceRead(token, postItem.user_product_id); qualityAfter.poll_attempt = attempt; if (Number(qualityAfter.score) >= QUALITY_GATE) break; }
  const qualityInfo = qualityAfter.performance ? buildQualityInfo(qualityAfter.performance, qualityAfter.endpoint, qualityAfter.checked_at) : null; const qualityPassed = Number(qualityAfter.score) >= QUALITY_GATE; writeJson('quality-after.json', { ...qualityAfter, quality_info: qualityInfo, gate: QUALITY_GATE, passed: qualityPassed });
  let transaction = null; let localAfter = psql(localReadbackSql()); let reconciliation = { fields: [], unique: false, material_drift: null, reason: 'quality_gate_not_passed' }; let result = 'QUALITY_REMEDIATION_REQUIRED';
  if (qualityPassed) { metrics.postgres_transactions += 1; transaction = psql(buildPersistenceSql(postItem, qualityInfo)); localAfter = psql(localReadbackSql()); const finalItem = (await mlRequest(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`)).data; reconciliation = compareLocalRemote(localAfter, finalItem, qualityAfter.score); result = transaction.committed && !reconciliation.material_drift ? (Number(qualityAfter.score) > QUALITY_GATE ? 'SAFE_PUBLICATION_SUCCESS_QUALITY_HIGHER' : 'SAFE_PUBLICATION_SUCCESS') : 'LOCAL_PERSIST_FAILED'; }
  writeJson('local-persistence.json', { executed: qualityPassed, transaction, local_readback: localAfter }); writeJson('local-remote-diff.json', reconciliation);
  const summary = { phase: '5D', generated_at: now(), result, sku: EXPECTED.sku, produto_id: EXPECTED.productId, item_id: EXPECTED.itemId, user_product_id: EXPECTED.userProductId, family_id: EXPECTED.familyId, protection: { previous_price: Number(preItem.price), protective_price: Number(postItem.price), shipping_used: postShippingUsed, ...postFinancial, status: 'PROTECTIVE_PRICE_OK' }, quality: { before: qualityBefore.score, after: qualityAfter.score, gate: QUALITY_GATE, status: qualityPassed ? 'QUALITY_GATE_PASSED' : 'QUALITY_REMEDIATION_REQUIRED', endpoint: qualityAfter.endpoint }, identity: { sku: EXPECTED.sku, gtin: EXPECTED.gtin, catalog: EXPECTED.catalogProductId, model: EXPECTED.model, voltage: EXPECTED.voltage, color: EXPECTED.color, diameter: EXPECTED.diameter, passed: postIdentity.passed }, persistence: { executed: qualityPassed, transaction, unique: reconciliation.unique, material_drift: reconciliation.material_drift }, commercial: 'COMMERCIAL_OPTIMIZATION_PENDING', metrics, hold: HOLD };
  writeJson('summary.json', summary); writeJson('full-report.json', { ...summary, started_at: startedAt, completed_at: now(), policy, pre_update_readback: { identity, duplicate }, protective_price_calculation: priceCalc, price_update_response: updateReport, post_price_readback: { identity: postIdentity, financial: postFinancial }, quality_before: qualityBefore, quality_remediation: remediation, quality_after: qualityAfter, local_persistence: { transaction, local_after: localAfter }, local_remote_diff: reconciliation, official_contracts: { price_update: 'https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/atualiza-tuas-publicacoes', quality: 'https://developers.mercadolivre.com.br/pt_br/como-comecar/qualidade-das-publicacoes', description: 'https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos', supabase: 'https://supabase.com/docs/guides/database/connecting-to-postgres' }, invariants: { one_price_put: metrics.ml_price_puts === 1, no_other_ml_writes: metrics.ml_other_writes === 0, no_second_sku: metrics.second_sku_actions === 0 } });
  console.log(JSON.stringify({ event: 'p0_phase5d_complete', result, price: postItem.price, margin: postFinancial.margin_percent, quality: qualityAfter.score, persisted: qualityPassed, metrics }));
}

main().catch((error) => {
  const result = error.message.startsWith('PROTECTIVE_PRICE') ? 'PROTECTIVE_PRICE_FAILED' : error.message.startsWith('IDENTITY_DRIFT') ? 'IDENTITY_DRIFT' : 'LOCAL_PERSIST_FAILED'; const summary = { phase: '5D', generated_at: now(), result, error: error.message, sku: EXPECTED.sku, item_id: EXPECTED.itemId, metrics, commercial: 'COMMERCIAL_OPTIMIZATION_PENDING', hold: HOLD }; writeJson('summary.json', summary); writeJson('full-report.json', summary);
  for (const name of ['pre-update-readback.json', 'protective-price-calculation.json', 'price-update-response.json', 'post-price-readback.json', 'quality-before.json', 'quality-remediation.json', 'quality-after.json', 'local-persistence.json', 'local-remote-diff.json']) if (!fs.existsSync(path.join(REPORT_DIR, name))) writeJson(name, { result: 'NOT_REACHED', error: error.message });
  console.error(JSON.stringify({ event: 'p0_phase5d_failed', ...summary })); process.exitCode = 1;
});
