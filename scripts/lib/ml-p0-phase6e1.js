'use strict';

const crypto = require('crypto');
const { attributeValue, normalize, normalizeGtin } = require('./ml-p0-phase6a');
const { identityAssessment, parseCsv } = require('./ml-p0-phase6e');

const EXPECTED_SELECTION_SHA256 = 'e6efdcfb027a6eb117472e589ed4683a15b5d5d03019dcc96cf4b024b34558a6';
const TERMINAL_STATES = new Set([
  'SEMANTIC_CATEGORY_READY', 'SEMANTIC_CATEGORY_REVIEW_REQUIRED',
  'BLOCK_SEMANTIC_CATEGORY_MISMATCH', 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND',
  'BLOCK_GTIN_BRAND_CONFLICT', 'BLOCK_GTIN_MODEL_CONFLICT',
  'BLOCK_GTIN_UNIT_CONFLICT', 'BLOCK_IDENTITY', 'BLOCK_CATEGORY',
  'BLOCK_CATALOG_IDENTITY', 'SOURCE_DEFERRED',
  'KNOWN_WRONG_CATEGORY_REMOTE_ITEM', 'EXCLUDED_PENDING_INCIDENT',
  'BLOCK_LOCAL_STATE', 'BLOCK_REMOTE_DUPLICATE',
]);

