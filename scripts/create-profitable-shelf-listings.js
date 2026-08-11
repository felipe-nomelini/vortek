/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const AUDIT = process.argv.includes('--audit');
const ONLY_SKU = String(process.argv.find((arg) => arg.startsWith('--sku=')) || '').slice(6).trim();
const DAS_RATE = 0.05;
const LISTING_TYPE = 'gold_pro';
const REPORT_DIR = path.resolve('reports/ml-profitable-shelf-2026-08-10');
const PREFLIGHT_PATH = path.join(REPORT_DIR, 'dry-run.json');
const STORAGE_PREFIX = 'https://supabase.vortek.shop/storage/v1/object/public/product-images/';

const CONFIG = [
  {
    sku: 'VTK000361',
    produtoId: '8d152f45-e286-4b2b-9462-631d251d929d',
    categoryId: 'MLB447782',
    supplier: 'HAYAMAX-PR',
    familyName: 'Cadeira Gamer Ergonômica ThunderX3 Yama1 Preta Original',
    freight: 110,
    margin: 0.25,
    expectedCost: 1036.96,
    expectedFee: 0.17,
    description: [
      'Cadeira Gamer Ergonômica ThunderX3 Yama1 Preta Original',
      '',
      'Cadeira ergonômica com estrutura ajustável, encosto em malha respirável e elevador a gás classe 4.',
      '',
      'Características:',
      '- Marca: ThunderX3',
      '- Modelo: Yama1',
      '- Cor: preta',
      '- Altura do encosto: 74 cm',
      '- Profundidade do assento: 50 cm',
      '- Largura da cadeira: 66 cm',
      '- Altura máxima: 128 cm',
      '- Giratória e ajustável',
      '- Requer montagem e inclui manual',
      '',
      'Conteúdo: 1 cadeira ThunderX3 Yama1.',
      'Produto original com garantia de fábrica de 12 meses.',
    ].join('\n'),
  },
  {
    sku: 'VTK001959',
    produtoId: 'a5d0514a-87ef-45f7-b811-03b9e5eda284',
    categoryId: 'MLB29307',
    supplier: 'HAYAMAX-PR',
    familyName: 'Trombone De Vara Harmonics Tenor Bb Hsl-700l Laqueado',
    freight: 55,
    margin: 0.25,
    expectedCost: 1249.89,
    expectedFee: 0.165,
    description: [
      'Trombone De Vara Harmonics Tenor Bb HSL-700L Laqueado',
      '',
      'Trombone tenor em Bb com acabamento laqueado e vara leve.',
      '',
      'Características:',
      '- Marca: Harmonics',
      '- Modelo: HSL-700L',
      '- Material: metal',
      '- Acabamento: laqueado',
      '- Acompanha estojo',
      '',
      'Conteúdo: 1 trombone e 1 estojo.',
      'Produto original com garantia de fábrica de 12 meses.',
    ].join('\n'),
  },
  {
    sku: 'VTK000890',
    produtoId: 'ebf5bf73-1146-42df-b6df-381430b7156f',
    categoryId: 'MLB45248',
    supplier: 'HAYAMAX-PR',
    familyName: 'Amplificador Para Instrumentos Laney Ah40 Preto 40w Original',
    freight: 110,
    margin: 0.25,
    expectedCost: 1612.84,
    expectedFee: 0.165,
    description: [
      'Amplificador Para Instrumentos Laney AH40 Preto 40W Original',
      '',
      'Amplificador multiuso para instrumentos, microfones e fontes de áudio.',
      '',
      'Características:',
      '- Marca: Laney',
      '- Modelo: AH40',
      '- Potência: 40 W RMS',
      '- Cor: preta',
      '- 3 canais',
      '- Equalizador gráfico master de 5 bandas',
      '- Delay digital',
      '- Entradas XLR, jack e mini jack',
      '',
      'Conteúdo: 1 amplificador Laney AH40.',
      'A voltagem não consta no cadastro do fornecedor; confira a identificação do equipamento antes do uso.',
      'Produto original com garantia de fábrica de 12 meses.',
    ].join('\n'),
  },
  {
    sku: 'VTK012101',
    produtoId: '6b83343e-4bb3-42f6-801e-f388034a1cf8',
    categoryId: 'MLB7060',
    supplier: 'BKR1',
    familyName: 'Pilha Alcalina Energizer Max Aa Pequena Cartela C/ 2',
    freight: 6.5,
    margin: 0.08,
    expectedCost: 7.5,
    expectedFee: 0.19,
    description: [
      'Pilha Alcalina Energizer Max AA Cartela com 2',
      '',
      'Pilha alcalina AA para controles, brinquedos, lanternas e outros aparelhos compatíveis.',
      '',
      'Características:',
      '- Marca: Energizer',
      '- Modelo: SM-96',
      '- Tamanho: AA',
      '- Composição: alcalina',
      '- Não recarregável',
      '',
      'Conteúdo: 1 cartela com 2 pilhas AA.',
      'Produto original com garantia de fábrica de 12 meses.',
    ].join('\n'),
  },
  {
    sku: 'VTK000464',
    produtoId: 'a32c06fe-483e-4040-a70b-1de7ad0fe7eb',
    categoryId: 'MLB7060',
    supplier: 'BKR1',
    familyName: 'Pilha Alcalina Duracell 12v Mn21 A23 Cartela C/ 2',
    freight: 6.5,
    margin: 0.08,
    expectedCost: 33,
    expectedFee: 0.19,
    description: [
      'Pilha Alcalina Duracell 12V MN21 A23 Cartela com 2',
      '',
      'Pilha alcalina de 12 V para controles, alarmes e outros aparelhos compatíveis com MN21/A23.',
      '',
      'Características:',
      '- Marca: Duracell',
      '- Modelo: MN21/A23',
      '- Tensão: 12 V',
      '- Não recarregável',
      '',
      'Conteúdo: 1 cartela com 2 pilhas.',
      'Produto original com garantia de fábrica de 12 meses.',
    ].join('\n'),
  },
  {
    sku: 'VTK012014',
    produtoId: 'd63548bc-a94a-42bd-b6cb-53ae8976bb03',
    categoryId: 'MLB38172',
    supplier: 'BKR1',
    familyName: 'Conector Fêmea Painel Wc 3 Fca Wireconex Kit 2 Unidades',
    freight: 6.5,
    margin: 0.08,
    expectedCost: 40,
    expectedFee: 0.18,
    description: [
      'Conector Fêmea Painel WC 3 FCA Wireconex Kit 2 Unidades',
      '',
      'Conector fêmea de painel para aplicações de áudio.',
      '',
      'Características:',
      '- Marca: Wireconex',
      '- Modelo: WC 3 FCA',
      '- Corpo azul',
      '- Instalação em painel',
      '',
      'Conteúdo: 2 conectores.',
      'Produto original com garantia de fábrica de 12 meses.',
    ].join('\n'),
  },
];

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculatePrice({ cost, freight, fixedFee, fee, margin }) {
  const denominator = 1 - fee - DAS_RATE - margin;
  if (!(denominator > 0)) throw new Error('Divisor de preço inválido');
  return roundMoney((cost + freight + fixedFee) / denominator);
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function errorMessage(result) {
  const causes = Array.isArray(result?.data?.cause)
    ? result.data.cause.map((cause) => `${cause.code || cause.type || 'causa'}: ${cause.message || cause.description || JSON.stringify(cause)}`).join(' | ')
    : '';
  const base = result?.data?.message || result?.data?.error || result?.text || `HTTP ${result?.status || 0}`;
  return causes ? `${base} | ${causes}` : base;
}

function localStatus(status) {
  if (status === 'active') return 'ativo';
  if (status === 'paused') return 'pausado';
  if (status === 'closed') return 'fechado';
  if (status === 'under_review') return 'em_revisao';
  return 'pausado';
}

function itemPrice(item) {
  const direct = Number(item?.price);
  if (direct > 0) return direct;
  const presentation = Number(item?.prices?.presentation?.amount);
  if (presentation > 0) return presentation;
  const standard = Array.isArray(item?.sale_price)
    ? item.sale_price.find((entry) => entry?.conditions?.context_restrictions?.includes('channel_marketplace'))
    : item?.sale_price;
  return Number(standard?.amount || 0);
}

function sellerSku(item) {
  const attr = (item?.attributes || []).find((entry) => String(entry?.id) === 'SELLER_SKU');
  return String(item?.seller_custom_field || attr?.value_name || attr?.value_id || '').trim();
}

async function getIntegration() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token,refresh_token,token_expires_at,client_id,client_secret')
    .eq('tipo', 'mercadolivre')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`Integração ML indisponível: ${error?.message || 'sem registro'}`);
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
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Falha ao renovar acesso ML: HTTP ${response.status} ${payload.message || payload.error || ''}`);
  }
  await assertAllowedMercadoLivreToken(payload.access_token, 'create-profitable-shelf-listings:refresh');
  const { error } = await supabase.from('integracoes').update({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || integration.refresh_token,
    token_expires_at: new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString(),
    last_refresh_at: new Date().toISOString(),
    last_refresh_error: null,
    last_refresh_error_code: null,
  }).eq('tipo', 'mercadolivre');
  if (error) throw new Error(`Falha ao salvar acesso ML: ${error.message}`);
  return payload.access_token;
}

let token = null;
async function getToken(forceRefresh = false) {
  if (token && !forceRefresh) return token;
  const integration = await getIntegration();
  const expiresAt = new Date(integration.token_expires_at || 0).getTime();
  if (!forceRefresh && integration.access_token && expiresAt > Date.now() + 60000) {
    await assertAllowedMercadoLivreToken(integration.access_token, 'create-profitable-shelf-listings:cached');
    token = integration.access_token;
    return token;
  }
  token = await refreshToken(integration);
  return token;
}

async function mlRequest(apiPath, options = {}, attempt = 1) {
  const accessToken = await getToken(attempt > 1 && options.refreshToken);
  let response;
  try {
    response = await fetch(`https://api.mercadolibre.com${apiPath}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (attempt < 3) {
      await sleep(800 * attempt);
      return mlRequest(apiPath, options, attempt + 1);
    }
    return { ok: false, status: 0, data: null, text: error.message };
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (response.status === 401 && attempt === 1) {
    return mlRequest(apiPath, { ...options, refreshToken: true }, attempt + 1);
  }
  if ([408, 424, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(800 * attempt);
    return mlRequest(apiPath, options, attempt + 1);
  }
  return { ok: response.ok, status: response.status, data, text };
}

