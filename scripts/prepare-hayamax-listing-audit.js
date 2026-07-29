/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const SUPPLIER_ID = String(argValue('--supplier-id', '2'));
const SUPPLIER_NAME = String(argValue('--supplier-name', 'Hayamax')).trim();
const IS_HAYAMAX = SUPPLIER_ID === '2';
const DEFAULT_BATCH_SIZE = 20;
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const DEFAULT_OUTPUT_DIR = path.join(
  process.cwd(),
  'reports',
  `auditoria-anuncios-hayamax-conta-${localDate}`,
);

function argValue(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : fallback;
}

function chunks(rows, size) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getSellerSku(item) {
  const attributes = Array.isArray(item?.attributes) ? item.attributes : [];
  const attribute = attributes.find(
    (row) => String(row?.id || '').toUpperCase() === 'SELLER_SKU',
  );
  return String(attribute?.value_name || attribute?.value_id || '').trim();
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function mapLimit(rows, limit, mapper) {
  const result = new Array(rows.length);
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(rows[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return result;
}

async function main() {
  const batchSize = Math.max(1, Number(argValue('--batch-size', DEFAULT_BATCH_SIZE)));
  const outputDir = path.resolve(argValue('--output-dir', DEFAULT_OUTPUT_DIR));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRole) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function fetchAll(queryFactory, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await queryFactory().range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  }

  async function getIntegration() {
    const { data, error } = await supabase
      .from('integracoes')
      .select('access_token,refresh_token,token_expires_at,client_id,client_secret')
      .eq('tipo', 'mercadolivre')
      .maybeSingle();
    if (error || !data) {
      throw new Error(`Integração ML indisponível: ${error?.message || 'sem registro'}`);
    }
    return data;
  }

  async function refreshToken(integration) {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: integration.client_id || '',
        client_secret: integration.client_secret || '',
        refresh_token: integration.refresh_token || '',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(`Falha no refresh ML: HTTP ${response.status} ${payload.error || payload.message || ''}`);
    }

    await assertAllowedMercadoLivreToken(payload.access_token, 'prepare-hayamax-listing-audit:refresh');
    const expiresAt = new Date(
      Date.now() + Number(payload.expires_in || 10800) * 1000,
    ).toISOString();
    const { error } = await supabase
      .from('integracoes')
      .update({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || integration.refresh_token,
        token_expires_at: expiresAt,
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
        last_refresh_error_code: null,
      })
      .eq('tipo', 'mercadolivre');
    if (error) throw new Error(`Falha ao persistir token ML: ${error.message}`);
    return payload.access_token;
  }

  let token = null;
  async function getToken(forceRefresh = false) {
    if (token && !forceRefresh) return token;
    const integration = await getIntegration();
    const expiresAt = new Date(integration.token_expires_at || 0).getTime();
    if (!forceRefresh && integration.access_token && expiresAt > Date.now() + 60000) {
      await assertAllowedMercadoLivreToken(
        integration.access_token,
        'prepare-hayamax-listing-audit:cached',
      );
      token = integration.access_token;
      return token;
    }
    token = await refreshToken(integration);
    return token;
  }

  async function mlRequest(pathname, attempt = 1) {
    const accessToken = await getToken(attempt > 1);
    const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (response.status === 401 && attempt === 1) {
      return mlRequest(pathname, 2);
    }
    if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return mlRequest(pathname, attempt + 1);
    }
    return { ok: response.ok, status: response.status, data, text };
  }

  const offers = await fetchAll(() =>
    supabase
      .from('produto_fornecedor_ofertas')
      .select(
        'id,produto_id,dslite_fornecedor_id,dslite_produto_id,fornecedor_nome,sku_oferta,sku_fornecedor,nome,descricao,marca,gtin,ncm,cest,custo,estoque,ativo,imagens,last_sync_at,updated_at',
      )
      .eq('dslite_fornecedor_id', SUPPLIER_ID)
      .order('id'),
  );
  const offerById = new Map(offers.map((offer) => [String(offer.id), offer]));
  const productIds = [...new Set(offers.map((offer) => String(offer.produto_id)))];

  const products = [];
  for (const ids of chunks(productIds, 150)) {
    const { data, error } = await supabase
      .from('produtos')
      .select(
        'id,sku,nome,descricao,categoria,marca,gtin,ncm,cest,altura,largura,profundidade,peso_bruto,peso_liq,estoque,custo,fornecedor,dslite_fornecedor_id,dslite_produto_id,oferta_preferencial_id,ml_item_id,ml_status,ativo,updated_at',
      )
      .in('id', ids);
    if (error) throw new Error(error.message);
    products.push(...(data || []));
  }
  const productById = new Map(products.map((product) => [String(product.id), product]));
  const preferredProducts = products.filter((product) =>
    offerById.has(String(product.oferta_preferencial_id)),
  );
  const preferredProductIds = new Set(
    preferredProducts.map((product) => String(product.id)),
  );
  const productByAlias = new Map();
  const ambiguousAliases = new Set();

  function registerProductAlias(value, product) {
    const alias = String(value || '').trim().toUpperCase();
    if (!alias || ambiguousAliases.has(alias)) return;
    const current = productByAlias.get(alias);
    if (current && String(current.id) !== String(product.id)) {
      productByAlias.delete(alias);
      ambiguousAliases.add(alias);
      return;
    }
    productByAlias.set(alias, product);
  }

  for (const product of preferredProducts) {
    registerProductAlias(product.sku, product);
  }
  for (const offer of offers) {
    if (!preferredProductIds.has(String(offer.produto_id))) continue;
    const product = productById.get(String(offer.produto_id));
    if (!product) continue;
    registerProductAlias(offer.sku_oferta, product);
    registerProductAlias(offer.sku_fornecedor, product);
    registerProductAlias(offer.dslite_produto_id, product);
    for (const legacySku of [
      offer.sku_oferta,
      offer.sku_fornecedor,
      offer.dslite_produto_id,
    ]) {
      if (IS_HAYAMAX && /^\d+$/.test(String(legacySku || '').trim())) {
        registerProductAlias(`HYX${String(legacySku).trim()}`, product);
      }
    }
  }

  let ads = [];
  for (const ids of chunks(productIds, 150)) {
    const part = await fetchAll(() =>
      supabase
        .from('anuncios_ml')
        .select(
          'id,produto_id,ml_item_id,sku,titulo,status,tipo,preco_ml,qualidade,qualidade_info,permalink,updated_at',
        )
        .in('produto_id', ids)
        .not('ml_item_id', 'is', null)
        .order('id'),
    );
    ads.push(...part);
  }
  ads = [...new Map(ads.map((ad) => [String(ad.id), ad])).values()];
  const adByItemId = new Map(
    ads.map((ad) => [String(ad.ml_item_id), ad]),
  );

  const meResponse = await mlRequest('/users/me');
  if (!meResponse.ok || !meResponse.data?.id) {
    throw new Error(`Falha ao consultar seller ML: HTTP ${meResponse.status}`);
  }
  const sellerId = String(meResponse.data.id);
  const activeAccountItemIds = [];
  const seenAccountItemIds = new Set();
  const scanPages = [];
  let scrollId = null;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({
      status: 'active',
      search_type: 'scan',
      limit: '100',
    });
    if (scrollId) query.set('scroll_id', scrollId);
    const response = await mlRequest(
      `/users/${encodeURIComponent(sellerId)}/items/search?${query}`,
    );
    if (!response.ok) {
      throw new Error(
        `Falha no scan de itens ativos ML: HTTP ${response.status}`,
      );
    }
    const nextScrollId = response.data?.scroll_id
      ? String(response.data.scroll_id)
      : null;
    const results = Array.isArray(response.data?.results)
      ? response.data.results
      : [];
    let newItems = 0;
    for (const itemId of results) {
      const normalizedId = String(itemId);
      if (seenAccountItemIds.has(normalizedId)) continue;
      seenAccountItemIds.add(normalizedId);
      activeAccountItemIds.push(normalizedId);
      newItems += 1;
    }
    scanPages.push({
      page: page + 1,
      results: results.length,
      new_items: newItems,
      scroll_changed: Boolean(scrollId && nextScrollId !== scrollId),
    });
    scrollId = nextScrollId;
    if (!results.length || !scrollId) break;
    if (newItems === 0) {
      throw new Error(
        'Scan ML repetiu uma página sem avançar; auditoria interrompida para não gerar universo parcial',
      );
    }
  }

  const itemResponses = [];
  for (const itemIds of chunks(
    activeAccountItemIds,
    20,
  )) {
    const response = await mlRequest(
      `/items?ids=${encodeURIComponent(itemIds.join(','))}&include_internal_attributes=true`,
    );
    if (!response.ok || !Array.isArray(response.data)) {
      throw new Error(`Falha no multi-get ML: HTTP ${response.status}`);
    }
    itemResponses.push(...response.data);
  }

  const itemById = new Map();
  for (const response of itemResponses) {
    if (response?.code === 200 && response?.body?.id) {
      itemById.set(String(response.body.id), response.body);
    }
  }

  const activeListings = [];
  const unmatchedActiveItems = [];
  let matchedBySku = 0;
  let matchedByDbFallback = 0;
  for (const item of itemById.values()) {
    if (item.status !== 'active') continue;
    const liveSellerSku = String(
      getSellerSku(item) || item.seller_custom_field || '',
    )
      .trim()
      .toUpperCase();
    let product = productByAlias.get(liveSellerSku) || null;
    let mappingStrategy = product ? 'seller_sku' : null;
    const dbAd = adByItemId.get(String(item.id)) || null;
    if (!product && dbAd) {
      const fallbackProduct = productById.get(String(dbAd.produto_id));
      if (
        fallbackProduct &&
        preferredProductIds.has(String(fallbackProduct.id))
      ) {
        product = fallbackProduct;
        mappingStrategy = 'anuncios_ml';
      }
    }
    if (!product) {
      unmatchedActiveItems.push({
        ml_item_id: item.id,
        seller_sku: liveSellerSku || null,
        title: item.title,
        catalog_listing: item.catalog_listing === true,
      });
      continue;
    }
    if (mappingStrategy === 'seller_sku') matchedBySku += 1;
    if (mappingStrategy === 'anuncios_ml') matchedByDbFallback += 1;
    const offer = offerById.get(String(product.oferta_preferencial_id));
    const ad = dbAd || {
      id: null,
      produto_id: product.id,
      ml_item_id: item.id,
      sku: product.sku,
      titulo: item.title,
      status: 'ativo',
      tipo: item.listing_type_id,
      preco_ml: item.price,
      qualidade: null,
      qualidade_info: null,
      permalink: item.permalink,
      updated_at: item.last_updated,
    };
    activeListings.push({
      ad: {
        ...ad,
        produto_id: product.id,
        ml_item_id: item.id,
        sku: product.sku,
      },
      product,
      offer,
      item,
      mapping_strategy: mappingStrategy,
    });
  }

  activeListings.sort((left, right) => {
    const skuOrder = String(left.product.sku || '').localeCompare(
      String(right.product.sku || ''),
      'pt-BR',
    );
    if (skuOrder) return skuOrder;
    const catalogOrder =
      Number(left.item.catalog_listing === true) -
      Number(right.item.catalog_listing === true);
    return catalogOrder || String(left.item.id).localeCompare(String(right.item.id));
  });

  const descriptions = await mapLimit(activeListings, 5, async (listing) => {
    const response = await mlRequest(`/items/${listing.item.id}/description`);
    return {
      ml_item_id: String(listing.item.id),
      http_status: response.status,
      plain_text: response.ok ? String(response.data?.plain_text || '') : '',
      last_updated: response.ok ? response.data?.last_updated || null : null,
      error:
        response.ok || response.status === 404
          ? null
          : response.data?.message || response.text || 'description_error',
      missing: response.status === 404,
    };
  });
  const descriptionById = new Map(
    descriptions.map((description) => [description.ml_item_id, description]),
  );

  const importantTitleAttributes = new Set([
    'BRAND',
    'MODEL',
    'DETAILED_MODEL',
    'LINE',
    'COLOR',
    'VOLTAGE',
    'UNITS_PER_PACK',
    'SALE_FORMAT',
    'CAPACITY',
    'VOLUME_CAPACITY',
    'LENGTH',
    'WIDTH',
    'HEIGHT',
    'SIZE',
    'SCREEN_SIZE',
    'POWER',
  ]);

  const auditRows = activeListings.map((listing, index) => {
    const { ad, product, offer, item } = listing;
    const description = descriptionById.get(String(item.id));
    const plainText = description?.plain_text || '';
    const lines = plainText.split(/\r?\n/);
    const paragraphs = plainText
      .split(/\r?\n\s*\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    const bulletCount = lines.filter((line) => /^\s*(?:[•●▪◦*-])\s+\S/.test(line)).length;
    const titleNormalized = normalize(item?.title);
    const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
    const attrById = new Map(attrs.map((attr) => [String(attr.id || '').toUpperCase(), attr]));
    const mlSellerSku = getSellerSku(item);
    const targetSellerSku = String(product?.sku || ad?.sku || '').trim();
    const sellerCustomField = String(item?.seller_custom_field || '').trim();
    const isCatalogListing = item?.catalog_listing === true;
    const isUserProductListing = (item?.tags || []).includes(
      'user_product_listing',
    );
    const hasSales = Number(item?.sold_quantity || 0) > 0;
    const localGtin = String(product?.gtin || offer?.gtin || '').replace(/\D+/g, '');
    const mlGtin = String(
      attrById.get('GTIN')?.value_name || attrById.get('GTIN')?.value_id || '',
    ).replace(/\D+/g, '');
    const localBrand = normalize(product?.marca || offer?.marca);
    const mlBrand = normalize(
      attrById.get('BRAND')?.value_name || attrById.get('BRAND')?.value_id,
    );
    const titleMissing = attrs
      .filter((attr) => importantTitleAttributes.has(String(attr.id || '').toUpperCase()))
      .filter((attr) => attr.value_id !== '-1' && attr.value_name)
      .filter((attr) => {
        const value = normalize(attr.value_name);
        return value && !titleNormalized.includes(value);
      })
      .map((attr) => ({
        id: attr.id,
        name: attr.name,
        value: attr.value_name,
      }));

    const flags = [];
    if (!plainText.trim()) flags.push('description_empty');
    if (/<[^>]+>/.test(plainText)) flags.push('description_html_literal');
    if (paragraphs.length < 2) flags.push('description_without_paragraphs');
    if (bulletCount < 3) flags.push('description_without_enough_bullets');
    if (String(item?.title || '').length > 60) flags.push('title_over_60_chars');
    if (titleMissing.length) flags.push('title_may_miss_relevant_attributes');
    if (localGtin && mlGtin && localGtin !== mlGtin) flags.push('gtin_conflict');
    if (localBrand && mlBrand && localBrand !== mlBrand) flags.push('brand_conflict');
    if (/^HYX/i.test(mlSellerSku)) {
      flags.push('legacy_hayamax_seller_sku');
    }
    if (/^HYX/i.test(sellerCustomField)) {
      flags.push('legacy_hayamax_seller_custom_field');
    }
    if (
      mlSellerSku &&
      targetSellerSku &&
      normalize(mlSellerSku) !== normalize(targetSellerSku)
    ) {
      flags.push('seller_sku_conflict');
    }
    if (isCatalogListing) flags.push('catalog_managed_content');
    if (!isCatalogListing && hasSales) flags.push('title_locked_by_sales');

    return {
      sequence: index + 1,
      batch: Math.floor(index / batchSize) + 1,
      batch_position: (index % batchSize) + 1,
      audit_status: 'pending_manual_evidence',
      automated_flags: flags,
      description_metrics: {
        characters: plainText.length,
        paragraphs: paragraphs.length,
        bullets: bulletCount,
      },
      sku_audit: {
        ml_seller_sku: mlSellerSku || null,
        ml_seller_custom_field: sellerCustomField || null,
        target_seller_sku: targetSellerSku || null,
        needs_update:
          /^HYX/i.test(mlSellerSku) &&
          /^VTK\d+$/i.test(targetSellerSku) &&
          normalize(mlSellerSku) !== normalize(targetSellerSku),
      },
      editability: {
        catalog_listing: isCatalogListing,
        user_product_listing: isUserProductListing,
        sold_quantity: Number(item?.sold_quantity || 0),
        title_update_mode: isCatalogListing
          ? 'catalog_managed'
          : hasSales
            ? 'locked_by_sales'
            : isUserProductListing
              ? 'family_name'
              : 'title',
        description_editable: !isCatalogListing,
        attributes_editable: !isCatalogListing,
      },
      title_missing_candidates: titleMissing,
      ad,
      product,
      preferred_offer: offer,
      ml_item: item,
      ml_description: description,
      mapping_strategy: listing.mapping_strategy,
      evidence: {
        erp_product: true,
        supplier_offer: true,
        mercado_livre_item: true,
        manufacturer_source: null,
      },
    };
  });

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(
    path.join(outputDir, 'itens-ativos-nao-mapeados.json'),
    unmatchedActiveItems,
  );
  const batchGroups = chunks(auditRows, batchSize);
  for (let index = 0; index < batchGroups.length; index += 1) {
    const batchNumber = String(index + 1).padStart(3, '0');
    writeJson(path.join(outputDir, `lote-${batchNumber}.json`), {
      batch: index + 1,
      total_batches: batchGroups.length,
      item_count: batchGroups[index].length,
      status: 'pending_manual_evidence',
      items: batchGroups[index],
    });
  }

  const manifestRows = auditRows.map((row) => ({
    sequence: row.sequence,
    batch: row.batch,
    batch_position: row.batch_position,
    sku: row.ad.sku,
    ml_seller_sku: row.sku_audit.ml_seller_sku || '',
    target_seller_sku: row.sku_audit.target_seller_sku || '',
    seller_sku_needs_update: row.sku_audit.needs_update ? 'yes' : 'no',
    catalog_listing: row.editability.catalog_listing ? 'yes' : 'no',
    title_update_mode: row.editability.title_update_mode,
    description_editable: row.editability.description_editable ? 'yes' : 'no',
    ml_item_id: row.ad.ml_item_id,
    title: row.ml_item.title,
    category_id: row.ml_item.category_id,
    status: row.ml_item.status,
    description_paragraphs: row.description_metrics.paragraphs,
    description_bullets: row.description_metrics.bullets,
    automated_flags: row.automated_flags.join('|'),
    audit_status: row.audit_status,
  }));
  const csvHeaders = Object.keys(manifestRows[0] || {});
  fs.writeFileSync(
    path.join(outputDir, 'manifesto.csv'),
    [
      csvHeaders.join(','),
      ...manifestRows.map((row) =>
        csvHeaders.map((header) => csvValue(row[header])).join(','),
      ),
    ].join('\n'),
  );

  const identity = auditRows
    .map((row) => `${row.sequence}|${row.batch}|${row.ad.sku}|${row.ad.ml_item_id}`)
    .join('\n');
  const statusCounts = auditRows.reduce((counts, row) => {
    const status = row.ml_item.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const summary = {
    generated_at: new Date().toISOString(),
    supplier_id: SUPPLIER_ID,
    supplier_name: SUPPLIER_NAME,
    seller_id: sellerId,
    definition:
      `Todo item active da conta cujo SELLER_SKU, seller_custom_field ou vínculo do ERP mapeia para produto com oferta preferencial atual ${SUPPLIER_NAME}`,
    supplier_offer_rows: offers.length,
    preferred_supplier_products: preferredProducts.length,
    erp_ads_loaded: ads.length,
    seller_active_items: activeAccountItemIds.length,
    seller_active_items_returned_by_multiget: itemById.size,
    seller_scan_pages: scanPages,
    seller_active_items_unmatched: unmatchedActiveItems.length,
    matched_by_seller_sku: matchedBySku,
    matched_by_erp_fallback: matchedByDbFallback,
    ambiguous_sku_aliases: ambiguousAliases.size,
    live_status_counts: statusCounts,
    active_ads: auditRows.length,
    batch_size: batchSize,
    batch_count: batchGroups.length,
    last_batch_size: batchGroups.at(-1)?.length || 0,
    manifest_sha256: crypto.createHash('sha256').update(identity).digest('hex'),
    description_capture_errors: descriptions.filter((description) => description.error).length,
    descriptions_missing: descriptions.filter((description) => description.missing).length,
    automated_flag_counts: auditRows.reduce((counts, row) => {
      for (const flag of row.automated_flags) counts[flag] = (counts[flag] || 0) + 1;
      return counts;
    }, {}),
  };
  writeJson(path.join(outputDir, 'resumo.json'), summary);

  console.log(JSON.stringify({ ok: true, output_dir: outputDir, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