const PROFILES = [
  profile('professional_speaker_driver', /alto[ -]?falante|woofer|subwoofer/i, 'audio_reproduction', 'professional_audio', 'speaker_driver',
    ['altofalante', 'woofer', 'subwoofer', 'audio', 'somprofissional'], ['tablet', 'celular', 'notebook', 'computador', 'internal_speaker']),
  profile('mouse', /\bmouse\b/i, 'computer_pointing_input', 'computing', 'computer_mouse',
    ['mouse', 'informatica', 'computador'], ['cozinha', 'automotivo', 'instrumentomusical']),
  profile('room_fan', /\bventilador\b/i, 'air_circulation', 'home_appliance', 'electric_fan',
    ['ventilador', 'climatizacao', 'eletrodomestico'], ['coolercomputador', 'automotivo', 'instrumentomusical']),
  profile('guitar_strings', /encordoamento.*guitarra|cordas?.*guitarra/i, 'produce_instrument_sound', 'musical_instrument', 'string_set',
    ['corda', 'guitarra', 'instrumentomusical'], ['caboeletrico', 'automotivo', 'cozinha']),
  profile('electric_guitar', /^(?!.*suporte).*\bguitarra\b/i, 'musical_performance', 'musical_instrument', 'electric_guitar',
    ['guitarra', 'instrumentomusical'], ['brinquedo', 'decoracao', 'videogame']),
  profile('instrument_support', /suporte.*(?:instrumento|guitarra|violao|baixo|teclado)/i, 'support_musical_instrument', 'musical_instrument', 'instrument_stand',
    ['suporte', 'instrumentomusical', 'guitarra', 'violao', 'teclado'], ['televisao', 'tv', 'celular', 'tablet']),
  profile('tv_support', /suporte.*(?:tv|televis)/i, 'support_television', 'home_electronics', 'tv_mount',
    ['suporte', 'televisao', 'tv'], ['instrumentomusical', 'microfone', 'celular']),
  profile('microphone_support', /suporte.*microfone/i, 'support_microphone', 'professional_audio', 'microphone_stand',
    ['suporte', 'microfone', 'audio'], ['televisao', 'celular', 'tablet']),
  profile('speaker_support', /suporte.*(?:caixa|som|acustica)/i, 'support_speaker', 'professional_audio', 'speaker_mount',
    ['suporte', 'caixaacustica', 'altofalante', 'audio'], ['televisao', 'celular', 'tablet']),
  profile('phone_support', /suporte.*celular/i, 'support_phone', 'mobile_accessory', 'phone_mount',
    ['suporte', 'celular', 'smartphone'], ['instrumentomusical', 'televisao', 'caixaacustica']),
  profile('parking_sensor', /sensor.*(?:estacion|automot)/i, 'detect_vehicle_obstacle', 'automotive', 'parking_sensor',
    ['sensor', 'estacionamento', 'automotivo', 'veiculo'], ['alarmeresidencial', 'temperatura', 'presenca']),
  profile('alarm_sensor', /sensor.*(?:alarme|presenca|pet|infravermelho)/i, 'detect_security_event', 'electronic_security', 'alarm_sensor',
    ['sensor', 'alarme', 'seguranca', 'presenca'], ['estacionamento', 'automotivo', 'temperatura']),
  profile('temperature_sensor', /sensor.*temperatura/i, 'measure_temperature', 'measurement', 'temperature_sensor',
    ['sensor', 'temperatura', 'termometro'], ['alarme', 'estacionamento']),
  profile('inductive_security_loop', /la[cç]o indutivo/i, 'detect_metal_vehicle_presence', 'electronic_security', 'inductive_loop',
    ['lacoindutivo', 'detector', 'seguranca', 'controledeacesso', 'alarme'], ['equitacao', 'cavalo', 'corda', 'lacos']),
  profile('alarm_module', /modulo.*(?:alarme|gprs|viaweb|seguranca)/i, 'control_security_system', 'electronic_security', 'security_module',
    ['modulo', 'alarme', 'seguranca', 'gprs'], ['amplificadorautomotivo', 'vidroeletrico']),
  profile('vehicle_window_controller', /kit conforto.*(?:fiat|tury)|mod.*vidro|vidro eletrico/i, 'control_vehicle_windows', 'automotive', 'vehicle_window_module',
    ['vidroeletrico', 'modulo', 'automotivo', 'veiculo', 'conforto'], ['kitdemotor', 'pecademotor', 'alarmeresidencial']),
  profile('automotive_module', /modulo.*(?:automot|vidro|conforto|fiat|carro)/i, 'control_vehicle_accessory', 'automotive', 'vehicle_module',
    ['modulo', 'automotivo', 'veiculo', 'vidroeletrico'], ['alarmeresidencial', 'informatica']),
  profile('audio_patch_panel', /painel.*(?:multicabo|xlr|speakon)|multicabo.*painel/i, 'connect_audio_signal', 'professional_audio', 'audio_patch_panel',
    ['conector', 'painel', 'multicabo', 'xlr', 'audio'], ['redeethernet', 'alimentacaoeletrica', 'usbcelular']),
  profile('audio_cable', /cabo.*(?:p10|xlr|rca|instrumento|microfone|audio)/i, 'connect_audio_signal', 'professional_audio', 'audio_cable',
    ['cabo', 'audio', 'p10', 'xlr', 'rca', 'instrumentomusical'], ['redeethernet', 'alimentacaoeletrica', 'usbcelular']),
  profile('network_cable', /cabo.*(?:rede|cat5|cat6|ethernet|rj45)/i, 'connect_data_network', 'computing_network', 'network_cable',
    ['cabo', 'rede', 'ethernet', 'rj45'], ['instrumentomusical', 'cozinha', 'automotivo']),
  profile('power_cable', /cabo.*(?:forca|energia|alimentacao)/i, 'deliver_electric_power', 'electrical', 'power_cable',
    ['cabo', 'forca', 'energia', 'alimentacao'], ['instrumentomusical', 'redeethernet']),
  profile('battery_charger', /carregador.*(?:pilha|bateria)/i, 'charge_rechargeable_cells', 'battery_accessory', 'battery_charger',
    ['carregador', 'pilha', 'bateria'], ['celular', 'notebook', 'veicular']),
  profile('phone_charger', /carregador.*(?:usb|celular|gan|veicular)/i, 'charge_mobile_device', 'mobile_accessory', 'usb_charger',
    ['carregador', 'usb', 'celular', 'veicular'], ['pilhaaa', 'pilhaaaa', 'instrumentomusical']),
  profile('acoustic_speaker', /caixa.*(?:acustica|som|ativa|passiva)/i, 'reproduce_audio', 'professional_audio', 'speaker_enclosure',
    ['caixaacustica', 'audio', 'som', 'altofalante'], ['organizacao', 'armazenamento', 'ferramenta']),
  profile('storage_box', /caixa.*(?:organizadora|armazenamento|plast)/i, 'store_objects', 'home_organization', 'storage_box',
    ['caixa', 'organizacao', 'armazenamento'], ['audio', 'altofalante', 'instrumentomusical']),
  profile('kitchen_appliance', /liquidificador|panela|frigideira|grill|waffle|omeleteira|espremedor|mixer|fogao/i, 'prepare_food', 'kitchen', 'kitchen_appliance',
    ['cozinha', 'eletrodomestico', 'liquidificador', 'panela', 'grill', 'fogao'], ['informatica', 'automotivo', 'instrumentomusical']),
  profile('vehicle_antenna', /antena.*(?:carro|automot|palio|mobi|gol|fiat|vw)|haste.*antena/i, 'receive_vehicle_radio_signal', 'automotive', 'vehicle_antenna',
    ['antena', 'automotivo', 'veiculo', 'carro'], ['gpsportatil', 'televisao', 'wifi']),
  profile('fixed_phone', /telefone.*(?:fixo|comfio|gsm)/i, 'voice_telephony', 'telephony', 'telephone',
    ['telefone', 'telefonia'], ['celularsmartphone', 'brinquedo']),
  profile('audio_connector', /conector|painel.*(?:xlr|speakon)|jack.*(?:p10|p2|j10)/i, 'connect_audio_signal', 'professional_audio', 'audio_connector',
    ['conector', 'audio', 'xlr', 'speakon', 'p10'], ['hidraulica', 'redeethernet']),
  profile('electric_lock', /fechadura|trinco/i, 'control_physical_access', 'electronic_security', 'electric_lock',
    ['fechadura', 'controledeacesso', 'seguranca'], ['software', 'automotivo']),
];

