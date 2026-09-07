const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./helpers/load-integration-module');
const identity = require('../src/lib/ml-listing-identity.ts');
const { classifyCommercialConflicts } = require('../src/services/commercial-conflicts.ts');
const critical = load('src/lib/ml-critical-attributes.ts', {
  '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'),
  '@/lib/ml-voltage': require('../src/lib/ml-voltage.ts'),
  '@/lib/ml-listing-identity': identity,
  '@/lib/dslite/supplier-policy': require('../src/lib/dslite/supplier-policy.ts'),
});
const timestamp = '2026-09-07T04:00:00.000Z';
const proof = (source = 'product', reference = 'P1') => ({ source, reference, collectedAt: timestamp, condition: 'valid' });
function fixture() {
  const values = { SELLER_SKU: 'VTK1', GTIN: '7898705602659', BRAND: 'Marca A', MODEL: 'Modelo 1', VOLTAGE: '127V', SALE_FORMAT: 'Kit', UNITS_PER_PACK: '6', PACKAGES_NUMBER: '2' };
  return {
    facts: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, evidence: [proof()] }])),
    item: { id: 'MLB1', category_id: 'CAT1', attributes: Object.entries(values).map(([id, value_name]) => ({ id, value_name })) },
    context: { categoryAttributes: Object.keys(values).map(id => ({ id })), remoteEvidence: proof('mercado_livre', 'MLB1') },
  };
}
const evaluate = ({ item, facts, context }) => identity.assessMlListingIdentity(item, facts, context);
const setRemote = (input, field, value_name) => { input.item.attributes = input.item.attributes.filter(attr => attr.id !== field).concat({ id: field, value_name }); };
const get = (result, field) => result.comparisons.find(row => row.field === field);

test('identidade/apresentação completas alimentam CFL-01 sem aprovar vínculo ou economia', () => {
  const result = evaluate(fixture());
  assert.ok(identity.isMlIdentityComplete(result));
  assert.equal(result.identity.status, 'SEM_CONFLITO');
  assert.equal(classifyCommercialConflicts(result).status, 'PENDENCIA_VALIDACAO');
  assert.equal('canonicalBrand' in result, false);
  assert.equal('blockingConflicts' in result, false);
});

for (const [field, value] of [['BRAND', 'Marca B'], ['MODEL', 'Outro'], ['GTIN', '7898705600000'], ['UNITS_PER_PACK', '1'], ['SALE_FORMAT', 'Unidade']]) {
  test(`divergência material ${field}, mesmo com outros identificadores iguais`, () => {
    const input = fixture(); setRemote(input, field, value);
    const result = evaluate(input);
    assert.ok(identity.hasConfirmedMlIdentityConflict(result));
    assert.equal(get(result, field).status, 'CONFLITO_CONFIRMADO');
  });
}

test('ausência não é divergência e não permite desbloqueio', () => {
  const input = fixture(); delete input.facts.MODEL;
  const result = evaluate(input);
  assert.equal(result.identity.status, 'PENDENCIA_VALIDACAO');
  assert.equal(identity.isMlIdentityComplete(result), false);
  assert.equal(identity.hasConfirmedMlIdentityConflict(result), false);
});

test('categoria ausente impede cobertura completa, mas não apaga conflito comprovado', () => {
  const input = fixture(); input.context.categoryAttributes = null;
  assert.equal(identity.isMlIdentityComplete(evaluate(input)), false);
  setRemote(input, 'BRAND', 'Outra');
  assert.equal(evaluate(input).identity.status, 'CONFLITO_CONFIRMADO');
  assert.equal(evaluate(input).identity.coverage, 'partial');
});

for (const condition of ['stale', 'unavailable', 'invalid', 'inconsistent']) {
  test(`${condition}: evidência não confirma conflito nem libera ação`, () => {
    const input = fixture(); input.context.remoteEvidence.condition = condition;
    setRemote(input, 'BRAND', 'Outra');
    assert.equal(evaluate(input).identity.status, 'INCONCLUSIVO');
    assert.equal(identity.hasConfirmedMlIdentityConflict(evaluate(input)), false);
  });
}

test('campo stale independente não apaga prova válida de outra contradição', () => {
  const input = fixture(); input.facts.MODEL.evidence[0].condition = 'stale';
  setRemote(input, 'BRAND', 'Outra');
  const result = evaluate(input);
  assert.equal(classifyCommercialConflicts(result).status, 'CONFLITO_CONFIRMADO');
  assert.equal(get(result, 'MODEL').status, 'INCONCLUSIVO');
});