async function searchLiveSku(userId, sku) {
  const found = new Set();
  for (const field of ['seller_sku', 'sku']) {
    const result = await mlRequest(`/users/${userId}/items/search?${field}=${encodeURIComponent(sku)}&limit=100`);
    if (!result.ok) throw new Error(`${sku}: busca de duplicidade falhou: ${errorMessage(result)}`);
    for (const id of result.data?.results || []) found.add(String(id));
  }
  return [...found];
}

async function listingFees(config, price) {
  const params = new URLSearchParams({
    price: String(price),
    listing_type_id: LISTING_TYPE,
    category_id: config.categoryId,
    currency_id: 'BRL',
    shipping_mode: 'me2',
  });
  const result = await mlRequest(`/sites/MLB/listing_prices?${params.toString()}`);
  if (!result.ok) throw new Error(`${config.sku}: cálculo de tarifa falhou: ${errorMessage(result)}`);
  const rows = Array.isArray(result.data) ? result.data : [result.data];
  const row = rows.find((entry) => String(entry?.listing_type_id) === LISTING_TYPE) || rows[0];
  const percentageFee = Number(row?.sale_fee_details?.percentage_fee) / 100;
  const fixedFee = Number(row?.sale_fee_details?.fixed_fee || 0);
  if (!Number.isFinite(percentageFee)) throw new Error(`${config.sku}: tarifa percentual ausente`);
  return { percentageFee, fixedFee };
}

