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

test('nota do kit de 10 metros usa o SKU Bentevi e fatura 10 metros pelo total da venda', async () => {
  const pedido = {
    id: 'pedido-kit', numero: 124, total: 982.52, billing_nome: 'Cliente Teste',
    billing_documento: '07778845938', snapshot_incompleto: false,
    billing_endereco: {
      city_name: 'Curitiba', zip_code: '80000000', state_id: 'PR', cod_municipio: '4106902',
      street_name: 'Rua Um', street_number: '9', neighborhood: 'Centro',
    },
  };
  const rows = {
    pedidos: [pedido],
    pedido_itens: [{ seller_sku: 'VTK019036', titulo: 'Kit 10 metros cabo SAS 28 vias', quantidade: 1,
      valor_unitario: 982.52, valor_total_bruto: 982.52, ncm: '85444900' }],
    empresa: { cnpj: '33482950000230' },
  };
  const client = { from(table) {
    return {
      select() { return this; },
      in: async () => ({ data: rows[table] }),
      limit() { return this; },
      maybeSingle: async () => ({ data: rows[table] }),
    };
  } };
  const build = loadRouteFunction('buildBrasilNfePayloadFromSnapshot', {
    normalizeDocument: (value) => String(value || '').replace(/\D/g, ''),
    isValidCnpj: () => true,
    resolveBrasilNfeTipoAmbienteStrict: () => ({ ok: true, value: 1 }),
    normalizeUf: (value) => value,
    extractTaxpayerTypeFromBillingAddress: () => null,
    resolveDestIePolicy: () => ({ indicadorIe: 9, ieRequired: false, taxpayerTypeMlRaw: null, iePolicyResolved: 'nao_contribuinte', iePresent: false }),
    resolveEmitUfFromEmpresa: () => ({ emitUf: 'SP', source: 'empresa.uf_fiscal' }),
    expectedCfopByUf: () => 6120,
    resolveModalidadeFreteFromSnapshot: () => ({ value: 2, expectedOnly: 2, source: 'snapshot', degraded: false }),
    resolveSimpleKitOrderPlan: async () => ({ kind: 'ready', plan: {
      componentQuantity: 10, componentDsliteProductId: '229965',
      componentUnit: 'M',
      componentTitle: 'Cabo Santo Angelo SAS 28 Vias - metro', componentNcm: '85444900', componentGtin: '7899028808070',
    } }),
    resolveProdutoValorTotalBruto: () => 982.52,
    normalizeBrasilNfeProductName: (value) => value,
    normalizeBrasilNfeClientName: (value) => value,
  });
  const result = await build({ client, pedidoId: pedido.id });
  assert.equal(result.ok, true);
  assert.equal(result.payload.Produtos[0].CodProdutoServico, 'VTK019036');
  assert.equal(result.payload.Produtos[0].Quantidade, 10);
  assert.equal(result.payload.Produtos[0].UnidadeComercial, 'M');
  assert.equal(result.payload.Produtos[0].ValorUnitario, 98.252);
  assert.equal(result.payload.Produtos[0].ValorTotal, 982.52);
});

function loadKitSources(items, plans) {
  const client = { from(table) {
    assert.equal(table, 'pedido_itens');
    return {
      select(column) { assert.equal(column, 'seller_sku'); return this; },
      in: async () => ({ data: items.map((seller_sku) => ({ seller_sku })), error: null }),
    };
  } };
  const load = loadRouteFunction('loadPinnedKitSourcesForOrder', {
    resolveSimpleKitOrderPlan: async (_client, sku) => plans[sku] || { kind: 'not_kit' },
  });
  return load(client, ['pedido-kit']);
}

test('kit BKR1 é reconhecido no XML pelo SKU Bentevi e pelo código DSLite', async () => {
  const bkr1 = { id: 'oferta-bkr1', dslite_fornecedor_id: '108', dslite_produto_id: '2068' };
  const mks = { id: 'oferta-mks', dslite_fornecedor_id: '115', dslite_produto_id: '2068' };
  const plan = {
    supplierId: '108', supplierName: 'BKR1', componentDsliteProductId: '2068',
    componentProductId: 'componente', sourceOfferId: bkr1.id, sourceOffer: bkr1,
  };
  const sources = await loadKitSources(['VTK016131', 'ITEM-COMUM'], {
    VTK016131: { kind: 'ready', plan },
  });
  const extractLines = loadRouteFunction('extractNfeProductLines', {
    extractXmlTag: (block, tag) => block.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1] || null,
  });
  for (const code of ['VTK016131', '2068']) {
    const lines = extractLines(`<det><prod><cProd>${code}</cProd><qCom>4.0000</qCom></prod></det>`);
    assert.deepEqual(lines, [{ sku: code, quantity: 4 }]);
    assert.equal(sources.get(lines[0].sku).sourceOffer, bkr1);
    assert.notEqual(sources.get(lines[0].sku).sourceOffer, mks);
  }
  assert.equal(sources.has('ITEM-COMUM'), false);
});

test('código fiscal ambíguo não escolhe silenciosamente outra oferta', async () => {
  const kit = (supplierId, sourceOfferId, componentDsliteProductId) => ({ kind: 'ready', plan: {
    supplierId, supplierName: supplierId, sourceOfferId, componentDsliteProductId,
    sourceOffer: { id: sourceOfferId, dslite_fornecedor_id: supplierId },
  } });
  await assert.rejects(loadKitSources(['KIT-A', 'KIT-B'], {
    'KIT-A': kit('108', 'oferta-a', '2068'),
    'KIT-B': kit('108', 'oferta-b', '2068'),
  }), /Código fiscal 2068 identifica ofertas incompatíveis/);
  await assert.rejects(loadKitSources(['KIT-A', '2068'], {
    'KIT-A': kit('108', 'oferta-a', '2068'),
  }), /ambíguo entre kit e item comum/);
  await assert.rejects(loadKitSources(['KIT-A', 'KIT-B'], {
    'KIT-A': kit('108', 'oferta-a', '2068'),
    'KIT-B': kit('115', 'oferta-b', '9999'),
  }), /Kits do pedido exigem fornecedores diferentes/);
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
