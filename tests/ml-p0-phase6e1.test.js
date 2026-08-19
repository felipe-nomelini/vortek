const test = require('node:test');
const assert = require('node:assert/strict');
const {
  categorySemantics,
  inferProductSemantics,
  secondPass,
  semanticAssessment,
} = require('../scripts/lib/ml-p0-phase6e1');

function assess(name, localCategory, remotePath, domain, catalog = null, attrs = []) {
  const product = { nome: name, categoria: localCategory, descricao: name };
  const productSemantics = inferProductSemantics(product, { titulo: name, categoria_nome: localCategory });
  const category = categorySemantics({ id: 'MLB1', name: remotePath.at(-1), path_from_root: remotePath.map((value) => ({ name: value })), settings: { catalog_domain: domain } });
  const assessment = semanticAssessment({ productSemantics, category, catalog, identityConfidence: 100, attributes: attrs, independentSource: true });
  return { productSemantics, category, assessment, second: secondPass({ productSemantics, category, assessment, supplierCategory: localCategory }) };
}

test('VTK012864 regression: professional speaker never fits tablet internal-speaker tree', () => {
  const row = assess(
    'Alto-falante profissional ATK 18 Pol 1500W RMS 18LF3000B-8',
    'Áudio profissional > Alto-falantes',
    ['Informática', 'Tablets e Acessórios', 'Peças', 'Alto-Falantes'],
    'MLB-TABLET_INTERNAL_SPEAKERS',
    { id: 'MLB32450801', domain_id: 'MLB-TABLET_INTERNAL_SPEAKERS', name: 'Alto-falante profissional ATK', authority_types: ['COMMUNITY'], attributes: [{ id: 'GTIN', value_name: '7898640362106' }] },
    [{ id: 'TABLET_SIZE', name: 'Tamanho do tablet' }],
  );
  assert.equal(row.assessment.hard_mismatch, true);
  assert.ok(row.assessment.score <= 74);
  assert.equal(row.assessment.catalog_category_correlated_error, true);
});

test('polysemy: instrument support does not fit television support', () => {
  const row = assess('Suporte para guitarra e violão', 'Instrumentos Musicais > Suportes', ['Eletrônicos', 'TV', 'Suportes para TV'], 'MLB-TV_MOUNTS');
  assert.equal(row.assessment.hard_mismatch, true);
});

test('polysemy: alarm sensor does not fit parking sensors', () => {
  const row = assess('Sensor de presença infravermelho para alarme', 'Segurança > Alarmes > Sensores', ['Acessórios para Veículos', 'Sensores de Estacionamento'], 'MLB-PARKING_SENSORS');
  assert.equal(row.assessment.hard_mismatch, true);
});

test('polysemy: security module does not fit automotive amplifier modules', () => {
  const row = assess('Módulo GPRS Viaweb para alarme', 'Segurança > Alarmes > Módulos', ['Acessórios para Veículos', 'Som Automotivo', 'Módulos Amplificadores'], 'MLB-VEHICLE_AMPLIFIERS');
  assert.equal(row.assessment.hard_mismatch, true);
});

test('polysemy: instrument cable does not fit ethernet network cable', () => {
  const row = assess('Cabo instrumento P10 para P10 5m', 'Instrumentos Musicais > Cabos', ['Informática', 'Redes', 'Cabos Ethernet'], 'MLB-NETWORK_CABLES');
  assert.equal(row.assessment.hard_mismatch, true);
});

test('polysemy: acoustic speaker box does not fit storage boxes', () => {
  const row = assess('Caixa acústica ativa 15 polegadas', 'Áudio profissional > Caixas Acústicas', ['Casa', 'Organização', 'Caixas Organizadoras'], 'MLB-STORAGE_BOXES');
  assert.equal(row.assessment.hard_mismatch, true);
});

test('polysemy: battery charger does not fit phone chargers', () => {
  const row = assess('Carregador de pilhas AA AAA Ni-MH', 'Pilhas e Carregadores', ['Celulares', 'Acessórios', 'Carregadores USB'], 'MLB-CELLPHONE_CHARGERS');
  assert.equal(row.assessment.hard_mismatch, true);
});

test('positive: mouse category remains READY-quality', () => {
  const row = assess('Mouse Intelbras MSI50 sem fio', 'Informática > Periféricos > Mouse', ['Informática', 'Periféricos', 'Mouses'], 'MLB-COMPUTER_MICE', { id: 'MLB1', domain_id: 'MLB-COMPUTER_MICE', name: 'Mouse Intelbras MSI50', attributes: [{ id: 'GTIN', value_name: '7899' }] });
  assert.equal(row.assessment.hard_mismatch, false);
  assert.ok(row.assessment.score >= 95);
  assert.equal(row.second.verdict, 'PASS');
});