function profile(productType, pattern, productFunction, intendedUse, physicalForm, expected, incompatible) {
  return { productType, pattern, productFunction, intendedUse, physicalForm, expected, incompatible };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function tokens(value) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return [...new Set(normalized.split(/[^a-z0-9]+/).filter((word) => word.length >= 2))];
}

function inferProductSemantics(product, supplierProduct = null) {
  const primaryCorpus = `${product?.nome || ''} ${product?.categoria || ''} ${supplierProduct?.titulo || ''} ${supplierProduct?.categoria_nome || ''}`;
  const corpus = `${primaryCorpus} ${product?.descricao || ''} ${supplierProduct?.descricao || ''}`;
  const matched = PROFILES.find((row) => row.pattern.test(primaryCorpus)) || PROFILES.find((row) => row.pattern.test(corpus));
  if (matched) {
    return {
      product_type: matched.productType,
      function: matched.productFunction,
      intended_use: matched.intendedUse,
      physical_form: matched.physicalForm,
      expected_category_signals: matched.expected,
      incompatible_category_signals: matched.incompatible,
      key_attributes: extractKeyAttributes(corpus),
      audience_use_context: matched.intendedUse,
      confidence: 100,
      evidence: ['local_product', supplierProduct ? 'supplier' : null].filter(Boolean),
    };
  }
  return {
    product_type: 'unresolved', function: 'unresolved', intended_use: inferBroadContext(corpus),
    physical_form: 'unresolved', expected_category_signals: [], incompatible_category_signals: [],
    key_attributes: extractKeyAttributes(corpus), audience_use_context: inferBroadContext(corpus),
    confidence: 55, evidence: ['local_product', supplierProduct ? 'supplier' : null].filter(Boolean),
  };
}

