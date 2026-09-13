const assert = require('node:assert/strict');
const test = require('node:test');

const {
  catalogAttributeMismatches,
  catalogLocalCriticalMismatches,
} = require('../src/lib/ml-catalog-compatibility.ts');

test('aceita modelo exato corroborado pelo título quando o atributo do catálogo é genérico', () => {
  const mismatches = catalogAttributeMismatches(
    { attributes: [{ id: 'MODEL', value_name: 'TA-821BS' }] },
    {
      name: 'Acordeon 8 Baixos 21 Botões TA-821BS Vermelho Thommasi',
      attributes: [{ id: 'MODEL', value_id: '49747067', value_name: '8 baixos 21 botões vermelho' }],
    },
  );
  assert.equal(mismatches.some(row => row.id === 'MODEL'), false);
});

test('mantém bloqueio quando modelo não coincide com atributo nem título do catálogo', () => {
  const mismatches = catalogAttributeMismatches(
    { attributes: [{ id: 'MODEL', value_name: 'TB-200P' }] },
    {
      name: 'Trombone de Pistões NY Tenor MUSIC42361',
      attributes: [{ id: 'MODEL', value_id: '123', value_name: 'MUSIC42361' }],
    },
  );
  assert.equal(mismatches.some(row => row.id === 'MODEL'), true);
});

test('bloqueia catálogo de 20 pilhas para cartela local com 4 pilhas', () => {
  const mismatches = catalogLocalCriticalMismatches(
    { nome: 'Pilha Alcalina Energizer Max AA Cartela com 4 Pilhas' },
    { name: 'Pilha Alcalina Energizer Max AA Pequena 20 Pilhas' },
  );

  assert.deepEqual(mismatches[0], {
    id: 'TITLE_PACK_QUANTITY',
    name: 'Quantidade do kit no título',
    itemValue: '4',
    catalogValue: '20',
  });
});

test('aceita catálogo quando a quantidade física é a mesma', () => {
  const mismatches = catalogLocalCriticalMismatches(
    { nome: 'Kit 20 Pilhas Alcalinas AA' },
    { name: 'Pilha Alcalina AA Kit com 20 Unidades' },
  );

  assert.equal(mismatches.some((row) => row.id === 'TITLE_PACK_QUANTITY'), false);
});

test('reconhece quantidade escrita como cartela e blister', () => {
  const cartela = catalogLocalCriticalMismatches(
    { nome: 'Bateria CR2032 Cartela com 5' },
    { name: 'Bateria CR2032 Cartela com 10' },
  );
  const blister = catalogLocalCriticalMismatches(
    { nome: 'Pilha AAA Blister 2' },
    { name: 'Pilha AAA Blister 4' },
  );

  assert.equal(cartela.some((row) => row.id === 'TITLE_PACK_QUANTITY'), true);
  assert.equal(blister.some((row) => row.id === 'TITLE_PACK_QUANTITY'), true);
});

test('não confunde códigos de modelo com quantidade', () => {
  const mismatches = catalogLocalCriticalMismatches(
    { nome: 'Caixa JBL C321P' },
    { name: 'Caixa JBL C321P 60W' },
  );

  assert.equal(mismatches.some((row) => row.id === 'TITLE_PACK_QUANTITY'), false);
});

test('reconhece abreviações C/40 e 10 Un', () => {
  const packageMismatch = catalogLocalCriticalMismatches(
    { nome: 'Pilha AAA C/40 Pilhas' },
    { name: 'Pilha AAA Kit com 4 Unidades' },
  );
  const sameQuantity = catalogLocalCriticalMismatches(
    { nome: 'Conector P10 10 Un' },
    { name: 'Conector P10 10 Unidades' },
  );

  assert.equal(packageMismatch.some((row) => row.id === 'TITLE_PACK_QUANTITY'), true);
  assert.equal(sameQuantity.some((row) => row.id === 'TITLE_PACK_QUANTITY'), false);
});

test('bloqueia atributos que representam quantidade física diferente do título local', () => {
  const mismatches = catalogLocalCriticalMismatches(
    { nome: '192 Pilhas Alcalinas AAA Panasonic' },
    {
      name: '192 Pilhas Alcalinas AAA Panasonic',
      attributes: [
        { id: 'UNITS_PER_PACK', value_name: '6' },
        { id: 'PACKS_NUMBER', value_name: '1' },
      ],
    },
  );

  assert.deepEqual(mismatches.find((row) => row.id === 'PACK_QUANTITY_ATTRIBUTES'), {
    id: 'PACK_QUANTITY_ATTRIBUTES',
    name: 'Quantidade física do kit nos atributos',
    itemValue: '192',
    catalogValue: '6',
  });
});

test('multiplica unidades por kit pela quantidade de kits', () => {
  const mismatch = catalogLocalCriticalMismatches(
    { nome: '50 Baterias CR2016 Panasonic' },
    {
      name: '50 Baterias CR2016 Panasonic',
      attributes: [
        { id: 'UNITS_PER_PACK', value_name: '50' },
        { id: 'PACKS_NUMBER', value_name: '10' },
      ],
    },
  );
  const valid = catalogLocalCriticalMismatches(
    { nome: 'Kit 2 Pilhas CR2032' },
    {
      name: 'Kit 2 Pilhas CR2032',
      attributes: [
        { id: 'UNITS_PER_PACK', value_name: '2' },
        { id: 'PACKS_NUMBER', value_name: '1' },
      ],
    },
  );

  assert.equal(mismatch.some((row) => row.id === 'PACK_QUANTITY_ATTRIBUTES'), true);
  assert.equal(valid.some((row) => row.id === 'PACK_QUANTITY_ATTRIBUTES'), false);
});
