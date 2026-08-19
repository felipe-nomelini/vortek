const {
  attributeValue,
  normalize,
  normalizeGtin,
  roundMoney,
  sqlLiteral,
} = require('./ml-p0-phase6a');
const { entityHasGtin } = require('./ml-p0-phase6b');

const PASS = (row) => ({ decision: 'PASS', ...row });
const BLOCK = (sku, gtin, decision, reason, sanitation, source) => ({ sku, gtin, decision, reason, sanitation, source });

const ALLOWED = Object.freeze([
  PASS({ sku: 'VTK017508', gtin: '7891112359307', brand: 'Tramontina', modelAliases: [], categoryId: 'MLB244658', domainId: 'MLB-FOOD_STORAGE_CONTAINERS', familyName: 'Potes Tramontina MixColor 2 L Vermelho', critical: { COLOR: ['Vermelho'], VOLUME_CAPACITY: ['2 L'], UNITS_PER_PACKAGE: ['2'] }, source: 'supplier + Tramontina official brand/line', manualAttributes: [{ id: 'BRAND', value_name: 'Tramontina' }, { id: 'GTIN', value_name: '7891112359307' }, { id: 'COLOR', value_id: '51993', value_name: 'Vermelho' }, { id: 'MAIN_COLOR', value_id: '2450307', value_name: 'Vermelho' }, { id: 'VOLUME_CAPACITY', value_name: '2 L' }, { id: 'UNITS_PER_PACKAGE', value_name: '2' }, { id: 'MATERIAL', value_id: '2748302', value_name: 'Plástico' }] }),
  BLOCK('VTK017625', '7898968476226', 'BLOCK_CATEGORY', 'ML domain discovery mapped the Sulton SRX 302 receiver to an incompatible aircraft-radio-control category', 'CATEGORY_FIX_REQUIRED', 'https://sulton.com.br/produto/srx-302/'),
  PASS({ sku: 'VTK017666', gtin: '7898179310913', brand: 'Multitoc', modelAliases: ['Gôndola'], catalogProductId: 'MLB9004870', categoryId: 'MLB1053', familyName: 'Telefone Multitoc Gôndola Grafite', critical: { COLOR: ['Grafite'] }, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK012235', '7897079085068', 'BLOCK_CATALOG_IDENTITY', 'exact-GTIN required catalog exposes MODEL TS-Séria while manufacturer and local identity are TKL80', 'CATALOG_REVIEW_REQUIRED', 'https://www.taschibra.com.br/public/pt_BR/produto/lampadas/led-bulbo/lampada-led-tkl-80-12w-6500k/18506'),
  BLOCK('VTK017384', '7899938509777', 'BLOCK_REQUIRED_ATTRIBUTE_EVIDENCE', 'kit of five Mickey power cords lacks official unit/connector evidence sufficient for the category contract', 'REQUIRED_ATTRIBUTE_REQUIRED', 'DSLite supplier only'),
  PASS({ sku: 'VTK012839', gtin: '7898640361581', brand: 'Wireconex', modelAliases: ['PHBE5'], catalogProductId: 'MLB23846301', categoryId: 'MLB38279', familyName: 'Extensão Wireconex Power Play P10 5 m', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK021012', gtin: '7896637613262', brand: 'Intelbras', modelAliases: ['TC 20', 'TC20'], catalogProductId: 'MLB7991974', categoryId: 'MLB1053', familyName: 'Telefone Intelbras TC 20 Preto', critical: { COLOR: ['Preto'] }, source: 'https://www.intelbras.com/pt-br/telefone-com-fio-tc-20' }),
  BLOCK('VTK017633', '7897013561276', 'BLOCK_IDENTITY', 'Elgin wall-and-vehicle Micro USB kit has supplier evidence only; official kit identity was not located', 'IDENTITY_FIX_REQUIRED', 'DSLite supplier only'),
  PASS({ sku: 'VTK017898', gtin: '7896637677035', brand: 'Intelbras', modelAliases: ['THS 55 USB', 'THS55 USB'], catalogProductId: 'MLB21895542', categoryId: 'MLB1664', familyName: 'Headset Intelbras THS 55 USB', critical: {}, source: 'https://www.intelbras.com/pt-br/headset-mono-usb-ths-55-usb' }),
  PASS({ sku: 'VTK017848', gtin: '7898619565781', brand: 'Telecam', modelAliases: ['10x50'], catalogProductId: 'MLB65825760', categoryId: 'MLB7070', familyName: 'Cabo de Alarme Telecam 10 Vias 100 m', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK026012', gtin: '7898572881102', brand: 'Saty', modelAliases: ['STS100', 'STS-100'], categoryId: 'MLB10233', domainId: 'MLB-SPEAKERS_STANDS', familyName: 'Tripé para Caixa Saty STS-100', critical: {}, source: 'https://saty.com.br/tripes/', manualAttributes: [{ id: 'BRAND', value_name: 'Saty' }, { id: 'MODEL', value_name: 'STS-100' }, { id: 'GTIN', value_name: '7898572881102' }] }),
  PASS({ sku: 'VTK021108', gtin: '7896637637961', brand: 'Intelbras', modelAliases: ['HSB 50', 'HSB-50'], catalogProductId: 'MLB20801741', categoryId: 'MLB454750', familyName: 'Telefone Headset Intelbras HSB 50', critical: {}, source: 'https://www.intelbras.com/pt-br/telefone-headset-hsb-50' }),
  BLOCK('VTK026050', '7908324709056', 'BLOCK_IDENTITY', 'MXT HY-033 crimping plier has no official manufacturer identity located', 'IDENTITY_FIX_REQUIRED', 'DSLite supplier only'),
  PASS({ sku: 'VTK017933', gtin: '7898663560183', brand: 'Ipec', modelAliases: ['A2064'], catalogProductId: 'MLB30220377', categoryId: 'MLB33412', familyName: 'Botão de Pânico Ipec NF', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK005775', '7908638400212', 'BLOCK_IDENTITY', 'Storm DisplayPort 1.2 to USB-C cable lacks primary manufacturer evidence for direction and interface identity', 'IDENTITY_FIX_REQUIRED', 'DSLite supplier only'),
  PASS({ sku: 'VTK017982', gtin: '4891450986039', brand: 'Procalc', modelAliases: ['PC986-P', 'PC986'], catalogProductId: 'MLB33224813', categoryId: 'MLB99957', familyName: 'Calculadora Procalc PC986-P Pink', critical: { COLOR: ['Pink', 'Rosa'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK017944', gtin: '7898127608314', brand: 'Aquário', modelAliases: ['B-2007P', 'Viúva Negra'], categoryId: 'MLB271439', domainId: 'MLB-VEHICLE_ANTENNAS', familyName: 'Antena Aquário PX B-2007P Viúva Negra', critical: {}, source: 'https://downloads.aquario.com.br/Manuais/B-2007-2007P%20ficha%20comercial.pdf', manualAttributes: [{ id: 'BRAND', value_name: 'Aquário' }, { id: 'MODEL', value_name: 'B-2007P' }, { id: 'GTIN', value_name: '7898127608314' }] }),
  PASS({ sku: 'VTK018024', gtin: '7898936319227', brand: 'Viaweb', modelAliases: ['16S'], catalogProductId: 'MLB21742933', categoryId: 'MLB7070', familyName: 'Teclado Viaweb 16S', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK019952', '7896637647571', 'BLOCK_CATALOG_IDENTITY', 'required catalog title represents two extensions while the official TS5121 identity is one additional extension', 'CATALOG_REVIEW_REQUIRED', 'https://www.intelbras.com/pt-br/ramal-sem-fio-digital-ts-5121'),
  BLOCK('VTK000540', '7890000796255', 'BLOCK_IMAGE', 'local product has zero images and the replacement-seat identity cannot use a similar chair image', 'IMAGE_FIX_REQUIRED', 'local baseline'),
  BLOCK('VTK017155', '7898960877915', 'SOURCE_DEFERRED', 'official ASK PNT1 identity/category evidence was not available in the validated source set', 'IDENTITY_FIX_REQUIRED', 'supplier only'),
  BLOCK('VTK025954', '3045384363973', 'BLOCK_GTIN_BRAND_CONFLICT', 'GTIN identifies Rochedo Trendy 6 L while local master brand is ARNO', 'GTIN_FIX_REQUIRED', 'ML catalog MLB67678401'),
  PASS({ sku: 'VTK025859', gtin: '7898554606594', brand: 'Fortrek', modelAliases: ['Vickers'], catalogProductId: 'MLB27356383', categoryId: 'MLB447782', familyName: 'Cadeira Gamer Fortrek Vickers', critical: { COLOR: ['Preto/Vermelho', 'Preto e Vermelho', 'Vermelho'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK025860', gtin: '7898554606617', brand: 'Fortrek', modelAliases: ['Vickers'], catalogProductId: 'MLB27011060', categoryId: 'MLB447782', familyName: 'Cadeira Gamer Fortrek Vickers', critical: { COLOR: ['Preto/Verde', 'Preto e Verde', 'Verde'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK000378', gtin: '4718009159150', brand: 'ThunderX3', modelAliases: ['Yama1'], catalogProductId: 'MLB16097954', categoryId: 'MLB447782', familyName: 'Cadeira Ergonômica ThunderX3 Yama1', critical: { COLOR: ['Preto/Ciano', 'Preto e Ciano', 'Ciano'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK000092', gtin: '7896643412668', brand: 'Multivisão', modelAliases: ['NT-Home'], catalogProductId: 'MLB21693541', categoryId: 'MLB193946', familyName: 'Mesa para Notebook Multivisão NT-Home', critical: { COLOR: ['Preto'] }, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK006567', '3121040090657', 'BLOCK_CATALOG_IDENTITY', 'required catalog exposes a generic MODEL value instead of official/local FMQ identity', 'CATALOG_REVIEW_REQUIRED', 'ML catalog MLB34292485 + Arno product identity'),
  PASS({ sku: 'VTK000568', gtin: '7898554607508', brand: 'Harmonics', modelAliases: ['HSF200-1', 'HSF-200'], catalogProductId: 'MLB28659224', categoryId: 'MLB4469', familyName: 'Microfone Sem Fio Harmonics HSF-200', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK000799', gtin: '4711099476480', brand: 'ThunderX3', modelAliases: ['TGC12'], catalogProductId: 'MLB37849530', categoryId: 'MLB193945', familyName: 'Cadeira Gamer ThunderX3 TGC12 Loft', critical: { COLOR: ['Cinza'] }, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK025955', '7895500767361', 'SOURCE_DEFERRED', 'Arno LQ11 220 V has no exact ML catalog and primary official evidence was not captured in this run', 'IDENTITY_FIX_REQUIRED', 'supplier only'),
  BLOCK('VTK005382', '7898461972614', 'BLOCK_CATALOG_IDENTITY', 'required catalog voltage is 220V while Ventisol manufacturer confirms EXB150 as bivolt 127V/220V', 'CATALOG_REVIEW_REQUIRED', 'https://www.ventisol.com.br/exaustor-de-banheiro-ventisol-150mm-127v220v'),
  PASS({ sku: 'VTK005397', gtin: '7898461972607', brand: 'Ventisol', modelAliases: ['EXB100', 'EXB100 Bivolt'], catalogProductId: 'MLB22548833', categoryId: 'MLB271571', familyName: 'Exaustor Ventisol EXB Premium 100 mm', critical: { VOLTAGE: ['127V/220V', 'Bivolt'] }, source: 'https://www.ventisol.com.br/exaustor/profissional/exaustor-de-banheiro-ventisol-100mm-127v220v' }),
  PASS({ sku: 'VTK001089', gtin: '7890443020962', brand: 'Giannini', modelAliases: ['GB-100', 'GB100'], catalogProductId: 'MLB23013100', categoryId: 'MLB3752', familyName: 'Contrabaixo Giannini GB-100', critical: { COLOR: ['Preto'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK000223', gtin: '4718009154506', brand: 'ThunderX3', modelAliases: ['EC3'], catalogProductId: 'MLB15243051', categoryId: 'MLB447782', familyName: 'Cadeira Gamer ThunderX3 EC3', critical: { COLOR: ['Preto'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK001288', gtin: '7896643440647', brand: 'Multivisão', modelAliases: ['SKY100'], catalogProductId: 'MLB23892377', categoryId: 'MLB11529', familyName: 'Suporte de Teto Multivisão SKY100', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK000504', '7890000795814', 'BLOCK_IMAGE', 'local ThunderX3 Core Sync6 mechanism has zero images', 'IMAGE_FIX_REQUIRED', 'local baseline'),
  BLOCK('VTK001075', '7893137318796', 'BLOCK_GTIN_UNIT_CONFLICT', 'GTIN catalog is a 20-unit CAT6 kit while local product is a 100-unit CAT5e kit', 'GTIN_FIX_REQUIRED', 'ML catalog MLB35868259'),
  BLOCK('VTK011959', '7890000856478', 'BLOCK_GTIN_BRAND_CONFLICT', 'GTIN catalog identifies an Armarinho São José bag strap, not a Fortrek right armrest', 'GTIN_FIX_REQUIRED', 'ML catalog MLB49765180'),
  PASS({ sku: 'VTK000429', gtin: '4044155032673', brand: 'Sennheiser', modelAliases: ['MME 865', 'MME865'], catalogProductId: 'MLB24885316', categoryId: 'MLB4469', familyName: 'Cápsula Sennheiser MME 865', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK011960', '7890000856485', 'SOURCE_DEFERRED', 'Fortrek left-armrest official part identity was not found; side is identity-critical', 'IDENTITY_FIX_REQUIRED', 'supplier only'),
  PASS({ sku: 'VTK003043', gtin: '7898554606532', brand: 'Fortrek', modelAliases: ['Cruiser'], catalogProductId: 'MLB15963092', categoryId: 'MLB447782', familyName: 'Cadeira Gamer Fortrek Cruiser', critical: { COLOR: ['Preto'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK006193', gtin: '7899638111195', brand: 'Hayonik', modelAliases: ['Player'], catalogProductId: 'MLB47135497', categoryId: 'MLB72745', familyName: 'Cabo Hayonik Player P10 5 m', critical: { COLOR: ['Azul'], LENGTH: ['5 m'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK002528', gtin: '7898419490665', brand: 'Proeletronic', modelAliases: ['PROHD2000A', 'PROHD-2000A'], catalogProductId: 'MLB65679273', categoryId: 'MLB44572', familyName: 'Antena Digital Proeletronic PROHD2000A', critical: {}, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK025858', gtin: '7898554606587', brand: 'Fortrek', modelAliases: ['Vickers'], catalogProductId: 'MLB34692956', categoryId: 'MLB447782', familyName: 'Cadeira Gamer Fortrek Vickers', critical: { COLOR: ['Preto'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK025861', gtin: '7898554606624', brand: 'Fortrek', modelAliases: ['Vickers'], catalogProductId: 'MLB28408894', categoryId: 'MLB447782', familyName: 'Cadeira Gamer Fortrek Vickers', critical: { COLOR: ['Preto', 'Preto/Rosa', 'Preto e Rosa'] }, source: 'exact ML catalog GTIN + supplier; catalog title confirms Preto/Rosa' }),
  BLOCK('VTK006318', '7898554609137', 'BLOCK_IMAGE', 'local Fortrek CG633 charger has zero images', 'IMAGE_FIX_REQUIRED', 'local baseline'),
  PASS({ sku: 'VTK002577', gtin: '7898939971323', brand: 'ASK', modelAliases: ['CH10'], catalogProductId: 'MLB27866916', categoryId: 'MLB10233', familyName: 'Suporte para Caixa ASK CH10', critical: { COLOR: ['Preto'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK001155', gtin: '7899278914408', brand: 'Megatron', modelAliases: ['RG59'], catalogProductId: 'MLB29649341', categoryId: 'MLB431815', familyName: 'Cabo Coaxial Megatron RG59 100 m', critical: { CABLE_LENGTH: ['100 m'], LENGTH: ['100 m'] }, source: 'exact ML catalog GTIN + supplier' }),
  PASS({ sku: 'VTK006152', gtin: '7899638111201', brand: 'Hayonik', modelAliases: ['Player'], catalogProductId: 'MLB46998207', categoryId: 'MLB72745', familyName: 'Cabo Hayonik Player P10 5 m', critical: { COLOR: ['Verde'], LENGTH: ['5 m'] }, source: 'exact ML catalog GTIN + supplier' }),
  BLOCK('VTK017783', '7898382148075', 'BLOCK_CATEGORY', 'exact required catalog has no seller offer and domain discovery returned no high-confidence category', 'CATEGORY_FIX_REQUIRED', 'ML catalog MLB26280451'),
]);

function buildManualAttributes(config, categoryAttributes, sku) {
  const allowed = new Set((categoryAttributes || []).map((row) => row.id));
  const byId = new Map((config.manualAttributes || []).filter((row) => allowed.has(row.id)).map((row) => [row.id, row]));
  byId.set('ITEM_CONDITION', { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' });
  byId.set('SELLER_SKU', { id: 'SELLER_SKU', value_name: sku });
  return [...byId.values()];
}

function exactCatalogIdentity(result, config) {
  const fields = {
    catalog_id: result?.id === config.catalogProductId,
    catalog_required: result?.settings?.listing_strategy === 'catalog_required',
    gtin: entityHasGtin(result, config.gtin),
    brand: normalize(attributeValue(result, 'BRAND')) === normalize(config.brand),
    model: !config.modelAliases?.length || config.modelAliases.some((value) => normalize(attributeValue(result, 'MODEL')).includes(normalize(value))),
    title: !config.catalogTitleAliases?.length || config.catalogTitleAliases.every((value) => normalize(result?.name).includes(normalize(value))),
  };
  const critical = {};
  for (const [id, aliases] of Object.entries(config.critical || {})) {
    const actual = normalize(attributeValue(result, id));
    critical[id] = Boolean(actual) && aliases.some((value) => actual.includes(normalize(value)) || normalize(value).includes(actual));
  }
  return { fields, critical, passed: [...Object.values(fields), ...Object.values(critical)].every(Boolean) };
}

function classifyRemoteIdentity(item, expected) {
  const sku = item?.seller_custom_field || attributeValue(item, 'SELLER_SKU');
  const fields = {
    seller: Number(item?.seller_id) === Number(expected.sellerId),
    sku: normalize(sku) === normalize(expected.sku),
    gtin: entityHasGtin(item, expected.gtin),
    brand: normalize(attributeValue(item, 'BRAND')) === normalize(expected.brand),
    model: !expected.modelAliases?.length || expected.modelAliases.some((value) => normalize(attributeValue(item, 'MODEL')).includes(normalize(value))),
    category: item?.category_id === expected.categoryId,
    quantity: Number(item?.available_quantity) === Number(expected.quantity),
    listing_type: item?.listing_type_id === expected.listingTypeId,
    condition: item?.condition === 'new',
    title: !expected.remoteTitleAliases?.length || expected.remoteTitleAliases.every((value) => normalize(item?.title).includes(normalize(value))),
  };
  if (expected.catalogProductId) {
    fields.catalog = item?.catalog_product_id === expected.catalogProductId;
    fields.catalog_listing = item?.catalog_listing === true;
  }
  const critical = {};
  for (const [id, aliases] of Object.entries(expected.critical || {})) {
    const actual = normalize(attributeValue(item, id));
    critical[id] = Boolean(actual) && aliases.some((value) => actual.includes(normalize(value)) || normalize(value).includes(actual));
  }
  return { fields, critical, passed: [...Object.values(fields), ...Object.values(critical)].every(Boolean) };
}

function feeComponents(fee, price) {
  const details = fee?.sale_fee_details || {};
  const percentage = Number(details.percentage_fee ?? details.percentage ?? NaN);
  const fixed = Number(details.fixed_fee ?? details.fixed_cost ?? 0);
  if (Number.isFinite(percentage)) return { rate: percentage > 1 ? percentage / 100 : percentage, fixed: Number.isFinite(fixed) ? fixed : 0, source: 'sale_fee_details' };
  const amount = Number(fee?.sale_fee_amount);
  return { rate: Number.isFinite(amount) && Number(price) > 0 ? amount / Number(price) : NaN, fixed: 0, source: 'derived_from_quote' };
}

function protectivePrice({ cost, shipping, feeRate, fixedFee = 0, taxRate = 0.05, targetMargin, floor = 0 }) {
  const denominator = 1 - Number(feeRate) - Number(taxRate) - Number(targetMargin);
  if (!(denominator > 0.01)) throw new Error('protective_price_denominator_invalid');
  const mathematical = (Number(cost) + Number(shipping) + Number(fixedFee)) / denominator;
  const cents = Math.ceil(Math.max(mathematical, Number(floor)) * 100) / 100;
  return roundMoney(Math.ceil((cents + 0.1) / 10) * 10 - 0.1);
}

function buildPersistenceSql({ product, item }) {
  const listingType = ['gold_pro', 'gold_premium'].includes(item.listing_type_id) ? 'premium' : 'classico';
  const status = item.status === 'active' ? 'ativo' : 'pausado';
  return `
\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('ml-p0:${product.sku}', 0));
create temp table phase6c_result(result text, listing_id uuid, transaction_id bigint) on commit preserve rows;
do $phase6c$
declare v_product public.produtos%rowtype; v_existing public.anuncios_ml%rowtype; v_listing_id uuid; v_count integer; v_updated integer; v_existing_found boolean := false;
begin
  select * into v_product from public.produtos where id=${sqlLiteral(product.id)}::uuid for update;
  if not found or v_product.sku<>${sqlLiteral(product.sku)} or regexp_replace(coalesce(v_product.gtin,''),'^0+','')<>regexp_replace(${sqlLiteral(product.gtin)},'^0+','') then raise exception 'BLOCK_PERSISTENCE:local_identity'; end if;
  perform 1 from public.anuncios_ml where ml_item_id=${sqlLiteral(item.id)} or produto_id=${sqlLiteral(product.id)}::uuid or sku=${sqlLiteral(product.sku)} for update;
  select count(*) into v_count from public.produtos where id<>${sqlLiteral(product.id)}::uuid and ml_item_id=${sqlLiteral(item.id)};
  if v_count>0 then raise exception 'BLOCK_PERSISTENCE:other_product'; end if;
  select * into v_existing from public.anuncios_ml where ml_item_id=${sqlLiteral(item.id)};
  v_existing_found := found;
  if v_product.ml_item_id=${sqlLiteral(item.id)} and v_existing_found and v_existing.produto_id=${sqlLiteral(product.id)}::uuid and v_existing.sku=${sqlLiteral(product.sku)} then
    insert into phase6c_result values('ALREADY_CONSISTENT',v_existing.id,txid_current()); return;
  end if;
  if v_product.ml_item_id is not null or v_existing_found or v_product.ml_status<>'sem_anuncio'::public.ml_status then raise exception 'BLOCK_PERSISTENCE:concurrent_link'; end if;
  insert into public.anuncios_ml(ml_item_id,produto_id,sku,titulo,tipo,preco_ml,vendidos,visitas,status,catalogo,thumbnail,permalink)
  values(${sqlLiteral(item.id)},${sqlLiteral(product.id)}::uuid,${sqlLiteral(product.sku)},${sqlLiteral(item.title)},${sqlLiteral(listingType)},${Number(item.price).toFixed(2)},${Number(item.sold_quantity || 0)},0,${sqlLiteral(status)}::public.ml_status,${item.catalog_listing === true ? 'true' : 'false'},${sqlLiteral(item.pictures?.[0]?.secure_url || item.thumbnail || null)},${sqlLiteral(item.permalink || null)}) returning id into v_listing_id;
  update public.produtos set ml_item_id=${sqlLiteral(item.id)},ml_status=${sqlLiteral(status)}::public.ml_status where id=${sqlLiteral(product.id)}::uuid and ml_item_id is null and ml_status='sem_anuncio'::public.ml_status;
  get diagnostics v_updated=row_count; if v_updated<>1 then raise exception 'BLOCK_PERSISTENCE:conditional_update'; end if;
  insert into phase6c_result values('SAFE_PUBLICATION_PERSIST_SUCCESS',v_listing_id,txid_current());
end $phase6c$;
commit;
select row_to_json(r) from (select * from phase6c_result) r;`;
}

module.exports = { ALLOWED, buildManualAttributes, buildPersistenceSql, classifyRemoteIdentity, exactCatalogIdentity, feeComponents, protectivePrice, normalizeGtin };
