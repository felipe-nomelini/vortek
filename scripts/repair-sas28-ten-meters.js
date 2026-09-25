#!/usr/bin/env node

// Reparo operacional de uma única oferta. Executar --apply, --publish,
// conferir a sincronização de anúncios e então executar --finish.
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local', quiet: true });

const ITEM = 'MLB5200075913';
const PARENT = 'c9458ce6-3c12-4e88-b0d4-a632fd6a26ae';
const COMPONENT = 'f9724d10-4891-435e-8c11-5ec7f9a7baaf';
const OFFER = '41c62058-c080-4727-a848-4aacc63ffb2d';
const SUPPLIER = '133';
const SUPPLIER_PRODUCT = '229965';
const SKU = 'VTK019036';
const TITLE = 'Kit 10 Metros Cabo Multicabo Santo Angelo SAS 28 Vias';
const PARENT_DESCRIPTION = [
  'Kit com 10 metros no total de cabo multicabo Santo Angelo SAS de 28 vias.',
  'Modelo: SAS; 28 vias; condutor: 0,20 mm²; isolamento: polietileno;',
  'blindagem: fita de alumínio e fio de cobre de dreno 0,20 mm²; cobertura: PVC flexível.',
  'Conteúdo da embalagem: 10 metros no total.',
].join(' ');
const COMPONENT_DESCRIPTION = [
  'Cabo multicabo Santo Angelo SAS de 28 vias, vendido por metro.',
  'Modelo: SAS; 28 vias; Apresentação: Unidade; Unidade de medida: metro;',
  'condutor: 0,20 mm²; isolamento: polietileno; blindagem: fita de alumínio',
  'e fio de cobre de dreno 0,20 mm²; cobertura: PVC flexível.',
].join(' ');
const REMOTE_DESCRIPTION = [
  'Kit de cabo multicabo Santo Angelo SAS, 28 vias.',
  'Comprimento total: 10 metros. Modelo: SAS.',
  'Condutor: 0,20 mm². Isolamento: polietileno.',
  'Blindagem: fita de alumínio e fio de cobre de dreno 0,20 mm².',
  'Cobertura: PVC flexível.',
].join('\n');

