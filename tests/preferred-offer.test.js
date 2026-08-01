const assert = require('node:assert/strict');
const test = require('node:test');

const {
  choosePreferredOffer,
  resolvePreferredOfferForProduct,
  shouldReconcilePreferredOfferCandidate,
} = require('../src/lib/preferred-offer.ts');

test('troca fornecedor atual por alternativa ativa mais barata com estoque', () => {
  const offers = [
    { id: 'hayamax', ativo: true, estoque: 15, custo: 82.67, prioridade: 100 },
    { id: 'evolusom', ativo: true, estoque: 7, custo: 77.6, prioridade: 100 },
  ];

  assert.equal(resolvePreferredOfferForProduct(offers, 'hayamax')?.id, 'evolusom');
});

test('mantém fornecedor manual mesmo quando alternativa possui menor custo', () => {
  const offers = [
    { id: 'manual', ativo: true, estoque: 4, custo: 90 },
    { id: 'barata', ativo: true, estoque: 8, custo: 70 },
  ];

  assert.equal(resolvePreferredOfferForProduct(offers, 'manual', true)?.id, 'manual');
});

test('mantém fornecedor manual sem estoque para refletir indisponibilidade escolhida', () => {
  const offers = [
    { id: 'manual', ativo: true, estoque: 0, custo: 90 },
    { id: 'disponivel', ativo: true, estoque: 8, custo: 70 },
  ];

  assert.equal(resolvePreferredOfferForProduct(offers, 'manual', true)?.id, 'manual');
});

test('volta ao automático quando fornecedor manual fica inativo', () => {
  const offers = [
    { id: 'manual', ativo: false, estoque: 4, custo: 60 },
    { id: 'valida', ativo: true, estoque: 8, custo: 70 },
  ];

  assert.equal(resolvePreferredOfferForProduct(offers, 'manual', true)?.id, 'valida');
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

test('reconcilia alternativa com estoque e custo menor mesmo sem mudança no XML', () => {
  const product = {
    oferta_preferencial_id: 'hayamax',
    custo: 52.78,
    estoque: 15,
    fornecedor_atual_ativo: true,
  };
  const evolusom = { id: 'evolusom', ativo: true, custo: 50.5, estoque: 5 };

  assert.equal(shouldReconcilePreferredOfferCandidate(product, evolusom), true);
});

test('não reconcilia alternativa mais cara quando atual possui estoque', () => {
  const product = {
    oferta_preferencial_id: 'evolusom',
    custo: 50.5,
    estoque: 5,
    fornecedor_atual_ativo: true,
  };
  const hayamax = { id: 'hayamax', ativo: true, custo: 52.78, estoque: 15 };

  assert.equal(shouldReconcilePreferredOfferCandidate(product, hayamax), false);
});

test('reconcilia alternativa com estoque quando fornecedor atual está indisponível', () => {
  const product = {
    oferta_preferencial_id: 'atual',
    custo: 40,
    estoque: 0,
    fornecedor_atual_ativo: true,
  };
  const alternativa = { id: 'alternativa', ativo: true, custo: 50, estoque: 2 };

  assert.equal(shouldReconcilePreferredOfferCandidate(product, alternativa), true);
});

test('reconcilia alternativa com estoque quando fornecedor atual está inativo', () => {
  const product = {
    oferta_preferencial_id: 'atual',
    custo: 40,
    estoque: 3,
    fornecedor_atual_ativo: false,
  };
  const alternativa = { id: 'alternativa', ativo: true, custo: 50, estoque: 2 };

  assert.equal(shouldReconcilePreferredOfferCandidate(product, alternativa), true);
});

test('reconcilia fornecedor atual quando snapshot está obsoleto', () => {
  const product = {
    oferta_preferencial_id: 'evolusom',
    custo: 52.78,
    estoque: 15,
    fornecedor_atual_ativo: true,
  };
  const evolusom = { id: 'evolusom', ativo: true, custo: 50.5, estoque: 5 };

  assert.equal(shouldReconcilePreferredOfferCandidate(product, evolusom), true);
});

test('ignora alternativa inativa ou sem estoque quando atual está disponível', () => {
  const product = {
    oferta_preferencial_id: 'atual',
    custo: 50,
    estoque: 2,
    fornecedor_atual_ativo: true,
  };

  assert.equal(
    shouldReconcilePreferredOfferCandidate(product, {
      id: 'inativa',
      ativo: false,
      custo: 40,
      estoque: 3,
    }),
    false,
  );
  assert.equal(
    shouldReconcilePreferredOfferCandidate(product, {
      id: 'sem-estoque',
      ativo: true,
      custo: 40,
      estoque: 0,
    }),
    false,
  );
});

test('preferência manual ignora reconciliação de alternativa mais barata', () => {
  const product = {
    oferta_preferencial_id: 'manual',
    fornecedor_preferencial_manual: true,
    custo: 90,
    estoque: 4,
    fornecedor_atual_ativo: true,
  };

  assert.equal(shouldReconcilePreferredOfferCandidate(product, {
    id: 'barata',
    ativo: true,
    custo: 70,
    estoque: 8,
  }), false);
  assert.equal(shouldReconcilePreferredOfferCandidate(product, {
    id: 'manual',
    ativo: true,
    custo: 95,
    estoque: 3,
  }), true);
  assert.equal(shouldReconcilePreferredOfferCandidate(product, {
    id: 'manual',
    ativo: false,
    custo: 95,
    estoque: 0,
  }), true);
});