function inferBroadContext(text) {
  const value = normalize(text);
  const contexts = [
    ['automotive', /automotiv|veicul|carro|somautomotivo/],
    ['musical_instrument', /instrument.*musical|guitarra|violao|microfone/],
    ['computing', /informatica|computador|notebook|tablet/],
    ['electronic_security', /seguranca|alarme|controledeacesso/],
    ['kitchen', /cozinha|eletrodomestico/],
    ['telephony', /telefonia|telefone/],
  ];
  return contexts.find(([, pattern]) => pattern.test(value))?.[0] || 'unresolved';
}

function extractKeyAttributes(text) {
  const source = String(text || '');
  return {
    voltages: [...new Set([...source.matchAll(/\b(110|127|220|240)\s*v\b/gi)].map((match) => `${match[1]}V`))],
    dimensions: [...new Set([...source.matchAll(/\b(\d{1,3}(?:[.,]\d+)?)\s*(mm|cm|pol|polegadas?)\b/gi)].map((match) => `${match[1]} ${match[2]}`))].slice(0, 10),
    powers: [...new Set([...source.matchAll(/\b(\d{1,5})\s*w(?:\s*rms)?\b/gi)].map((match) => match[0]))],
    quantities: [...new Set([...source.matchAll(/\b(\d{1,3})\s*(?:unidades|unid|pecas|peças)\b/gi)].map((match) => Number(match[1])))],
  };
}

function catalogSemantics(catalog) {
  if (!catalog) return null;
  return {
    id: catalog.id || catalog.catalog_product_id || null,
    title: catalog.name || null,
    domain_id: catalog.domain_id || null,
    brand: attributeValue(catalog, 'BRAND'),
    model: attributeValue(catalog, 'MODEL'),
    gtin: attributeValue(catalog, 'GTIN'),
    product_type: attributeValue(catalog, 'PRODUCT_TYPE') || null,
    authority_types: catalog.authority_types || [],
    community_weight_reduced: (catalog.authority_types || []).includes('COMMUNITY'),
  };
}

function categorySemantics(category, domainCandidate = null) {
  const path = (category?.path_from_root || []).map((row) => row.name);
  const corpus = normalize(`${domainCandidate?.domain_id || ''} ${domainCandidate?.domain_name || ''} ${category?.settings?.catalog_domain || ''} ${path.join(' ')} ${category?.name || ''}`);
  return {
    category_id: category?.id || domainCandidate?.category_id || null,
    domain_id: category?.settings?.catalog_domain || domainCandidate?.domain_id || null,
    domain_name: domainCandidate?.domain_name || null,
    category_name: category?.name || domainCandidate?.category_name || null,
    category_path: path,
    normalized_context: corpus,
  };
}

function attributeSemanticSignals(productSemantics, attributes = []) {
  const names = attributes.map((row) => `${row.id || ''} ${row.name || ''}`).join(' ');
  const normalized = normalize(names);
  const absurd = [];
  if (productSemantics.product_type === 'professional_speaker_driver' && /tabletsize|operatingsystem|screen|touchscreen/.test(normalized)) absurd.push('TABLET_ATTRIBUTES_FOR_PROFESSIONAL_SPEAKER');
  if (/microphone/.test(productSemantics.product_type) && /tabletsize|screenresolution|batterycapacity/.test(normalized)) absurd.push('DEVICE_ATTRIBUTES_FOR_MICROPHONE');
  return { checked: attributes.length > 0, attribute_count: attributes.length, conflicts: absurd, classification: absurd.length ? 'ATTRIBUTE_SEMANTIC_MISMATCH' : 'NO_HARD_ATTRIBUTE_MISMATCH' };
}