const mode = process.argv[2] || '--inspect';
if (!['--inspect', '--apply', '--publish', '--finish'].includes(mode)) {
  throw new Error('Use --inspect, --apply, --publish ou --finish');
}
const url = process.env.SUPABASE_SERVICE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || new URL(url).hostname !== '192.168.1.162') {
  throw new Error('Destino não comprovado como Supabase Bentevi .162');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function assert(value, message) { if (!value) throw new Error(message); }
async function one(table, column, value) {
  const result = await db.from(table).select('*').eq(column, value).maybeSingle();
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data;
}
async function rows(table, column, value, select = '*') {
  const result = await db.from(table).select(select).eq(column, value);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data || [];
}
async function write(table, operation, payload, column, value) {
  const query = operation === 'insert' ? db.from(table).insert(payload)
    : db.from(table).update(payload).eq(column, value);
  const result = await query.select('*');
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  assert(result.data?.length === 1, `${table}: alteração não afetou uma linha`);
  return result.data[0];
}
async function mlToken() {
  const integration = await one('integracoes', 'tipo', 'mercadolivre');
  assert(integration?.conectado && integration.access_token, 'Mercado Livre desconectado');
  assert(Date.parse(integration.token_expires_at) > Date.now() + 60000, 'Token ML expirado ou perto de expirar');
  return integration.access_token;
}
async function ml(path, token, method = 'GET', body) {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ML ${method} ${path}: HTTP ${response.status} ${JSON.stringify(result).slice(0, 700)}`);
  return result;
}
async function item(token) { return ml(`/items/${ITEM}?include_attributes=all`, token); }
function attr(itemValue, id) { return itemValue.attributes?.find(row => row.id === id)?.value_name; }
function assertSellerItem(itemValue) {
  assert(String(itemValue.seller_id) === '3294514937', 'Conta ML inesperada');
  assert(itemValue.seller_custom_field === SKU || attr(itemValue, 'SELLER_SKU') === SKU, 'SKU ML inesperado');
  assert(Number(itemValue.sold_quantity) === 0, 'Venda encontrada; tratar conforme apresentação vigente');
  assert(Number(itemValue.price) === 982.52, 'Preço ML mudou; interrompido');
}
async function acquire(domain, token) {
  const result = await db.rpc('acquire_sync_domain_lock', {
    p_domain: domain, p_owner_task: 'repair_sas28_ten_meters', p_owner_token: token,
    p_owner_job_id: null, p_ttl_seconds: 600, p_metadata: { item: ITEM },
  });
  if (result.error || result.data !== true) throw new Error(`Lock ${domain} indisponível: ${result.error?.message || 'ocupado'}`);
}
async function release(domain, token) {
  const result = await db.rpc('release_sync_domain_lock', { p_domain: domain, p_owner_token: token, p_force: false });
  if (result.error) throw new Error(`Falha ao liberar lock ${domain}: ${result.error.message}`);
}
function backup(value) {
  process.umask(0o077);
  const path = `/tmp/bentevi-sas28-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(`Backup local: ${path}`);
}
async function state(token) {
  const [parent, component, offer, kit, composition, listing, block, snapshot, skuOrders, itemOrders, remote, description] = await Promise.all([
    one('produtos', 'id', PARENT), one('produtos', 'id', COMPONENT), one('produto_fornecedor_ofertas', 'id', OFFER),
    one('produto_kits', 'produto_id', PARENT), rows('produto_kit_componentes', 'kit_produto_id', PARENT),
    one('anuncios_ml', 'ml_item_id', ITEM), one('ml_manual_blocklist', 'ml_item_id', ITEM),
    one('catalogo_ml_snapshot', 'ml_item_id', ITEM),
    rows('pedido_itens', 'seller_sku', SKU, 'id,seller_sku,pedido_id'),
    rows('pedido_itens', 'ml_item_id', ITEM, 'id,ml_item_id,pedido_id'),
    item(token), ml(`/items/${ITEM}/description`, token),
  ]);
  const orders = [...new Map([...skuOrders, ...itemOrders].map(row => [row.id, row])).values()];
  return { parent, component, offer, kit, composition, listing, block, snapshot, orders, remote, description };
}
function assertOriginal(s) {
  assert(s.parent?.sku === SKU && s.parent.ml_item_id === ITEM, 'Produto pai inesperado');
  assert(!s.component && !s.kit && s.composition.length === 0, 'Kit ou componente já existe');
  assert(s.offer?.produto_id === PARENT && s.offer.dslite_fornecedor_id === SUPPLIER
    && s.offer.dslite_produto_id === SUPPLIER_PRODUCT && s.offer.ativo, 'Oferta inesperada');
  assert(s.listing?.produto_id === PARENT && Number(s.listing.preco_ml) === 982.52, 'Vínculo ou preço local inesperado');
  assert(s.orders.length === 0, 'Pedido local encontrado');
  assertSellerItem(s.remote);
  assert(['active', 'paused'].includes(s.remote.status), 'Status ML inesperado');
  if (s.remote.status === 'paused') {
    assert(s.listing.status === 'pausado' && s.parent.ml_status === 'pausado',
      'Pausa parcial não corresponde ao reparo');
  }
}
async function nextSku() {
  const result = await db.from('produtos').select('sku').like('sku', 'VTK%').order('sku', { ascending: false }).limit(1000);
  if (result.error) throw new Error(`SKU: ${result.error.message}`);
  const max = Math.max(0, ...(result.data || []).map(row => Number(/^VTK(\d{6})$/.exec(row.sku)?.[1] || 0)));
  assert(max < 999999, 'Faixa VTK esgotada');
  return `VTK${String(max + 1).padStart(6, '0')}`;
}
async function apply() {
  const token = await mlToken();
  const before = await state(token);
  assertOriginal(before);
  console.log(`Preflight: ${SKU}, ML sem vendas, oferta ${SUPPLIER}/${SUPPLIER_PRODUCT}, preço R$ 982,52`);
  if (mode === '--inspect') return;
  backup(before);
  const owner = `repair-sas28:${randomUUID()}`;
  const domains = ['produtos:dslite_catalogo', 'produtos:dslite_preco'];
  const acquired = [];
  try {
    for (const domain of domains) { await acquire(domain, owner); acquired.push(domain); }
    if (before.remote.status === 'active') await ml(`/items/${ITEM}`, token, 'PUT', { status: 'paused' });
    const paused = await item(token);
    assert(paused.status === 'paused', 'Pausa ML não confirmada');
    assertSellerItem(paused);
    if (before.remote.status === 'active') {
      await write('anuncios_ml', 'update', { status: 'pausado' }, 'ml_item_id', ITEM);
      await write('produtos', 'update', { ml_status: 'pausado' }, 'id', PARENT);
    }

    const childSku = await nextSku();
    const parent = before.parent;
    // A identidade DSLite é única em produtos; liberá-la no pai antes do INSERT.
    await write('produtos', 'update', {
      nome: TITLE, descricao: PARENT_DESCRIPTION, gtin: '',
      estoque: Math.floor(Number(before.offer.estoque) / 10),
      custo: Math.round(Number(before.offer.custo) * 1000) / 100,
      dslite_fornecedor_id: null, dslite_produto_id: null,
      dslite_ultima_sync: null, oferta_preferencial_id: null,
    }, 'id', PARENT);
    const child = {
      id: COMPONENT, sku: childSku, nome: 'Cabo Multicabo Santo Angelo SAS 28 Vias - metro',
      descricao: COMPONENT_DESCRIPTION, marca: parent.marca, gtin: parent.gtin,
      estoque: Number(before.offer.estoque), custo: Number(before.offer.custo),
      ml_fee: parent.ml_fee, peso_liq: parent.peso_liq, peso_bruto: parent.peso_bruto,
      largura: parent.largura, altura: parent.altura, profundidade: parent.profundidade,
      imagens: parent.imagens, categoria: parent.categoria, ncm: parent.ncm, cest: parent.cest,
      origem_fiscal: parent.origem_fiscal, origem_uf: parent.origem_uf, fornecedor: parent.fornecedor,
      dslite_fornecedor_id: SUPPLIER, dslite_produto_id: SUPPLIER_PRODUCT,
      dslite_ultima_sync: parent.dslite_ultima_sync, ativo: true,
    };
    await write('produtos', 'insert', child);
    await write('produto_fornecedor_ofertas', 'update', { produto_id: COMPONENT }, 'id', OFFER);
    await write('produtos', 'update', { oferta_preferencial_id: OFFER }, 'id', COMPONENT);
    await write('produto_kits', 'insert', { produto_id: PARENT, fornecedor_dslite_id: SUPPLIER,
      sku_origem: SUPPLIER_PRODUCT, ativo: true });
    await write('produto_kit_componentes', 'insert', { kit_produto_id: PARENT,
      componente_produto_id: COMPONENT, quantidade: 10 });

    console.log(`Cadastro corrigido. Componente ${childSku}; anúncio pausado. Execute --publish.`);
  } finally {
    for (const domain of acquired.reverse()) await release(domain, owner);
  }
}
function assertDbRepaired(s) {
  assert(s.parent?.sku === SKU && s.parent.ml_item_id === ITEM && s.parent.gtin === ''
    && Number(s.parent.custom_price) === 982.52, 'Pai ou preço de referência incorreto');
  assert(s.parent.nome === TITLE && s.parent.descricao === PARENT_DESCRIPTION, 'Descrição local incorreta');
  assert(s.parent.dslite_fornecedor_id === null && s.parent.dslite_produto_id === null
    && s.parent.oferta_preferencial_id === null, 'Pai ainda vinculado à oferta unitária');
  assert(s.component?.id === COMPONENT && s.component.gtin === '7899028808070'
    && s.component.dslite_produto_id === SUPPLIER_PRODUCT && !s.component.ml_item_id, 'Componente incorreto');
  assert(s.offer?.produto_id === COMPONENT && s.kit?.fornecedor_dslite_id === SUPPLIER
    && s.kit?.sku_origem === SUPPLIER_PRODUCT && s.kit?.ativo === true, 'Origem do kit incorreta');
  assert(s.composition.length === 1 && s.composition[0].componente_produto_id === COMPONENT
    && s.composition[0].quantidade === 10, 'Composição incorreta');
  assert(Number(s.component.estoque) === Number(s.offer.estoque)
    && Number(s.parent.estoque) === Math.floor(Number(s.offer.estoque) / 10)
    && Number(s.parent.custo) === Math.round(Number(s.offer.custo) * 1000) / 100, 'Estoque/custo incorretos');
  assert(s.orders.length === 0, 'Pedido local encontrado');
  assert(s.listing?.produto_id === PARENT && Number(s.listing.preco_ml) === 982.52, 'Vínculo/preço local incorreto');
}
function assertRepaired(s) {
  assertDbRepaired(s);
  assertSellerItem(s.remote);
  assert(s.remote.status === 'paused' && s.remote.title === TITLE && s.remote.family_name === TITLE
    && Number(s.remote.available_quantity) === Number(s.parent.estoque)
    && attr(s.remote, 'CABLE_LENGTH') === '10 m'
    && attr(s.remote, 'SALE_FORMAT') === 'Kit'
    && attr(s.remote, 'UNITS_PER_PACK') === '10'
    && attr(s.remote, 'MODEL') === 'SAS', 'Anúncio ML incorreto');
  assert(s.description.plain_text === REMOTE_DESCRIPTION, 'Descrição ML incorreta');
}
async function publish() {
  const token = await mlToken();
  const before = await state(token);
  assertDbRepaired(before);
  assertSellerItem(before.remote);
  assert(before.remote.status === 'paused' && before.remote.sub_status?.includes('paused_by_seller'),
    'Anúncio não está pausado pelo vendedor');
  const up = String(before.remote.user_product_id || '');
  const familyId = String(before.remote.family_id || '');
  assert(up === 'MLBU5137977550' && familyId === '8478358628789842', 'Família ML inesperada');
  const family = await ml(`/user-products-families/${familyId}`, token);
  assert(family.user_id === 3294514937 && family.family_id === Number(familyId), 'Família de outro vendedor');
  const variants = await ml(`/user-products-families/${familyId}/user-products`, token);
  assert(variants.user_products_ids?.length === 1 && variants.user_products_ids[0] === up,
    'Mudança da família afetaria outra variante; interrompido');
  const linked = await ml(`/users/3294514937/items/search?user_product_id=${encodeURIComponent(up)}`, token);
  assert(linked.paging?.total === 1 && linked.results?.[0] === ITEM,
    'family_name afetaria outro anúncio; interrompido');
  backup(before);
  if (family.family_name !== TITLE) {
    await ml(`/user-products-families/${familyId}`, token, 'PUT', { family_name: TITLE });
  }
  const current = await item(token);
  if (attr(current, 'CABLE_LENGTH') !== '10 m' || Number(current.available_quantity) !== Number(before.parent.estoque)) {
    await ml(`/items/${ITEM}`, token, 'PUT', {
      available_quantity: Number(before.parent.estoque),
      attributes: [{ id: 'CABLE_LENGTH', value_name: '10 m' }],
    });
  }
  if (before.description.plain_text !== REMOTE_DESCRIPTION) {
    await ml(`/items/${ITEM}/description?api_version=2`, token, 'PUT', { plain_text: REMOTE_DESCRIPTION });
  }
  const after = await state(token);
  assertDbRepaired(after);
  const updatedFamily = await ml(`/user-products-families/${familyId}`, token);
  assert(updatedFamily.family_name === TITLE, 'family_name ainda não atualizado');
  if (after.remote.title !== TITLE || after.remote.family_name !== TITLE) {
    console.log('family_name atualizado; título ainda em propagação no Mercado Livre. Reexecute --publish após sincronizar.');
    return;
  }
  await write('anuncios_ml', 'update', { titulo: TITLE, status: 'pausado' }, 'ml_item_id', ITEM);
  assertRepaired(await state(token));
  console.log(`Anúncio corrigido e pausado: ${TITLE}; ${after.remote.available_quantity} kits a R$ ${after.remote.price}.`);
}
async function finish() {
  const token = await mlToken();
  const s = await state(token);
  assertRepaired(s);
  assert(!s.block?.ativo, 'Bloqueio de identidade ainda ativo; aguarde revalidação do sincronizador');
  assert(s.snapshot?.produto_id === PARENT && s.snapshot?.sku_local === SKU,
    'Sincronizador ainda não revalidou o vínculo');
  await ml(`/items/${ITEM}`, token, 'PUT', { status: 'active' });
  const active = await item(token);
  assert(active.status === 'active', 'Reativação ML não confirmada');
  assertSellerItem(active);
  await write('anuncios_ml', 'update', { status: 'ativo' }, 'ml_item_id', ITEM);
  await write('produtos', 'update', { ml_status: 'ativo' }, 'id', PARENT);
  console.log(`Anúncio ${ITEM} reativado com ${active.available_quantity} kits a R$ ${active.price}.`);
}

(mode === '--finish' ? finish() : mode === '--publish' ? publish() : apply()).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
