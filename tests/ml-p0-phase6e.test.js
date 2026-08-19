const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  identityAssessment,
  categorySemanticAssessment,
  parseCsv,
  prepareSelection,
  resolveDynamicConfig,
  sha256,
} = require('../scripts/lib/ml-p0-phase6e');

function product(index, overrides = {}) {
  return {
    id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
    sku: `VTK${String(index).padStart(6, '0')}`,
    nome: `Produto Modelo M${index}`,
    marca: 'Marca',
    descricao: 'Produto comprovado',
    imagens: ['https://example.com/a.jpg'],
    estoque: index,
    custo: 10,
    gtin: String(7890000000000 + index),
    ativo: true,
    ml_item_id: null,
    oferta_preferencial_id: `offer-${index}`,
    fornecedor: 'Fornecedor',
    ...overrides,
  };
}

test('CSV parser preserves quoted commas and escaped quotes', () => {
  const rows = parseCsv('sku,nome\n"VTK1","Nome, com ""aspas"""\n');
  assert.deepEqual(rows, [{ sku: 'VTK1', nome: 'Nome, com "aspas"' }]);
});

test('dynamic selection freezes exactly 200, excludes VTK017508, and hashes bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6e-'));
  const reportsRoot = path.join(root, 'reports');
  const reportDir = path.join(reportsRoot, 'ml-p0-phase6e');
  fs.mkdirSync(reportDir, { recursive: true });
  const products = Array.from({ length: 205 }, (_, index) => product(index + 1));
  products[0] = product(1, { sku: 'VTK017508' });
  const offers = products.map((row, index) => ({ id: row.oferta_preferencial_id, ativo: true, fornecedor_nome: 'Fornecedor', estoque: 10, custo: 10, produto_id: row.id, index }));
  const result = prepareSelection({ allProducts: products, allOffers: offers, reportsRoot, reportDir });
  assert.equal(result.selected.length, 200);
  assert.equal(result.selected.some((row) => row.sku === 'VTK017508'), false);
  const bytes = fs.readFileSync(path.join(reportDir, 'selected-200.csv'));
  assert.equal(result.freeze.sha256, sha256(bytes));
  assert.equal(result.exclusions.some((row) => row.sku === 'VTK017508'), true);
});

test('identity assessment blocks exact GTIN catalog with incompatible battery identity', () => {
  const local = product(1, { nome: 'Pilha Energizer Max AA8 AAA4 12 unidades', marca: 'Energizer', descricao: 'Alcalina AA e AAA' });
  const offer = { nome: local.nome, descricao: local.descricao };
  const catalog = { name: 'Pilhas Energizer 8 AA + 4 AAA', attributes: [
    { id: 'GTIN', value_name: local.gtin },
    { id: 'BRAND', value_name: 'Energizer' },
    { id: 'MODEL', value_name: 'E95 Grande' },
    { id: 'UNITS_PER_PACK', value_name: '12' },
    { id: 'CELL_BATTERY_SIZE', value_name: 'D' },
    { id: 'CELL_BATTERY_COMPOSITION', value_name: 'Lítio' },
  ] };
  const audit = identityAssessment(local, offer, catalog, local.gtin);
  assert.equal(audit.passed, false);
  assert.ok(audit.conflicts.includes('MODEL'));
  assert.ok(audit.conflicts.includes('BATTERY_SIZE'));
  assert.ok(audit.conflicts.includes('COMPOSITION'));
});

test('missing GTIN is deferred, not classified as intrinsic GTIN failure', async () => {
  const resolved = await resolveDynamicConfig({ config: { gtin: '' }, product: product(1, { gtin: '' }), offer: {}, dslite: {}, exactResults: [], ml: async () => { throw new Error('must not call'); } });
  assert.equal(resolved.decision, 'SOURCE_DEFERRED');
  assert.match(resolved.reason, /GTIN absence is not a product failure/);
});

test('exact consistent catalog plus unique domain category resolves to PASS', async () => {
  const local = product(7, { nome: 'Microfone Marca ABC-7 Preto', marca: 'Marca' });
  const catalog = { id: 'MLB1', domain_id: 'MLB-MICROPHONES', name: 'Microfone Marca ABC-7 Preto', settings: { listing_strategy: 'catalog_required' }, attributes: [
    { id: 'GTIN', value_name: local.gtin }, { id: 'BRAND', value_name: 'Marca' }, { id: 'MODEL', value_name: 'ABC-7' }, { id: 'COLOR', value_name: 'Preto' },
  ] };
  const resolved = await resolveDynamicConfig({ config: { sku: local.sku, gtin: local.gtin }, product: local, offer: { nome: local.nome, descricao: '' }, dslite: { url: 'supplier' }, exactResults: [catalog], ml: async (endpoint) => endpoint.startsWith('/categories/')
    ? { ok: true, status: 200, data: { id: 'MLB4469', name: 'Microfones', path_from_root: [{ name: 'Instrumentos Musicais' }, { name: 'Microfones' }], settings: { catalog_domain: 'MLB-MICROPHONES' } } }
    : { ok: true, status: 200, data: [{ domain_id: 'MLB-MICROPHONES', category_id: 'MLB4469' }] } });
  assert.equal(resolved.decision, 'PASS');
  assert.equal(resolved.catalogProductId, 'MLB1');
  assert.equal(resolved.categoryId, 'MLB4469');
});

test('blocks professional 18-inch speaker mapped to tablet internal-speaker category', () => {
  const local = product(8, {
    nome: 'Alto-falante 18 Pol 1500W RMS 8 Ohms 18LF3000B-8 ATK',
    marca: 'Atk Eletroacústica',
    categoria: 'Acessórios Para Veículos > Som Automotivo > Alto Falantes',
    largura: 48,
    peso_bruto: 16.58,
  });
  const assessment = categorySemanticAssessment({
    product: local,
    dslite: { product: { categoria_nome: local.categoria } },
    catalog: { domain_id: 'MLB-TABLET_INTERNAL_SPEAKERS' },
    category: {
      name: 'Alto-Falantes',
      path_from_root: [{ name: 'Informática' }, { name: 'Tablets e Acessórios' }, { name: 'Peças' }, { name: 'Alto-Falantes' }],
      settings: { catalog_domain: 'MLB-TABLET_INTERNAL_SPEAKERS' },
    },
  });
  assert.equal(assessment.passed, false);
  assert.ok(assessment.conflicts.includes('LOCAL_VEHICLE_REMOTE_COMPUTING'));
  assert.ok(assessment.conflicts.includes('PROFESSIONAL_SPEAKER_REMOTE_TABLET_PART'));
});
