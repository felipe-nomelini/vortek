const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const load = require('./helpers/load-integration-module');
const identity = require('../src/lib/ml-listing-identity.ts');
const critical = load('src/lib/ml-critical-attributes.ts', {
  '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'),
  '@/lib/ml-voltage': require('../src/lib/ml-voltage.ts'),
  '@/lib/ml-listing-identity': identity,
  '@/lib/dslite/supplier-policy': require('../src/lib/dslite/supplier-policy.ts'),
});
const source = fs.readFileSync('src/app/api/sync/anuncios/route.ts', 'utf8');
// Executa o trecho real responsável pela decisão, com núcleo real e I/O isolado.
const from = source.indexOf('          const categoryId = String(item.category_id');
const to = source.indexOf('\n        }\n\n        if (produto?.', from);
assert.ok(from > 0 && to > from);
const body = ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const runDecision = new Function('deps', `return (async () => {
  const { item, byItem, identityOffers, operationalSupplierIds, serviceClient,
    assessMlProductIdentity, getCategoryAttributes, loadMlIdentityKit,
    isMlIdentityComplete, hasConfirmedMlIdentityConflict, clearAutomaticMlIdentityBlock,
    ensureAutomaticMlIdentityBlock } = deps;
  let produto = deps.produto, produtoId = produto.id, skuLocal = produto.sku;
  const warnings = [], errors = [], identityCategories = new Map(), identityKits = new Map(), identityDeferredIds = new Set();
  ${body}
  return { produto, produtoId, skuLocal, warnings, errors, deferred: [...identityDeferredIds] };
})();`);

function setup() {
  const calls = [];
  const produto = { id: 'P1', sku: 'VTK1', nome: 'Produto', descricao: 'Modelo: M1; Formato de venda: Unidade', marca: 'Marca A', gtin: '7898705602659', updated_at: '2026-09-07T00:00:00.000Z' };
  const item = { id: 'MLB1', category_id: 'CAT1', seller_custom_field: 'VTK1', attributes: [
    { id: 'GTIN', value_name: produto.gtin }, { id: 'BRAND', value_name: produto.marca },
    { id: 'MODEL', value_name: 'M1' }, { id: 'SALE_FORMAT', value_name: 'Unidade' }, { id: 'UNITS_PER_PACK', value_name: '1' },
  ] };
  return { calls, deps: { produto, item, byItem: produto, identityOffers: [], operationalSupplierIds: new Set(), serviceClient: {},
    assessMlProductIdentity: critical.assessMlProductIdentity,
    getCategoryAttributes: async () => item.attributes.map(attr => ({ id: attr.id })),
    loadMlIdentityKit: async () => ({ status: 'not_kit', components: [] }),
    isMlIdentityComplete: identity.isMlIdentityComplete,
    hasConfirmedMlIdentityConflict: identity.hasConfirmedMlIdentityConflict,
    clearAutomaticMlIdentityBlock: async () => { calls.push('clear'); return { ok: true }; },
    ensureAutomaticMlIdentityBlock: async () => { calls.push('ensure'); return { ok: true }; },
  } };
}

test('sync completo usa somente desbloqueio automático; não reconcilia marca', async () => {
  const { calls, deps } = setup(); const result = await runDecision(deps);
  assert.deepEqual(calls, ['clear']); assert.equal(result.produto.marca, 'Marca A');
  assert.deepEqual(result.deferred, []);
});

test('sync inconclusivo não cria/remove bloqueio nem habilita escrita por produto', async () => {
  const { calls, deps } = setup(); deps.produto.descricao = '';
  const result = await runDecision(deps);
  assert.deepEqual(calls, []); assert.equal(result.produto, null);
  assert.equal(result.produtoId, 'P1'); // referência anterior preservada, não novo vínculo.
  assert.deepEqual(result.deferred, ['MLB1']);
  assert.match(source, /!identityDeferredIds.has\(String\(snapshot.ml_item_id\)\)/);
});

test('candidato por SKU não é vinculado quando identidade está pendente', async () => {
  const { calls, deps } = setup(); deps.byItem = null; deps.produto.descricao = '';
  const result = await runDecision(deps);
  assert.deepEqual(calls, []); assert.equal(result.produtoId, null); assert.equal(result.skuLocal, null);
});

test('sync com divergência comprovada usa bloqueio local existente, sem trocar marca', async () => {
  const { calls, deps } = setup(); deps.item.attributes.find(attr => attr.id === 'BRAND').value_name = 'Marca B';
  const result = await runDecision(deps);
  assert.deepEqual(calls, ['ensure']); assert.equal(result.produtoId, null); assert.equal(deps.produto.marca, 'Marca A');
});

test('falha da fonte de categoria mantém observação e não libera bloqueio', async () => {
  const { calls, deps } = setup(); deps.getCategoryAttributes = async () => null;
  const result = await runDecision(deps);
  assert.deepEqual(calls, []); assert.equal(result.warnings[0].code, 'ml_identity_validation_pending');
});

test('schema crítico não usa predição e listas respeitam valor oficial', () => {
  const schema = fs.readFileSync('src/app/api/ml/anuncio/schema/route.ts', 'utf8');
  const ast = ts.createSourceFile('schema.ts', schema, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'pickAllowedValue');
  const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const pick = new Function('isMlCriticalAttributeId', 'normalizeMlIdentityValue', `${js}; return pickAllowedValue;`)(critical.isMlCriticalAttributeId, identity.normalizeMlIdentityValue);
  const attr = { id: 'SALE_FORMAT', value_type: 'list', values: [{ id: 'UNIT', name: 'Unidade' }, { id: 'PACK', name: 'Kit' }] };
  assert.deepEqual(pick(attr, 'unit'), { value_id: 'UNIT', value_name: 'Unidade' });
  assert.deepEqual(pick(attr, 'desconhecido'), {});
  assert.match(schema, /const pre = isMlCriticalAttributeId\(attrId\)/);
  assert.match(schema, /resolveTrustedMlCriticalValue\(attrId, produto, supplierOffers \|\| \[\], operationalSupplierIds, kit, attrs\)/);
});

test('read-back ausente não usa resposta inicial para pausar por identidade', () => {
  const create = fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts', 'utf8');
  assert.doesNotMatch(create, /let latestItem = \(await getListingSnapshot\(result.id\)\) \|\| result/);
  const begin = create.indexOf('let latestItem = await getListingSnapshot(result.id)');
  const assessment = create.indexOf('const identityAssessment', begin);
  const fragment = create.slice(begin, assessment);
  assert.match(fragment, /if \(!latestItem\) return NextResponse.json/);
  assert.doesNotMatch(fragment, /pauseCreatedListing/);
  assert.doesNotMatch(create, /canonicalBrand|blockingConflicts/);
});
