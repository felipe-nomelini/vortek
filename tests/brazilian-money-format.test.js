const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { InputNumber } = require('antd');
const load = require('./helpers/load-integration-module');

const { currencyFormatter, currencyInputProps, currencyParser, formatCurrency, parseBrazilianCurrency } = load('src/lib/format.ts');

test('valores monetários exibem milhar e decimal no formato brasileiro', () => {
  assert.match(formatCurrency(1234.56), /^R\$\s1\.234,56$/);
  assert.equal(currencyFormatter(1234.56), '1.234,56');
  assert.equal(currencyFormatter(0.05), '0,05');
  assert.equal(currencyFormatter(null), '');
  assert.equal(currencyFormatter(1234.56, { userTyping: true, input: '1.234,' }), '1.234,');
});

test('entrada brasileira retorna número para filtros e operações sem alterar o valor', () => {
  assert.equal(currencyParser('1.234,56'), 1234.56);
  assert.equal(currencyParser('0,05'), 0.05);
  assert.equal(currencyParser(''), '');
  assert.equal(parseBrazilianCurrency('R$ 1.234,56'), 1234.56);
  assert.equal(parseBrazilianCurrency('1.234'), 1234);
  assert.equal(parseBrazilianCurrency(''), null);
});

test('entrada ambígua ou malformada não vira outro preço', () => {
  for (const input of ['1,234.56', '1234.56', '12.34,56', '1.234,567', '1,2,3', 'abc']) {
    assert.equal(parseBrazilianCurrency(input), null, input);
    assert.ok(Number.isNaN(currencyParser(input)), input);
  }
});

test('campo monetário do Ant Design exibe o valor brasileiro já preenchido', () => {
  const html = renderToStaticMarkup(React.createElement(InputNumber, {
    ...currencyInputProps, prefix: 'R$', precision: 2, value: 1234.56,
  }));
  assert.match(html, /value="1\.234,56"/);
});