function semanticAssessment({ productSemantics, category, catalog = null, identityConfidence = 0, attributes = [], independentSource = false }) {
  const remote = category.normalized_context || '';
  const expectedHits = productSemantics.expected_category_signals.filter((signal) => remote.includes(normalize(signal)));
  const contextOnly = new Set(['audio', 'somprofissional', 'automotivo', 'veiculo', 'carro', 'informatica', 'computador', 'instrumentomusical', 'seguranca', 'eletrodomestico', 'eletrico', 'telefonia']);
  const functionalExpected = productSemantics.expected_category_signals.filter((signal) => !contextOnly.has(normalize(signal)));
  const functionalHits = functionalExpected.filter((signal) => remote.includes(normalize(signal)));
  const incompatibleHits = productSemantics.incompatible_category_signals.filter((signal) => remote.includes(normalize(signal)));
  const attributeSignals = attributeSemanticSignals(productSemantics, attributes);
  const functionMatch = functionalHits.length > 0;
  const contextTokens = contextSignals(productSemantics.intended_use);
  const intendedHits = contextTokens.filter((signal) => remote.includes(signal));
  const intendedMatch = intendedHits.length > 0 || ['unresolved', 'professional_audio'].includes(productSemantics.intended_use) && /audio|instrumentomusical|altofalante|microfone/.test(remote);
  const pathCoherent = category.category_path.length >= 2 && functionMatch && incompatibleHits.length === 0;
  const catalogData = catalogSemantics(catalog);
  const catalogCoherent = Boolean(catalogData
    && normalizeGtin(catalogData.gtin)
    && normalize(catalogData.domain_id) === normalize(category.domain_id)
    && !incompatibleHits.length
    && (normalize(catalogData.title).includes(normal(productSemantics.product_type)) || functionMatch));
  const hardConflicts = [];
  if (incompatibleHits.length) hardConflicts.push(`INCOMPATIBLE_CONTEXT:${incompatibleHits.join('|')}`);
  if (attributeSignals.conflicts.length) hardConflicts.push(...attributeSignals.conflicts);
  if (productSemantics.product_type === 'professional_speaker_driver' && /tablet|internal_speaker/.test(remote)) hardConflicts.push('PROFESSIONAL_SPEAKER_IN_TABLET_TREE');
  if (productSemantics.intended_use !== 'unresolved' && !intendedMatch && remote && contextIsExclusive(remote)) hardConflicts.push(`INTENDED_USE_MISMATCH:${productSemantics.intended_use}`);
  if (productSemantics.product_type !== 'unresolved' && category.category_path.length >= 2 && !functionMatch) hardConflicts.push(`PRODUCT_FUNCTION_MISMATCH:${productSemantics.function}`);
  const correlatedError = hardConflicts.length > 0 && catalogData && normalize(catalogData.domain_id) === normalize(category.domain_id);
  const parts = {
    product_identity: Math.min(25, Math.round(identityConfidence * 0.25)),
    function_match: functionMatch ? 25 : productSemantics.function === 'unresolved' ? 0 : 8,
    intended_use: intendedMatch ? 20 : productSemantics.intended_use === 'unresolved' ? 0 : 5,
    category_path_coherence: pathCoherent ? 20 : functionMatch && !hardConflicts.length ? 10 : 0,
    catalog_coherence: catalogCoherent ? 10 : catalogData ? 3 : 0,
  };
  let score = Object.values(parts).reduce((sum, value) => sum + value, 0);
  if (hardConflicts.length) score = Math.min(score, 74);
  return {
    score, parts, identity_confidence: identityConfidence,
    classification: hardConflicts.length ? 'SEMANTIC_MISMATCH' : score >= 95 ? 'SEMANTIC_MATCH' : score >= 75 ? 'SEMANTIC_PARTIAL' : 'UNKNOWN',
    hard_mismatch: hardConflicts.length > 0, hard_conflicts: hardConflicts,
    function_match: functionMatch, intended_use_match: intendedMatch, path_coherent: pathCoherent,
    expected_hits: expectedHits, functional_hits: functionalHits, incompatible_hits: incompatibleHits,
    catalog_category_correlated_error: correlatedError,
    independent_source_present: independentSource,
    attribute_signals: attributeSignals,
  };
}

function normal(value) {
  return normalize(value).replace(/professional|driver|electric|room|computer|kitchen|instrument/g, '');
}