async function settlePrice(config, cost) {
  let price = calculatePrice({ cost, freight: config.freight, fixedFee: 0, fee: config.expectedFee, margin: config.margin });
  let fees = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    fees = await listingFees(config, price);
    const next = calculatePrice({ cost, freight: config.freight, fixedFee: fees.fixedFee, fee: fees.percentageFee, margin: config.margin });
    if (next === price) return { price, ...fees };
    price = next;
  }
  fees = await listingFees(config, price);
  return { price, ...fees };
}

async function validateImage(sku, source, index) {
  const response = await fetch(String(source), { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const contentType = String(response.headers.get('content-type') || '');
  if (!response.ok || !contentType.startsWith('image/')) {
    throw new Error(`${sku}: imagem ${index + 1} inválida (HTTP ${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const normalized = await sharp(buffer).rotate().jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  const metadata = await sharp(normalized).metadata();
  if (Number(metadata.width || 0) < 250 || Number(metadata.height || 0) < 250) {
    throw new Error(`${sku}: imagem ${index + 1} menor que 250 px`);
  }
  return normalized;
}

async function stablePictures(product, apply) {
  if (!Array.isArray(product.imagens) || product.imagens.length === 0) {
    throw new Error(`${product.sku}: produto sem imagem`);
  }
  const pictures = [];
  for (let index = 0; index < product.imagens.length; index += 1) {
    const source = String(product.imagens[index]);
    const normalized = await validateImage(product.sku, source, index);
    if (!apply || source.startsWith(STORAGE_PREFIX)) {
      pictures.push(source);
      continue;
    }
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    const objectPath = `catalog/profitable-shelf/${product.sku}/${index + 1}-${hash}.jpg`;
    const { error } = await supabase.storage.from('product-images').upload(objectPath, normalized, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) throw new Error(`${product.sku}: falha ao salvar imagem ${index + 1}: ${error.message}`);
    const { data } = supabase.storage.from('product-images').getPublicUrl(objectPath);
    await validateImage(product.sku, data.publicUrl, index);
    pictures.push(data.publicUrl);
  }
  return pictures;
}

function preparedAttributes(prepared, config, product) {
  const attrs = (prepared.attributes || []).map((attribute) => {
    const result = { id: String(attribute.id) };
    const categoryAttribute = prepared.categoryAttributes.get(String(attribute.id));
    if (result.id === 'EMPTY_GTIN_REASON' && config.sku === 'VTK012014') {
      result.value_id = '17055159';
      result.value_name = 'O produto é um kit ou pack';
      return result;
    }
    if (categoryAttribute?.value_type === 'number_unit') {
      const match = String(attribute.value_name || '').trim().match(/^(-?\d+(?:[.,]\d+)?)\s*(\S+)$/);
      if (!match) throw new Error(`${config.sku}: medida inválida em ${attribute.id}`);
      result.value_name = `${Number(match[1].replace(',', '.'))} ${match[2]}`;
    } else if (hasText(attribute.value_id)) result.value_id = String(attribute.value_id);
    else if (hasText(attribute.value_name)) result.value_name = String(attribute.value_name);
    return result;
  });
  if (config.sku === 'VTK012014' && !attrs.some((attribute) => attribute.id === 'GTIN')) {
    attrs.push({ id: 'GTIN', value_id: '-1', value_name: null });
  }
  attrs.push({ id: 'SELLER_SKU', value_name: config.sku });
  attrs.push({ id: 'ITEM_CONDITION', value_id: '2230284' });
  const dimensions = [
    ['SELLER_PACKAGE_HEIGHT', product.altura, 'cm'],
    ['SELLER_PACKAGE_WIDTH', product.largura, 'cm'],
    ['SELLER_PACKAGE_LENGTH', product.profundidade, 'cm'],
    ['SELLER_PACKAGE_WEIGHT', Number(product.peso_bruto) * 1000, 'g'],
  ];
  const allowed = prepared.categoryAttributes;
  for (const [id, value, unit] of dimensions) {
    if (allowed.has(id) && Number(value) > 0) attrs.push({ id, value_name: `${Number(value)} ${unit}` });
  }
  return attrs;
}

async function preflightConfig(config, prepared, userId) {
  const { data: product, error } = await supabase.from('produtos')
    .select('id,sku,nome,ativo,estoque,custo,fornecedor,ml_item_id,ml_status,imagens,altura,largura,profundidade,peso_bruto')
    .eq('id', config.produtoId).single();
  if (error || !product) throw new Error(`${config.sku}: produto não encontrado: ${error?.message || ''}`);
  if (product.sku !== config.sku || product.fornecedor !== config.supplier) throw new Error(`${config.sku}: produto ou fornecedor divergente`);
  if (!product.ativo || Number(product.estoque) <= 0) throw new Error(`${config.sku}: produto inativo ou sem estoque`);
  if (hasText(product.ml_item_id) || String(product.ml_status) !== 'sem_anuncio') throw new Error(`${config.sku}: produto já possui anúncio`);
  if (Math.abs(Number(product.custo) - config.expectedCost) > 0.001) throw new Error(`${config.sku}: custo alterado para R$ ${product.custo}`);
  const { data: localAds, error: adsError } = await supabase.from('anuncios_ml')
    .select('ml_item_id,sku,produto_id,status').or(`produto_id.eq.${product.id},sku.eq.${product.sku}`);
  if (adsError) throw new Error(`${config.sku}: falha ao conferir ERP: ${adsError.message}`);
  if ((localAds || []).length > 0) throw new Error(`${config.sku}: já existe vínculo no ERP`);
  const liveIds = await searchLiveSku(userId, config.sku);
  if (liveIds.length > 1) throw new Error(`${config.sku}: mais de um anúncio encontrado (${liveIds.join(', ')})`);
  const existingItemId = liveIds[0] || null;

  const [category, categoryAttributes] = await Promise.all([
    mlRequest(`/categories/${config.categoryId}`),
    mlRequest(`/categories/${config.categoryId}/attributes`),
  ]);
  if (!category.ok || !categoryAttributes.ok) throw new Error(`${config.sku}: categoria indisponível`);
  if (String(category.data?.status || 'enabled') !== 'enabled') throw new Error(`${config.sku}: categoria desativada`);
  const maxLength = Number(category.data?.settings?.max_title_length || 60);
  if (config.familyName.length > maxLength) throw new Error(`${config.sku}: nome SEO ultrapassa ${maxLength} caracteres`);
  const attrMap = new Map((categoryAttributes.data || []).map((attribute) => [String(attribute.id), attribute]));
  for (const attribute of prepared.attributes || []) {
    const live = attrMap.get(String(attribute.id));
    if (!live) throw new Error(`${config.sku}: atributo ${attribute.id} não pertence à categoria`);
    if (hasText(attribute.value_id) && Array.isArray(live.values) && live.values.length > 0 &&
        !live.values.some((value) => String(value.id) === String(attribute.value_id))) {
      throw new Error(`${config.sku}: valor ${attribute.value_id} inválido para ${attribute.id}`);
    }
  }
  const required = (categoryAttributes.data || [])
    .filter((attribute) => attribute.tags?.required || attribute.tags?.catalog_required)
    .map((attribute) => String(attribute.id));
  const supplied = new Set((prepared.attributes || []).map((attribute) => String(attribute.id)));
  const missing = required.filter((id) => !supplied.has(id));
  if (missing.length > 0) throw new Error(`${config.sku}: atributos obrigatórios ausentes: ${missing.join(', ')}`);

  prepared.categoryAttributes = attrMap;
  const price = await settlePrice(config, Number(product.custo));
  if (Math.abs(price.percentageFee - config.expectedFee) > 0.00001) {
    throw new Error(`${config.sku}: tarifa mudou para ${(price.percentageFee * 100).toFixed(2)}%`);
  }
  const pictures = await stablePictures(product, APPLY);
  const attributes = preparedAttributes(prepared, config, product);
  if (existingItemId) {
    const existing = await mlRequest(`/items/${encodeURIComponent(existingItemId)}?include_internal_attributes=true`);
    if (!existing.ok || sellerSku(existing.data) !== config.sku ||
        String(existing.data?.category_id) !== config.categoryId ||
        Math.abs(itemPrice(existing.data) - price.price) >= 0.01 ||
        Number(existing.data?.available_quantity) !== Math.floor(Number(product.estoque)) ||
        !['active', 'paused'].includes(String(existing.data?.status))) {
      throw new Error(`${config.sku}: anúncio existente não corresponde à operação`);
    }
  }
  const conditionalPayload = {
    title: config.familyName,
    category_id: config.categoryId,
    price: price.price,
    currency_id: 'BRL',
    available_quantity: Math.floor(Number(product.estoque)),
    buying_mode: 'buy_it_now',
    condition: 'new',
    listing_type_id: LISTING_TYPE,
    description: { plain_text: config.description },
    attributes,
  };
  const conditional = await mlRequest(`/categories/${config.categoryId}/attributes/conditional`, {
    method: 'POST', body: conditionalPayload,
  });
  if (!conditional.ok) throw new Error(`${config.sku}: validação final recusada: ${errorMessage(conditional)}`);
  const conditionalRequired = (conditional.data?.required_attributes || []).map((attribute) => String(attribute.id || '')).filter(Boolean);
  const hasEmptyGtinReason = attributes.some((attribute) =>
    attribute.id === 'EMPTY_GTIN_REASON' && hasText(attribute.value_id || attribute.value_name));
  const missingConditional = conditionalRequired.filter((id) =>
    !attributes.some((attribute) => attribute.id === id) && !(id === 'GTIN' && hasEmptyGtinReason));
  if (missingConditional.length > 0) throw new Error(`${config.sku}: atributos condicionais ausentes: ${missingConditional.join(', ')}`);

  return { product, price, pictures, attributes, conditionalRequired, existingItemId };
}

async function replacePicturesWithDirectUpload(itemId, sku, sources) {
  const pictureIds = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = await fetch(String(sources[index]), { signal: AbortSignal.timeout(30000) });
    if (!source.ok || !String(source.headers.get('content-type') || '').startsWith('image/')) {
      throw new Error(`${sku}: foto ${index + 1} indisponível para envio direto`);
    }
    const form = new FormData();
    form.append('file', await source.blob(), `${sku}-${index + 1}.jpg`);
    const upload = await fetch('https://api.mercadolibre.com/pictures/items/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getToken()}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const uploadData = await upload.json().catch(() => ({}));
    if (!upload.ok || !uploadData.id) throw new Error(`${sku}: envio direto da foto ${index + 1} falhou (HTTP ${upload.status})`);
    pictureIds.push(String(uploadData.id));
  }
  const update = await mlRequest(`/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT', body: { pictures: pictureIds.map((id) => ({ id })) },
  });
  if (!update.ok) throw new Error(`${sku}: troca das fotos falhou: ${errorMessage(update)}`);
}

async function pictureErrors(item) {
  const failures = [];
  for (const picture of item?.pictures || []) {
    const id = String(picture?.id || '');
    if (!id) continue;
    const result = await mlRequest(`/pictures/${encodeURIComponent(id)}/errors`);
    if (result.status === 404) continue;
    if (!result.ok) throw new Error(`${item.id}: diagnóstico da foto ${id} falhou: ${errorMessage(result)}`);
    const errors = Array.isArray(result.data) ? result.data : result.data?.errors || [];
    if (errors.length > 0) failures.push({ pictureId: id, errors });
  }
  return failures;
}

async function verifyItem(itemId, config, expectedPrice, expectedStock) {
  let last = null;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const [itemResult, descriptionResult] = await Promise.all([
      mlRequest(`/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`),
      mlRequest(`/items/${encodeURIComponent(itemId)}/description`),
    ]);
    if (!itemResult.ok || !descriptionResult.ok) throw new Error(`${config.sku}: conferência do anúncio falhou`);
    const item = itemResult.data;
    const subStatus = Array.isArray(item.sub_status) ? item.sub_status : [];
    const picturesReady = Array.isArray(item.pictures) && item.pictures.length > 0 && item.pictures.every((picture) =>
      hasText(picture.secure_url || picture.url) && !String(picture.secure_url || picture.url).includes('processing-image'));
    last = {
      item,
      descriptionOk: String(descriptionResult.data?.plain_text || '').trim() === config.description.trim(),
      categoryOk: String(item.category_id) === config.categoryId,
      skuOk: sellerSku(item) === config.sku,
      priceOk: Math.abs(itemPrice(item) - expectedPrice) < 0.01,
      stockOk: Number(item.available_quantity) === expectedStock,
      shippingOk: String(item.shipping?.mode || '') === 'me2',
      picturesReady,
    };
    const fatal = item.status === 'closed' || item.status === 'under_review' || subStatus.includes('waiting_for_patch') || subStatus.includes('under_review') ||
      !last.descriptionOk || !last.categoryOk || !last.skuOk || !last.priceOk || !last.stockOk || !last.shippingOk;
    if (fatal) throw new Error(`${config.sku}: anúncio criado com dados divergentes (${item.status}: ${subStatus.join(',')})`);
    if (item.status === 'active' && picturesReady) {
      const diagnostics = await pictureErrors(item);
      if (diagnostics.length > 0) throw new Error(`${config.sku}: fotos recusadas pelo Mercado Livre`);
      return item;
    }
    if (attempt < 18) await sleep(5000);
  }
  throw new Error(`${config.sku}: anúncio não ficou ativo após a criação (${last?.item?.status || 'desconhecido'})`);
}

async function persistErp(config, preflight, item) {
  const timestamp = new Date().toISOString();
  const status = localStatus(item.status);
  const { data: productRows, error: productError } = await supabase.from('produtos').update({
    ml_item_id: item.id,
    ml_status: status,
    ml_fee: preflight.price.percentageFee,
    ml_shipping: config.freight,
    ml_shipping_warning: null,
    custom_price: preflight.price.price,
    imagens: preflight.pictures,
    updated_at: timestamp,
  }).eq('id', config.produtoId).is('ml_item_id', null).select('id,ml_item_id');
  if (productError || productRows?.length !== 1) throw new Error(`${config.sku}: anúncio criado, mas produto não foi vinculado no ERP: ${productError?.message || 'conflito'}`);
  const adPayload = {
    ml_item_id: item.id,
    produto_id: config.produtoId,
    sku: config.sku,
    titulo: item.title || config.familyName,
    thumbnail: item.thumbnail || item.pictures?.[0]?.secure_url || null,
    permalink: item.permalink || null,
    preco_ml: preflight.price.price,
    status,
    tipo: 'premium',
    catalogo: item.catalog_listing === true,
    updated_at: timestamp,
  };
  const { error: adError } = await supabase.from('anuncios_ml').upsert(adPayload, { onConflict: 'ml_item_id' });
  if (adError) throw new Error(`${config.sku}: anúncio criado, mas vínculo de anúncio falhou: ${adError.message}`);
  const [{ data: product }, { data: ads }] = await Promise.all([
    supabase.from('produtos').select('ml_item_id,ml_status,custom_price,ml_fee,ml_shipping').eq('id', config.produtoId).single(),
    supabase.from('anuncios_ml').select('ml_item_id,sku,produto_id,status,preco_ml').eq('ml_item_id', item.id),
  ]);
  if (String(product?.ml_item_id) !== String(item.id) || !(ads || []).some((ad) => ad.sku === config.sku && ad.produto_id === config.produtoId)) {
    throw new Error(`${config.sku}: conferência final do ERP falhou`);
  }
}

async function createOne(config, prepared, userId) {
  const preflight = await preflightConfig(config, prepared, userId);
  const formula = {
    custo: Number(preflight.product.custo),
    frete_estimado: config.freight,
    taxa_ml: preflight.price.percentageFee,
    custo_fixo_ml: preflight.price.fixedFee,
    das: DAS_RATE,
    margem: config.margin,
    preco: preflight.price.price,
  };
  if (!APPLY) return { SKU: config.sku, resultado: 'pronto_para_criar', ItemID: null, formula, fotos: preflight.pictures.length };

  const payload = {
    family_name: config.familyName,
    category_id: config.categoryId,
    price: preflight.price.price,
    currency_id: 'BRL',
    available_quantity: Math.floor(Number(preflight.product.estoque)),
    buying_mode: 'buy_it_now',
    listing_type_id: LISTING_TYPE,
    condition: 'new',
    pictures: preflight.pictures.map((source) => ({ source })),
    attributes: preflight.attributes,
    seller_custom_field: config.sku,
    sale_terms: (prepared.saleTerms || []).map((term) => ({
      id: String(term.id),
      ...(hasText(term.value_id) ? { value_id: String(term.value_id) } : { value_name: String(term.value_name) }),
    })),
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: true },
    channels: ['marketplace'],
  };
  let itemId = preflight.existingItemId;
  if (!itemId) {
    const created = await mlRequest('/items', { method: 'POST', body: payload });
    if (!created.ok || !created.data?.id) throw new Error(`${config.sku}: criação recusada: ${errorMessage(created)}`);
    itemId = String(created.data.id);
    const description = await mlRequest(`/items/${encodeURIComponent(itemId)}/description`, {
      method: 'POST', body: { plain_text: config.description },
    });
    if (!description.ok) throw new Error(`${config.sku}: ${itemId} criado, mas descrição falhou: ${errorMessage(description)}`);
  }
  const current = await mlRequest(`/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`);
  if (!current.ok) throw new Error(`${config.sku}: não foi possível conferir ${itemId}`);
  if ((current.data?.sub_status || []).includes('picture_download_pending')) {
    await replacePicturesWithDirectUpload(itemId, config.sku, preflight.pictures);
  }
  const item = await verifyItem(itemId, config, preflight.price.price, Math.floor(Number(preflight.product.estoque)));
  await persistErp(config, preflight, item);
  return {
    SKU: config.sku,
    ItemID: itemId,
    resultado: 'criado_e_conferido',
    titulo_gerado: item.title,
    familia_seo: config.familyName,
    status: item.status,
    mercado_envios: item.shipping?.mode,
    permalink: item.permalink,
    formula,
  };
}