test('120V não prova 127V; 220V contra 127V é divergência', () => {
  const input = fixture(); setRemote(input, 'VOLTAGE', '120 V');
  assert.equal(get(evaluate(input), 'VOLTAGE').status, 'INCONCLUSIVO');
  setRemote(input, 'VOLTAGE', '220 V');
  assert.equal(get(evaluate(input), 'VOLTAGE').status, 'CONFLITO_CONFIRMADO');
});

test('variante selecionada usa seu GTIN, sem comparar outra cor ou herdar GTIN do pai', () => {
  const input = fixture();
  input.item.variations = [{ id: 'V1', seller_custom_field: 'VTK1', attributes: [{ id: 'GTIN', value_name: '7898705602659' }] },
    { id: 'V2', seller_custom_field: 'VTK2', attributes: [{ id: 'GTIN', value_name: '7898705600000' }] }];
  setRemote(input, 'GTIN', '1111111111111');
  assert.equal(get(evaluate(input), 'GTIN').status, 'SEM_CONFLITO');
  input.item.variations[0].attributes = [];
  assert.equal(get(evaluate(input), 'GTIN').status, 'PENDENCIA_VALIDACAO');
});

test('variante não identificada ou SKU ambíguo não gera divergência', () => {
  const input = fixture(); input.item.variations = [{ id: 'V1' }, { id: 'V2' }];
  assert.equal(evaluate(input).identity.status, 'PENDENCIA_VALIDACAO');
  input.item.variations.forEach(row => { row.seller_custom_field = 'VTK1'; });
  assert.equal(evaluate(input).identity.status, 'PENDENCIA_VALIDACAO');
});

test('value_id da categoria, múltiplos valores e normalização sem inventar marca', () => {
  const input = fixture();
  input.context.categoryAttributes.find(attr => attr.id === 'BRAND').values = [{ id: '123', name: 'Marca A' }];
  input.item.attributes.find(attr => attr.id === 'BRAND').value_name = undefined;
  input.item.attributes.find(attr => attr.id === 'BRAND').value_id = '123';
  assert.equal(get(evaluate(input), 'BRAND').status, 'SEM_CONFLITO');
  input.item.attributes.push({ id: 'BRAND', value_name: 'Marca B' });
  assert.equal(get(evaluate(input), 'BRAND').status, 'INCONCLUSIVO');
});

test('apresentação é independente dos volumes logísticos e de estoque/quantidade comprada', () => {
  const input = fixture(); input.item.available_quantity = 200; input.item.sold_quantity = 50;
  const result = evaluate(input);
  assert.equal(get(result, 'UNITS_PER_PACK').local, '6');
  assert.equal(get(result, 'PACKAGES_NUMBER').local, '2');
  assert.ok(identity.isMlIdentityComplete(result));
});

test('atributo irrelevante ausente da categoria e das evidências não é exigido', () => {
  const input = fixture(); delete input.facts.PACKAGES_NUMBER;
  input.context.categoryAttributes = input.context.categoryAttributes.filter(attr => attr.id !== 'PACKAGES_NUMBER');
  input.item.attributes = input.item.attributes.filter(attr => attr.id !== 'PACKAGES_NUMBER');
  const result = evaluate(input);
  assert.equal(get(result, 'PACKAGES_NUMBER'), undefined);
  assert.ok(identity.isMlIdentityComplete(result));
});

test('quantidade inválida não é tratada como ausência ou comparação válida', () => {
  const input = fixture(); setRemote(input, 'UNITS_PER_PACK', '0');
  assert.equal(get(evaluate(input), 'UNITS_PER_PACK').status, 'INCONCLUSIVO');
});

test('variante sem atributo variável não herda cor do anúncio pai', () => {
  const input = fixture(); input.facts.COLOR = { value: 'Azul', evidence: [proof()] };
  input.context.categoryAttributes.push({ id: 'COLOR', tags: { allow_variations: true } });
  setRemote(input, 'COLOR', 'Azul');
  input.item.variations = [{ id: 'V1', seller_custom_field: 'VTK1', attributes: [{ id: 'GTIN', value_name: '7898705602659' }] }];
  assert.equal(get(evaluate(input), 'COLOR').status, 'PENDENCIA_VALIDACAO');
});

test('unidades convertíveis com mesma grandeza não criam conflito de dimensão', () => {
  const input = fixture(); input.facts.DIAMETER = { value: '30 cm', evidence: [proof()] };
  setRemote(input, 'DIAMETER', '300 mm');
  assert.equal(get(evaluate(input), 'DIAMETER').status, 'SEM_CONFLITO');
});

function product(overrides = {}) { return { id: 'P1', sku: 'VTK1', nome: 'Produto', descricao: 'Modelo: M1; Formato de venda: Unidade', marca: 'Marca A', gtin: '7898705602659', updated_at: timestamp, ...overrides }; }
const noKit = { status: 'not_kit', components: [] };
const operational = new Set(['S1']);
function offer(overrides = {}) { return { ...product(), id: 'O1', dslite_fornecedor_id: 'S1', ativo: true, custo: 10, estoque: 5, ...overrides }; }

