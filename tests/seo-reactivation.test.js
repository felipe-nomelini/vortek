const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSeoTitle,
  calculateSeoReactivationProfit,
  chooseReactivationOffer,
  evaluateReactivationCandidate,
  evaluateSeoCandidate,
  normalizeSeoTitleForComparison,
  sanitizeSeoTitle,
  validateSeoTitle,
} = require('../src/lib/ml/seo-reactivation.ts');

test('calcula lucro com imposto operacional de 4%', () => {
  assert.equal(calculateSeoReactivationProfit({
    price: 100,
    cost: 50,
    shipping: 10,
    mlFee: 0.15,
  }), 21);
});

test('reativação exige lucro, venda, estoque e estado seguros', () => {
  const base = {
    localStatus: 'pausado',
    liveStatus: 'paused',
    liveSubStatus: ['out_of_stock'],
    soldQuantity: 1,
    profit: 15,
    stock: 2,
    hasPictures: true,
    hasVariations: false,
    blocked: false,
  };
  assert.equal(evaluateReactivationCandidate(base).eligible, true);
  assert.equal(evaluateReactivationCandidate({ ...base, profit: 14.99 }).reason, 'profit_below_15');
  assert.equal(evaluateReactivationCandidate({ ...base, soldQuantity: 0 }).reason, 'without_sales_history');
  assert.equal(evaluateReactivationCandidate({ ...base, stock: 0 }).reason, 'supplier_without_stock');
  assert.equal(evaluateReactivationCandidate({ ...base, liveSubStatus: ['held'] }).reason, 'live_sub_status_blocked');
});

test('SEO exige ativo, zero vendas, visita, lucro e fora do catálogo', () => {
  const base = {
    localStatus: 'ativo',
    liveStatus: 'active',
    soldQuantity: 0,
    visits: 1,
    profit: 10.01,
    catalogListing: false,
    blocked: false,
  };
  assert.equal(evaluateSeoCandidate(base).eligible, true);
  assert.equal(evaluateSeoCandidate({ ...base, visits: 0 }).reason, 'without_visits');
  assert.equal(evaluateSeoCandidate({ ...base, soldQuantity: 1 }).reason, 'has_sales');
  assert.equal(evaluateSeoCandidate({ ...base, profit: 10 }).reason, 'profit_not_above_10');
  assert.equal(evaluateSeoCandidate({ ...base, catalogListing: true }).reason, 'catalog_title_managed');
});

test('título remove claims, pontuação e repetição consecutiva', () => {
  assert.equal(
    sanitizeSeoTitle('Ferro / Agratto - Original Original | Pronta Entrega + Com NF Agratto'),
    'Ferro Agratto',
  );
});

test('preserva especificações repetidas não consecutivas e medidas numéricas', () => {
  assert.equal(
    sanitizeSeoTitle('Kit 2 Alto-falantes 150w 8 Pol 8 Ohms'),
    'Kit 2 Alto falantes 150w 8 Pol 8 Ohms',
  );
  assert.equal(sanitizeSeoTitle('Viola 4/4 Alan'), 'Viola 4 4 Alan');
  assert.equal(sanitizeSeoTitle('Cabo P2 P2 estéreo'), 'Cabo P2 P2 estéreo');
  assert.equal(sanitizeSeoTitle('Cabo Xlr Xlr Atk Atk'), 'Cabo Xlr Xlr Atk');
});

test('título inclui marca e modelo comprovados dentro do limite', () => {
  const title = buildSeoTitle({
    productName: 'Ferro De Passar Agratto Facile FF01 Antiaderente Com Regulagem De Temperatura',
    currentTitle: 'Ferro De Passar Antiaderente',
    brand: 'Agratto',
    model: 'Facile FF01',
    maxLength: 60,
  });
  assert.ok(title.length <= 60);
  assert.match(title, /Agratto/);
  assert.match(title, /Facile/);
  assert.deepEqual(validateSeoTitle(title), { ok: true });
});

test('preserva título ML e não repete modelo já distribuído no texto', () => {
  assert.equal(buildSeoTitle({
    productName: 'Caixa de Som Sumay CAP49 Energy Box 1600w Bluetooth Preta',
    currentTitle: 'Caixa Som Sumay Energy Box Cap49 1600w Bluetooth',
    brand: 'Sumay',
    model: 'Energy Box CAP49',
  }), 'Caixa Som Sumay Energy Box Cap49 1600w Bluetooth');
});