test('positive: room fan category remains READY-quality', () => {
  const row = assess('Ventilador de Mesa Ventisol Turbo 6 40cm', 'Eletrodomésticos > Ventiladores', ['Eletrodomésticos', 'Climatização', 'Ventiladores'], 'MLB-FANS', { id: 'MLB2', domain_id: 'MLB-FANS', name: 'Ventilador Ventisol Turbo 6', attributes: [{ id: 'GTIN', value_name: '7898' }] });
  assert.equal(row.assessment.hard_mismatch, false);
  assert.ok(row.assessment.score >= 95);
});

test('positive: guitar strings category remains READY-quality', () => {
  const row = assess('Encordoamento Guitarra Elétrica .010', 'Instrumentos Musicais > Cordas', ['Instrumentos Musicais', 'Acessórios', 'Cordas para Guitarra'], 'MLB-GUITAR_STRINGS', { id: 'MLB3', domain_id: 'MLB-GUITAR_STRINGS', name: 'Encordoamento Guitarra .010', attributes: [{ id: 'GTIN', value_name: '6940' }] });
  assert.equal(row.assessment.hard_mismatch, false);
  assert.ok(row.assessment.score >= 95);
});

test('positive: instrument support category remains READY-quality', () => {
  const row = assess('Suporte de parede para guitarra', 'Instrumentos Musicais > Suportes', ['Instrumentos Musicais', 'Acessórios', 'Suportes para Instrumentos'], 'MLB-INSTRUMENT_STANDS', { id: 'MLB4', domain_id: 'MLB-INSTRUMENT_STANDS', name: 'Suporte para Guitarra', attributes: [{ id: 'GTIN', value_name: '7898' }] });
  assert.equal(row.assessment.hard_mismatch, false);
  assert.ok(row.assessment.score >= 95);
});

test('positive: kitchen appliance category remains READY-quality', () => {
  const row = assess('Liquidificador Arno Power Mix 220V', 'Eletrodomésticos > Cozinha > Liquidificadores', ['Eletrodomésticos', 'Pequenos Eletrodomésticos', 'Liquidificadores'], 'MLB-BLENDERS', { id: 'MLB5', domain_id: 'MLB-BLENDERS', name: 'Liquidificador Arno Power Mix', attributes: [{ id: 'GTIN', value_name: '7895' }] });
  assert.equal(row.assessment.hard_mismatch, false);
  assert.ok(row.assessment.score >= 95);
});

test('primary identity wins over incidental sensor and temperature words in lock description', () => {
  const product = {
    nome: 'Fechadura Solenoide Intelbras FS 1010',
    categoria: 'Segurança > Fechadura Elétrica > Controle de Acesso',
    descricao: 'Possui sensor de fechamento. Temperatura de funcionamento 0 a 60 graus.',
  };
  const semantics = inferProductSemantics(product, { titulo: product.nome, categoria_nome: product.categoria });
  assert.equal(semantics.product_type, 'electric_lock');
  assert.equal(semantics.intended_use, 'electronic_security');
});

test('Fiat window comfort module does not fit engine kit category', () => {
  const row = assess('Kit Conforto Linha Fiat Tury LVX5 TW2PT', 'Automotivo > Acessórios para Vidro Elétrico', ['Acessórios para Veículos', 'Motor', 'Kits de Motor'], 'MLB-ENGINE_KITS');
  assert.equal(row.assessment.hard_mismatch, true);
  assert.match(row.assessment.hard_conflicts.join(','), /PRODUCT_FUNCTION_MISMATCH/);
});

test('security inductive loop does not fit horse lasso category', () => {
  const row = assess('Laço Indutivo Citrox CX-4001', 'Segurança > Alarme > Acessórios', ['Esportes e Fitness', 'Equitação', 'Equipamento do Cavalo', 'Laços'], 'MLB-HORSE_LASSOS');
  assert.equal(row.assessment.hard_mismatch, true);
  assert.ok(row.assessment.incompatible_hits.includes('equitacao'));
});

test('positive: professional multicable panel fits DJ audio connectors', () => {
  const row = assess(
    'Painel Multicabo 36 Vias XLR Sem Conectores Wireconex',
    'Instrumentos Musicais > Cabos > Multicabos',
    ['Eletrônicos, Áudio e Vídeo', 'Áudio', 'Equipamento para DJs', 'Acessórios', 'Conectores'],
    'MLB-AUDIO_AND_VIDEO_CONNECTORS',
    { id: 'MLB6', domain_id: 'MLB-AUDIO_AND_VIDEO_CONNECTORS', name: 'Painel Multicabo XLR', attributes: [] },
  );
  assert.equal(row.productSemantics.product_type, 'audio_patch_panel');
  assert.equal(row.assessment.hard_mismatch, false);
  assert.ok(row.assessment.score >= 90);
  assert.equal(row.second.verdict, 'PASS');
});