test('não fabrica caixas por split e não deduz modelo/cor por categoria', () => {
  assert.equal(critical.extractPackagesNumber('Ar-condicionado split 12000 BTU'), null);
  assert.equal(critical.extractPackagesNumber('Embalagem: 2 caixas'), 2);
  const { facts } = critical.resolveMlCriticalFacts(product({ descricao: '', nome: 'Ar-condicionado split Preto' }), [], operational, noKit);
  assert.equal(facts.PACKAGES_NUMBER, undefined);
  assert.equal(facts.MODEL, undefined);
  assert.equal(facts.COLOR, undefined);
});

test('oferta inativa/fornecedor não operacional não são evidência; preferência válida não muda para esconder conflito', () => {
  const p = product({ oferta_preferencial_id: 'O1', fornecedor_preferencial_manual: true });
  const bad = offer({ marca: 'Marca B' });
  const good = offer({ id: 'O2', custo: 1 });
  const result = critical.resolveMlCriticalFacts(p, [bad, good], operational, noKit);
  assert.equal(result.preferredOffer.id, 'O1');
  assert.equal(result.facts.BRAND.ambiguous, true);
  assert.equal(critical.resolveTrustedMlCriticalValue('BRAND', p, [bad, good], operational, noKit), null);
  assert.equal(critical.resolveMlCriticalFacts(p, [offer({ ativo: false }), offer({ id: 'O3', dslite_fornecedor_id: 'S3' })], operational, noKit).preferredOffer, null);
});

test('quantidade ambígua não vira o primeiro número; falta de metadados não vira evidência', () => {
  const p = product({ descricao: 'Kit com 6 unidades; Conteudo da embalagem: 12 unidades' });
  assert.equal(critical.resolveTrustedMlCriticalValue('UNITS_PER_PACK', p, [], operational, noKit), null);
  assert.equal(critical.resolveTrustedMlCriticalValue('BRAND', product({ updated_at: null }), [], operational, noKit), null);
});

test('tensão nominal não herda tensão de entrada quando categoria distingue ambas', () => {
  const p = product({ descricao: 'Voltagem: 127V; Formato de venda: Unidade' });
  assert.equal(critical.resolveTrustedMlCriticalValue('NOMINAL_VOLTAGE', p, [], operational, noKit, [{ id: 'VOLTAGE' }, { id: 'NOMINAL_VOLTAGE' }]), null);
});

test('kit usa composição e unidade comercial do componente, não quantidade como unidades avulsas', () => {
  const p = product({ descricao: 'Modelo: M1', nome: 'Kit' });
  const kit = { status: 'ready', components: [{ quantidade: 3, produto: product({ descricao: 'Com 2 unidades' }) }] };
  assert.equal(critical.resolveTrustedMlCriticalValue('UNITS_PER_PACK', p, [], operational, kit), '6');
  kit.components[0].produto.descricao = '';
  assert.equal(critical.resolveTrustedMlCriticalValue('UNITS_PER_PACK', p, [], operational, kit), null);
});

test('kit composto permanece pendente sem prova da composição remota, mesmo com total igual', () => {
  const kit = { status: 'ready', components: [{ quantidade: 2, produto: product() }, { quantidade: 4, produto: product({ id: 'P2' }) }] };
  const input = fixture();
  const result = critical.assessMlProductIdentity(input.item, product({ descricao: 'Modelo: M1' }), [], operational, { ...input.context, kit });
  assert.equal(get(result, 'KIT_COMPOSITION').status, 'PENDENCIA_VALIDACAO');
  assert.equal(result.identity.coverage, 'partial');
});

test('loader de kits propaga ausência/falha como estado e lê componentes em lote', async () => {
  const calls = [];
  const client = { from(table) {
    calls.push(table);
    const data = table === 'produto_kits' ? { produto_id: 'K1', ativo: true }
      : table === 'produto_kit_componentes' ? [{ componente_produto_id: 'P1', quantidade: 2 }]
        : [product({ ativo: true })];
    const query = { select() { return this; }, eq() { return this; }, in() { return this; }, maybeSingle() { return this; }, then(resolve) { resolve({ data, error: null }); } };
    return query;
  } };
  assert.equal((await critical.loadMlIdentityKit(client, 'K1')).status, 'ready');
  assert.deepEqual(calls, ['produto_kits', 'produto_kit_componentes', 'produtos']);
  const failed = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ error: { message: 'unavailable' } }) }; } };
  assert.equal((await critical.loadMlIdentityKit(failed, 'K1')).status, 'inconclusive');
});