function contextSignals(context) {
  return {
    professional_audio: ['audio', 'somprofissional', 'instrument', 'altofalante', 'microfone'],
    musical_instrument: ['instrument', 'guitarra', 'violao', 'corda'],
    automotive: ['automotiv', 'veicul', 'carro'],
    computing: ['informatica', 'computador', 'mouse'],
    computing_network: ['informatica', 'rede', 'ethernet'],
    electronic_security: ['seguranca', 'alarme', 'controledeacesso'],
    home_appliance: ['eletrodomestico', 'climatizacao', 'ventilador'],
    kitchen: ['cozinha', 'eletrodomestico'],
    telephony: ['telefonia', 'telefone'],
    mobile_accessory: ['celular', 'smartphone', 'mobile'],
    battery_accessory: ['pilha', 'bateria', 'carregador'],
    home_electronics: ['televisao', 'tv', 'eletronico'],
    electrical: ['eletrica', 'energia', 'cabo'],
    measurement: ['medicao', 'temperatura', 'instrumento'],
    home_organization: ['organizacao', 'armazenamento'],
  }[context] || [];
}

function contextIsExclusive(remote) {
  return /tablet|informatica|automotiv|veicul|cozinha|eletrodomestico|instrumentomusical|seguranca|telefonia/.test(remote);
}

function secondPass({ productSemantics, category, assessment, supplierCategory }) {
  if (assessment.hard_mismatch) return { verdict: 'REJECT', reason: 'first-pass hard semantic mismatch' };
  const supplierContext = inferBroadContext(supplierCategory || '');
  const remoteContext = inferBroadContext(`${category.category_path.join(' ')} ${category.domain_id || ''}`);
  const contextAgreement = supplierContext === 'unresolved' || remoteContext === 'unresolved' || supplierContext === remoteContext
    || (supplierContext === 'musical_instrument' && productSemantics.intended_use === 'professional_audio');
  const independentFunction = productSemantics.expected_category_signals.some((signal) => category.normalized_context.includes(normalize(signal)));
  return {
    verdict: contextAgreement && independentFunction ? 'PASS' : 'REVIEW_REQUIRED',
    supplier_context: supplierContext,
    remote_context: remoteContext,
    independent_function_match: independentFunction,
    reason: contextAgreement && independentFunction ? 'supplier/local semantics and full category path agree' : 'independent semantic route did not fully agree',
  };
}

function candidateDecision({ previousState, assessment, second, hasAlternative }) {
  if (assessment.hard_mismatch) return 'BLOCK_SEMANTIC_CATEGORY_MISMATCH';
  if (hasAlternative && assessment.score >= 90 && second.verdict === 'PASS') return 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND';
  if (assessment.score < 95) return assessment.score >= 75 ? 'BLOCK_CATEGORY' : 'SOURCE_DEFERRED';
  if (second.verdict !== 'PASS') return 'SEMANTIC_CATEGORY_REVIEW_REQUIRED';
  if (hasAlternative || previousState === 'BLOCK_CATEGORY') return 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND';
  return 'SEMANTIC_CATEGORY_READY';
}

function preservePriorBlock(state) {
  if (['BLOCK_GTIN_BRAND_CONFLICT', 'BLOCK_GTIN_MODEL_CONFLICT', 'BLOCK_GTIN_UNIT_CONFLICT', 'BLOCK_IDENTITY', 'BLOCK_CATALOG_IDENTITY', 'BLOCK_LOCAL_STATE'].includes(state)) return state;
  return null;
}

module.exports = {
  EXPECTED_SELECTION_SHA256,
  TERMINAL_STATES,
  PROFILES,
  attributeSemanticSignals,
  candidateDecision,
  catalogSemantics,
  categorySemantics,
  inferProductSemantics,
  parseCsv,
  preservePriorBlock,
  secondPass,
  semanticAssessment,
  sha256,
  identityAssessment,
};