async function auditAll() {
  const rows = [];
  for (const config of CONFIG) {
    const [{ data: product, error: productError }, { data: ads, error: adsError }] = await Promise.all([
      supabase.from('produtos')
        .select('id,sku,estoque,custo,ml_item_id,ml_status,custom_price,ml_fee,ml_shipping')
        .eq('id', config.produtoId).single(),
      supabase.from('anuncios_ml')
        .select('ml_item_id,sku,produto_id,status,preco_ml')
        .eq('produto_id', config.produtoId),
    ]);
    if (productError || adsError) throw new Error(`${config.sku}: auditoria do ERP falhou`);
    const expected = await settlePrice(config, Number(product.custo));
    const itemId = String(product.ml_item_id || '');
    if (!itemId) {
      rows.push({
        SKU: config.sku,
        ItemID: null,
        resultado: 'bloqueado',
        motivo: 'Mercado Livre exige GTIN; fabricante e fornecedor não informam um código válido',
        preco_calculado: expected.price,
      });
      continue;
    }
    const [itemResult, descriptionResult] = await Promise.all([
      mlRequest(`/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`),
      mlRequest(`/items/${encodeURIComponent(itemId)}/description`),
    ]);
    if (!itemResult.ok || !descriptionResult.ok) throw new Error(`${config.sku}: leitura final do anúncio falhou`);
    const item = itemResult.data;
    const diagnostics = await pictureErrors(item);
    const ad = (ads || []).find((entry) => String(entry.ml_item_id) === itemId);
    const checks = {
      ativo: item.status === 'active' && (item.sub_status || []).length === 0,
      sku: sellerSku(item) === config.sku,
      categoria: String(item.category_id) === config.categoryId,
      preco: Math.abs(itemPrice(item) - expected.price) < 0.01,
      estoque: Number(item.available_quantity) === Number(product.estoque),
      mercado_envios: String(item.shipping?.mode) === 'me2',
      fotos: Array.isArray(item.pictures) && item.pictures.length > 0 && diagnostics.length === 0 &&
        item.pictures.every((picture) => !String(picture.secure_url || picture.url || '').includes('processing-image')),
      descricao: hasText(descriptionResult.data?.plain_text),
      erp_produto: product.ml_status === 'ativo' && Math.abs(Number(product.custom_price) - expected.price) < 0.01,
      erp_anuncio: Boolean(ad && ad.sku === config.sku && ad.status === 'ativo' && Math.abs(Number(ad.preco_ml) - expected.price) < 0.01),
    };
    rows.push({
      SKU: config.sku,
      ItemID: itemId,
      resultado: Object.values(checks).every(Boolean) ? 'ativo_e_conferido' : 'divergente',
      titulo: item.title,
      preco: itemPrice(item),
      estoque: Number(item.available_quantity),
      mercado_envios: item.shipping?.mode,
      link: item.permalink,
      checks,
    });
  }
  const summary = {
    horario: new Date().toISOString(),
    solicitados: CONFIG.length,
    ativos_e_conferidos: rows.filter((row) => row.resultado === 'ativo_e_conferido').length,
    bloqueados: rows.filter((row) => row.resultado === 'bloqueado').length,
    divergentes: rows.filter((row) => row.resultado === 'divergente').length,
    resultados: rows,
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'final-operation.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, 'final-operation.ndjson'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (summary.divergentes > 0) process.exitCode = 1;
}

async function main() {
  if (!fs.existsSync(PREFLIGHT_PATH)) throw new Error('Pré-validação não encontrada');
  const dryRun = JSON.parse(fs.readFileSync(PREFLIGHT_PATH, 'utf8'));
  if (Number(dryRun.selected) !== CONFIG.length || (dryRun.failed || []).length > 0) throw new Error('Pré-validação incompleta');
  const selectedConfig = ONLY_SKU ? CONFIG.filter((config) => config.sku === ONLY_SKU) : CONFIG;
  if (selectedConfig.length === 0) throw new Error(`SKU não configurado: ${ONLY_SKU}`);
  const preparedBySku = new Map((dryRun.created || []).map((entry) => [String(entry.sku), entry]));
  for (const config of selectedConfig) {
    if (!preparedBySku.has(config.sku)) throw new Error(`${config.sku}: dados preparados ausentes`);
  }

  const accountResult = await mlRequest('/users/me');
  if (!accountResult.ok || !accountResult.data?.id) throw new Error(`Conta ML indisponível: ${errorMessage(accountResult)}`);
  const userId = String(accountResult.data.id);
  const tags = new Set(accountResult.data.tags || []);
  if (!tags.has('user_product_seller')) throw new Error('Conta ML sem suporte ao formato User Products');

  if (AUDIT) {
    await auditAll();
    return;
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const logPath = path.join(REPORT_DIR, APPLY ? 'creation-log.ndjson' : 'final-preflight-log.ndjson');
  if (!APPLY || !ONLY_SKU || !fs.existsSync(logPath)) fs.writeFileSync(logPath, '');
  const results = [];
  for (const config of selectedConfig) {
    try {
      const result = await createOne(config, preparedBySku.get(config.sku), userId);
      results.push(result);
      fs.appendFileSync(logPath, `${JSON.stringify({ ...result, horario: new Date().toISOString() })}\n`);
      console.log(JSON.stringify(result));
    } catch (error) {
      const failure = { SKU: config.sku, ItemID: null, resultado: 'falhou', erro: error.message };
      results.push(failure);
      fs.appendFileSync(logPath, `${JSON.stringify({ ...failure, horario: new Date().toISOString() })}\n`);
      console.error(JSON.stringify(failure));
      if (APPLY) break;
    }
  }
  const summary = {
    modo: APPLY ? 'aplicacao' : 'validacao',
    solicitados: selectedConfig.length,
    sucesso: results.filter((row) => row.resultado !== 'falhou').length,
    falhas: results.filter((row) => row.resultado === 'falhou').length,
    resultados: results,
  };
  fs.writeFileSync(path.join(REPORT_DIR, APPLY ? 'creation-summary.json' : 'final-preflight-summary.json'), JSON.stringify(summary, null, 2));
  if (summary.falhas > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ resultado: 'falha_fatal', erro: error.message }));
  process.exitCode = 1;
});
