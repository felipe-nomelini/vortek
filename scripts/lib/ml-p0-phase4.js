const crypto = require('crypto');

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function plain(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeGtin(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return [8, 12, 13, 14].includes(digits.length) ? digits : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function buildCanaryTitle() {
  return 'Carregador Toshiba TNHC-6GAE4 CB Com 4 Pilhas AA 2600mAh';
}

function buildCanaryDescription() {
  return [
    'CARREGADOR TOSHIBA TNHC-6GAE4 CB COM 4 PILHAS AA',
    '',
    'Kit para recarga de pilhas AA e AAA recarregáveis. O carregador aceita até quatro pilhas simultaneamente e acompanha quatro pilhas Toshiba AA Ni-MH de 2600 mAh.',
    '',
    'CARACTERÍSTICAS',
    '• Marca: Toshiba',
    '• Modelo do conjunto: TNHC-6GAE4 CB',
    '• Alimentação: bivolt automático, entrada AC de 100 a 240 V, 50/60 Hz',
    '• Potência de entrada indicada no produto: 6 W',
    '• Formatos compatíveis: pilhas recarregáveis AA e AAA',
    '• Composição das pilhas inclusas: Ni-MH',
    '• Capacidade das pilhas inclusas: 2600 mAh',
    '• Quantidade de posições de carga: 4',
    '• Indicador por LED para estados de carregamento',
    '',
    'TEMPO DE CARGA INFORMADO PELO FABRICANTE',
    '• AA Ni-MH 2600 mAh: aproximadamente 7 horas',
    '• AAA Ni-MH 950 mAh: aproximadamente 6,5 horas',
    '',
    'CONTEÚDO DA EMBALAGEM',
    '• 1 carregador AC Toshiba',
    '• 4 pilhas recarregáveis AA Toshiba 2600 mAh',
    '• 1 manual',
    '',
    'INFORMAÇÕES IMPORTANTES',
    '• Não carrega baterias de 9 V.',
    '• Utilize somente pilhas recarregáveis compatíveis com os formatos AA ou AAA.',
    '• Confira as orientações do manual antes do primeiro uso.',
    '',
    'SKU: VTK000486',
  ].join('\n');
}

function buildCanaryAttributes() {
  return [
    { id: 'BRAND', value_name: 'Toshiba', evidence_key: 'brand' },
    { id: 'MODEL', value_name: 'TNHC-6GAE4 CB', evidence_key: 'model' },
    { id: 'PRODUCT_TYPE', value_id: '28280064', value_name: 'Pilha', evidence_key: 'product_type' },
    { id: 'CONNECTOR_TYPE', value_id: '24420060', value_name: 'Plug', evidence_key: 'connector_type' },
    { id: 'GTIN', value_name: '4904530109270', evidence_key: 'gtin' },
    { id: 'INPUT_VOLTAGE', value_id: '39205163', value_name: '127/220V', evidence_key: 'input_voltage' },
    { id: 'DETAILED_MODEL', value_name: 'TNHC-6GAE4 CB', evidence_key: 'model' },
    { id: 'SUPPORTED_BATTERY_SIZE', value_name: 'AA, AAA', evidence_key: 'supported_sizes' },
    { id: 'SUPPORTED_BATTERY_COMPOSITION', value_id: '2516404', value_name: 'Ni-Mh', evidence_key: 'composition' },
    { id: 'WITH_CHARGE_INDICATOR', value_id: '242085', value_name: 'Sim', evidence_key: 'charge_indicator' },
    { id: 'INCLUDES_CELL_BATTERIES', value_id: '242085', value_name: 'Sim', evidence_key: 'included_batteries' },
    { id: 'CHARGING_PORTS_NUMBER', value_name: '4', evidence_key: 'charging_ports' },
    { id: 'BATTERIES_CHARGE_CAPACITY', value_name: '2600 mAh', evidence_key: 'included_capacity' },
    { id: 'MANUFACTURER', value_name: 'Toshiba', evidence_key: 'manufacturer' },
    { id: 'MPN', value_name: 'TNHC-6GAE4 CB', evidence_key: 'model' },
    { id: 'SELLER_SKU', value_name: 'VTK000486', evidence_key: 'sku' },
    { id: 'SELLER_PACKAGE_WIDTH', value_name: '13 cm', evidence_key: 'package_width' },
    { id: 'SELLER_PACKAGE_LENGTH', value_name: '12 cm', evidence_key: 'package_length' },
    { id: 'SELLER_PACKAGE_HEIGHT', value_name: '17 cm', evidence_key: 'package_height' },
    { id: 'SELLER_PACKAGE_WEIGHT', value_name: '262 g', evidence_key: 'package_weight' },
  ];
}

function publicAttributes(attributes) {
  return attributes.map(({ evidence_key, ...attribute }) => attribute);
}

function extractRemoteIdentity(item) {
  const attributes = Array.isArray(item?.attributes) ? item.attributes : [];
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  const values = (id) => attributes
    .filter((attribute) => String(attribute?.id || '').toUpperCase() === id)
    .flatMap((attribute) => attribute?.values || [attribute])
    .map((attribute) => text(attribute?.value_name || attribute?.name || attribute?.value_id || attribute?.id))
    .filter(Boolean);
  const sellerSkus = [item?.seller_sku, item?.seller_custom_field, ...values('SELLER_SKU')];
  const gtins = values('GTIN').map(normalizeGtin).filter(Boolean);
  for (const variation of variations) {
    sellerSkus.push(variation?.seller_custom_field);
    for (const attribute of variation?.attributes || []) {
      if (String(attribute?.id || '').toUpperCase() === 'SELLER_SKU') sellerSkus.push(attribute?.value_name);
      if (String(attribute?.id || '').toUpperCase() === 'GTIN') gtins.push(normalizeGtin(attribute?.value_name));
    }
  }
  return {
    seller_skus: [...new Set(sellerSkus.map(text).filter(Boolean))],
    gtins: [...new Set(gtins)],
    brand: text(values('BRAND')[0]),
    model: text(values('MODEL')[0] || values('DETAILED_MODEL')[0]),
    catalog_product_id: text(item?.catalog_product_id),
    user_product_id: text(item?.user_product_id),
  };
}

function classifyRemoteItem(item, expected) {
  const identity = extractRemoteIdentity(item);
  const expectedSku = text(expected.sku).toUpperCase();
  const expectedGtin = normalizeGtin(expected.gtin);
  const expectedModel = plain(expected.model);
  const expectedBrand = plain(expected.brand);
  const title = plain(item?.title);
  const skuMatch = identity.seller_skus.some((value) => value.toUpperCase() === expectedSku);
  const gtinMatch = identity.gtins.includes(expectedGtin);
  const catalogMatch = Boolean(expected.catalog_product_id)
    && identity.catalog_product_id === expected.catalog_product_id;
  const modelMatch = Boolean(expectedModel)
    && (plain(identity.model).includes(expectedModel) || title.includes(expectedModel));
  const brandMatch = Boolean(expectedBrand)
    && (plain(identity.brand).includes(expectedBrand) || title.includes(expectedBrand));

  let match_type = 'NOT_MATCH';
  let confidence = 0;
  if (skuMatch && (gtinMatch || modelMatch)) {
    match_type = 'EXACT_MATCH';
    confidence = 100;
  } else if (gtinMatch) {
    match_type = 'EXACT_GTIN_MATCH';
    confidence = 100;
  } else if (catalogMatch && modelMatch) {
    match_type = 'CATALOG_MATCH';
    confidence = 98;
  } else if (modelMatch && brandMatch) {
    match_type = 'STRONG_TITLE_MODEL_MATCH';
    confidence = 95;
  } else if (skuMatch || catalogMatch || modelMatch) {
    match_type = 'POSSIBLE_MATCH';
    confidence = skuMatch ? 90 : catalogMatch ? 85 : 70;
  }
  return { match_type, confidence, identity, signals: { sku_match: skuMatch, gtin_match: gtinMatch, catalog_match: catalogMatch, model_match: modelMatch, brand_match: brandMatch } };
}

function comparePhase3(current, baseline) {
  const checks = [
    ['produto_id', current.product.id, baseline.produto_id],
    ['sku', current.product.sku, baseline.sku],
    ['gtin', normalizeGtin(current.product.gtin), normalizeGtin(baseline.gtin)],
    ['estoque', Number(current.product.estoque), Number(baseline.stock)],
    ['custo', Number(current.offer.custo), Number(baseline.pricing?.cost)],
    ['oferta_preferencial_id', current.product.oferta_preferencial_id, baseline.offer_id],
    ['ml_item_id', text(current.product.ml_item_id), ''],
    ['ml_status', current.product.ml_status, 'sem_anuncio'],
    ['produto_ativo', Boolean(current.product.ativo), true],
    ['oferta_ativa', Boolean(current.offer.ativo), true],
  ].map(([field, live, expected]) => ({ field, live, expected, match: live === expected }));
  return { has_drift: checks.some((check) => !check.match), checks };
}

function validateGeneratedTitle(title) {
  const normalized = plain(title);
  const required = {
    brand_toshiba: normalized.includes('toshiba'),
    model_tnhc_6gae4_cb: normalized.includes('tnhc-6gae4 cb'),
    charger: normalized.includes('carregador'),
    cell_batteries: normalized.includes('pilha'),
  };
  const quantityValues = [...normalized.matchAll(/\b(\d+)\s*pilhas?\b/g)].map((match) => Number(match[1]));
  const capacityValues = [...normalized.matchAll(/\b(\d+)\s*mah\b/g)].map((match) => Number(match[1]));
  const hasBivolt = normalized.includes('bivolt') || normalized.includes('127/220v')
    || (normalized.includes('127v') && normalized.includes('220v'));
  const hasSingleVoltage = (normalized.includes('127v') || normalized.includes('220v')) && !hasBivolt;
  const conflicts = {
    wrong_quantity: quantityValues.some((value) => value !== 4),
    wrong_capacity: capacityValues.some((value) => value !== 2600),
    wrong_voltage: hasSingleVoltage,
    wrong_product_type: normalized.includes('bateria') && !normalized.includes('carregador'),
  };
  return {
    title,
    required,
    observed_quantities: quantityValues,
    observed_capacities_mah: capacityValues,
    conflicts,
    valid: Object.values(required).every(Boolean) && !Object.values(conflicts).some(Boolean),
  };
}

module.exports = {
  buildCanaryAttributes,
  buildCanaryDescription,
  buildCanaryTitle,
  classifyRemoteItem,
  comparePhase3,
  extractRemoteIdentity,
  normalizeGtin,
  plain,
  publicAttributes,
  sha256,
  text,
  validateGeneratedTitle,
};
