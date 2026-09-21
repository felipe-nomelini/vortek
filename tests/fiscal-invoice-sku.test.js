const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/app/api/dslite/pedido/route.ts'), 'utf8');
const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

function loadRouteFunction(name, mocks) {
  const functionNode = file.statements.find((node) => ts.isFunctionDeclaration(node)
    && node.name?.text === name);
  assert.ok(functionNode);
  const compiled = ts.transpileModule(`${functionNode.getText(file)}\nexports.run = ${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function(...Object.keys(mocks), 'exports', compiled)(...Object.values(mocks), exports);
  return exports.run;
}

test('nota de venda usa o SKU Bentevi mesmo quando a oferta tem outro código no fornecedor', async () => {
  const pedido = {
    id: 'pedido-1', numero: 123, total: 190.62, billing_nome: 'Cliente Teste',
    billing_documento: '07778845938', snapshot_incompleto: false,
    billing_endereco: {
      city_name: 'Curitiba', zip_code: '80000000', state_id: 'PR', cod_municipio: '4106902',
      street_name: 'Rua Um', street_number: '9', neighborhood: 'Centro',
    },
  };
  const item = {
    seller_sku: 'VTK021855', titulo: 'Produto de teste', quantidade: 1,
    valor_unitario: 190.62, valor_total_bruto: 190.62, ncm: '92089000',
  };
  const rows = { pedidos: [pedido], pedido_itens: [item], empresa: { cnpj: '33482950000230' } };
  const client = { from(table) {
    assert.ok(table in rows, `Consulta inesperada a ${table}`);
    return {
      select() { return this; },
      in: async () => ({ data: rows[table] }),
      limit() { return this; },
      maybeSingle: async () => ({ data: rows[table] }),
    };
  } };
  const mocks = {
    normalizeDocument: (value) => String(value || '').replace(/\D/g, ''),
    isValidCnpj: () => true,
    resolveBrasilNfeTipoAmbienteStrict: () => ({ ok: true, value: 1 }),
    normalizeUf: (value) => value,
    extractTaxpayerTypeFromBillingAddress: () => null,
    resolveDestIePolicy: () => ({ indicadorIe: 9, ieRequired: false, taxpayerTypeMlRaw: null, iePolicyResolved: 'nao_contribuinte', iePresent: false }),
    resolveEmitUfFromEmpresa: () => ({ emitUf: 'SP', source: 'empresa.uf_fiscal' }),
    expectedCfopByUf: () => 6120,
    resolveModalidadeFreteFromSnapshot: () => ({ value: 2, expectedOnly: 2, source: 'snapshot', degraded: false }),
    resolveSimpleKitOrderPlan: async () => ({ kind: 'not_kit' }),
    resolveDsliteProductCodeForNfe: async () => '380381',
    resolveProdutoValorTotalBruto: () => 190.62,
    normalizeBrasilNfeProductName: (value) => value,
    normalizeBrasilNfeClientName: (value) => value,
  };
  const build = loadRouteFunction('buildBrasilNfePayloadFromSnapshot', mocks);
  const result = await build({ client, pedidoId: pedido.id });
  assert.equal(result.ok, true);
  assert.equal(result.payload.Produtos[0].CodProdutoServico, 'VTK021855');
});

test('SKU Bentevi da NF-e ainda identifica a oferta com código próprio do fornecedor', async () => {
  const product = { id: 'product-1', sku: 'VTK021855', ativo: true, oferta_preferencial_id: 'offer-1' };
  const offer = { id: 'offer-1', produto_id: product.id, dslite_produto_id: '380381', dslite_fornecedor_id: '133' };
  const client = { from(table) {
    return {
      select() { return this; },
      in(column, values) {
        assert.equal(table, 'produtos');
        assert.equal(column, 'sku');
        assert.ok(values.includes(product.sku));
        return this;
      },
      limit() { return this; },
      maybeSingle: async () => ({ data: product }),
      eq(column, value) {
        assert.equal(table, 'produto_fornecedor_ofertas');
        assert.equal(column, 'produto_id');
        assert.equal(value, product.id);
        return Promise.resolve({ data: [offer] });
      },
    };
  } };
  const resolve = loadRouteFunction('resolvePedidoSupplierOffer', {
    loadOperationalDropshippingSupplierIds: async () => ['133'],
    getSkuLookupVariants: (sku) => [sku],
    filterOperationalDropshippingSupplierOffers: (offers) => offers,
    resolvePreferredOfferForProduct: (offers) => offers[0] || null,
  });
  const result = await resolve({ client, sku: product.sku });
  assert.equal(result.productId, product.id);
  assert.equal(result.offer.dslite_produto_id, '380381');
});
