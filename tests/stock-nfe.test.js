const assert = require('node:assert/strict');
const test = require('node:test');

const { extractNfeAccessKey, isValidNfeAccessKey, parseAuthorizedStockNfeXml } = require('../src/lib/estoque-nfe.ts');

function withCheckDigit(first43) {
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(first43[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return first43 + (remainder < 2 ? 0 : 11 - remainder);
}

const key = withCheckDigit('3326091234567800012355001000000123112345678');
const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${key}"><ide><tpAmb>2</tpAmb><serie>1</serie><nNF>123</nNF><dhEmi>2026-09-01T12:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000123</CNPJ><xNome>Fornecedor Teste</xNome></emit><dest><CNPJ>98765432000198</CNPJ><xNome>Bentevi</xNome></dest><det nItem="1"><prod><cProd>ABC-1</cProd><cEAN>7891234567895</cEAN><xProd>Produto de teste</xProd><qCom>2.0000</qCom></prod></det><total><ICMSTot><vNF>199.90</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test('valida e extrai chave da NF-e lida por código de barras', () => {
  assert.equal(isValidNfeAccessKey(key), true);
  assert.equal(extractNfeAccessKey(`chave: ${key}`), key);
  assert.equal(extractNfeAccessKey(key.slice(0, 43) + ((Number(key[43]) + 1) % 10)), null);
});

test('interpreta somente XML autorizado, no ambiente e destinatário esperados', () => {
  const result = parseAuthorizedStockNfeXml({ xml, expectedKey: key, expectedEnvironment: 2, expectedRecipientCnpj: '98.765.432/0001-98' });
  assert.equal(result.numero, '123');
  assert.equal(result.emitenteCnpj, '12345678000123');
  assert.equal(result.valorTotal, 199.9);
  assert.deepEqual(result.itens[0], { numeroItem: 1, codigoFornecedor: 'ABC-1', gtin: '7891234567895', descricao: 'Produto de teste', quantidade: 2 });
});

test('bloqueia ambiente, destinatário e quantidade fracionada divergentes', () => {
  assert.throws(() => parseAuthorizedStockNfeXml({ xml, expectedKey: key, expectedEnvironment: 1, expectedRecipientCnpj: '98765432000198' }), /outro ambiente/);
  assert.throws(() => parseAuthorizedStockNfeXml({ xml, expectedKey: key, expectedEnvironment: 2, expectedRecipientCnpj: '11111111000111' }), /CNPJ destinatário/);
  assert.throws(() => parseAuthorizedStockNfeXml({ xml: xml.replace('<qCom>2.0000</qCom>', '<qCom>1.5</qCom>'), expectedKey: key, expectedEnvironment: 2, expectedRecipientCnpj: '98765432000198' }), /fracionada/);
});