test('comparação semântica ignora pontuação e capitalização', () => {
  assert.equal(
    normalizeSeoTitleForComparison('Fone Bluetooth 5.4 Modelo-X'),
    normalizeSeoTitleForComparison('fone bluetooth 5 4 modelo x'),
  );
});

test('não acrescenta complemento parcial quando frase inteira não cabe', () => {
  assert.equal(buildSeoTitle({
    productName: '',
    currentTitle: 'Tv Stick Proeletronic Prosk 1000 4k 2gb 16gb Preto',
    brand: 'Proeletronic',
    model: 'Stick Pro 4K HD',
    maxLength: 60,
  }), 'Tv Stick Proeletronic Prosk 1000 4k 2gb 16gb Preto');
});

test('não acrescenta modelo genérico ou somente numérico', () => {
  assert.equal(buildSeoTitle({
    productName: '',
    currentTitle: 'Fogão Elétrico Agratto Dois Pratos 2500w',
    brand: 'Agratto',
    model: '02',
  }), 'Fogão Elétrico Agratto Dois Pratos 2500w');
  assert.equal(buildSeoTitle({
    productName: '',
    currentTitle: 'Calculadora Casio 12 Dígitos',
    brand: 'Casio',
    model: 'WE',
  }), 'Calculadora Casio 12 Dígitos');
});

test('acrescenta apenas a parte útil ausente do modelo comprovado', () => {
  assert.equal(buildSeoTitle({
    productName: 'Ferro De Solda Brasfort Maxx 9068 180w 220v Com Suporte',
    currentTitle: 'Ferro De Solda Brasfort Maxx 180w 220v Com Suporte',
    brand: 'Brasfort',
    model: 'Maxx 9068',
  }), 'Ferro De Solda Brasfort Maxx 180w 220v Com Suporte 9068');
  assert.equal(buildSeoTitle({
    productName: 'Violão Giannini GTG 36S EQ Travel Aço Natural',
    currentTitle: 'Violão Giannini Gtg 36s Eq Travel Aço Natural',
    brand: 'Giannini',
    model: 'GTG 36S EQ NS',
  }), 'Violão Giannini Gtg 36s Eq Travel Aço Natural');
});

test('não acrescenta marca ou modelo sem confirmação no produto interno', () => {
  assert.equal(buildSeoTitle({
    productName: 'Cabo Lan Megacabos Cat5e 8 Vias Interno 1km',
    currentTitle: 'Cabo Lan Megacabos Cat5e 8 Vias Interno 1km',
    brand: 'Megatron',
    model: 'Cat 5E',
  }), 'Cabo Lan Megacabos Cat5e 8 Vias Interno 1km');
  assert.equal(buildSeoTitle({
    productName: 'Cabo Paralelo Technoise Cobre 2x4mm Cristal 50m',
    currentTitle: 'Cabo Paralelo Technoise Cobre 2x4mm Cristal 50m',
    brand: 'Technoise',
    model: '00MM',
  }), 'Cabo Paralelo Technoise Cobre 2x4mm Cristal 50m');
});

test('validador rejeita limite, caracteres e afirmações sem evidência', () => {
  assert.equal(validateSeoTitle('Produto - Marca').reason, 'title_forbidden_character');
  assert.equal(validateSeoTitle('Produto Original Marca').reason, 'title_original_without_evidence');
  assert.equal(validateSeoTitle('Produto Pronta Entrega').reason, 'title_forbidden_claim');
  assert.equal(validateSeoTitle('A'.repeat(61)).reason, 'title_too_long');
});

test('oferta manual não troca fornecedor e automática escolhe menor custo', () => {
  const offers = [
    { id: 'a', active: true, stock: 2, cost: 20, priority: 1 },
    { id: 'b', active: true, stock: 5, cost: 15, priority: 2 },
  ];
  assert.equal(chooseReactivationOffer(offers, 'a', true)?.id, 'a');
  assert.equal(chooseReactivationOffer(offers, 'missing', true), null);
  assert.equal(chooseReactivationOffer(offers, null, false)?.id, 'b');
});
