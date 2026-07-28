const assert = require('node:assert/strict');
const test = require('node:test');

const {
  choosePreferredOffer,
  resolvePreferredOfferForProduct,
} = require('../src/lib/preferred-offer.ts');

test('troca fornecedor atual por alternativa ativa mais barata com estoque', () => {
  const offers = [
    { id: 'hayamax', ativo: true, estoque: 15, custo: 82.67, prioridade: 100 },
    { id: 'evolusom', ativo: true, estoque: 7, custo: 77.6, prioridade: 100 },
  ];

  assert.equal(resolvePreferredOfferForProduct(offers, 'hayamax')?.id, 'evolusom');
});

test('não escolhe oferta sem estoque quando existe alternativa com estoque', () => {
  const offers = [
    { id: 'sem-estoque', ativo: true, estoque: 0, custo: 50, prioridade: 100 },
    { id: 'com-estoque', ativo: true, estoque: 2, custo: 60, prioridade: 100 },
  ];

  assert.equal(choosePreferredOffer(offers)?.id, 'com-estoque');
});

test('não trata custo zero como oferta válida', () => {
  const offers = [
    { id: 'invalida', ativo: true, estoque: 10, custo: 0, prioridade: 1 },
    { id: 'valida', ativo: true, estoque: 2, custo: 70, prioridade: 100 },
  ];

  assert.equal(choosePreferredOffer(offers)?.id, 'valida');
});

test('usa prioridade e estoque somente para desempate de custo', () => {
  const offers = [
    { id: 'mais-estoque', ativo: true, estoque: 10, custo: 70, prioridade: 100 },
    { id: 'mais-prioritaria', ativo: true, estoque: 2, custo: 70, prioridade: 10 },
  ];

  assert.equal(choosePreferredOffer(offers)?.id, 'mais-prioritaria');
});
