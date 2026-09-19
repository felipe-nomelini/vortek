const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const {
  loadEvolusomCatalogPage,
  mapEvolusomProduct,
  evolusomRequest,
} = require('../src/services/evolusom.ts');

test('catalogo usa somente preço e estoque PR e preserva SKU', () => {
  const item = mapEvolusomProduct({
    codigo: 141111,
    nome: 'Produto de exemplo',
    tabelas: {
      PR: { preco: 123.45, estoque: 7, ipi: 0 },
      ES: { preco: 99, estoque: 200 },
    },
  });
  assert.equal(item.produtoid, '141111');
  assert.equal(item.produtoid_empresa, '141111');
  assert.equal(item.preco_crossdocking, 123.45);
  assert.equal(item.estoque, 7);
});

test('produto sem tabela PR não pode zerar oferta existente', () => {
  assert.throws(() => mapEvolusomProduct({
    codigo: 141111,
    nome: 'Produto de exemplo',
    tabelas: { ES: { preco: 99, estoque: 200 } },
  }), /inválido/);
});

test('cliente usa token privado, paginação suportada e nunca chama o domínio DSLite', async (t) => {
  const originalToken = process.env.EVOLUSOM_API_TOKEN;
  const originalFetch = global.fetch;
  process.env.EVOLUSOM_API_TOKEN = 'synthetic-test-token';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: [], meta: { total: 0, current_page: 2, per_page: 100 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.EVOLUSOM_API_TOKEN;
    else process.env.EVOLUSOM_API_TOKEN = originalToken;
  });
  const result = await loadEvolusomCatalogPage(2, 1);
  assert.equal(result.pageSize, 100);
  assert.equal(calls[0].url, 'https://api2.evolusom.com.br/v1/produtos/cliente?page=2&per_page=100');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-test-token');
  assert.equal(result.total, 0);
  await assert.rejects(evolusomRequest('/other/path'), /Caminho Evolusom inválido/);
});

test('pedido triangular contém NF, etiqueta genérica, rastreio, custo PR e SKU contratado', () => {
  const source = fs.readFileSync(require.resolve('../src/services/evolusom-purchase.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(() => ({}), module, module.exports);
  const xml = `<nfeProc><NFe><infNFe><ide><serie>1</serie><nNF>2439</nNF><dhEmi>2026-09-18T10:30:00-03:00</dhEmi></ide><dest><xNome>Comprador Teste</xNome><CPF>07778845938</CPF><enderDest><xLgr>Rua Um</xLgr><nro>9</nro><xBairro>Centro</xBairro><xMun>Curitiba</xMun><UF>PR</UF><CEP>80000000</CEP></enderDest></dest><det nItem="1"><prod><cProd>141111</cProd><vUnCom>679.90</vUnCom></prod><imposto><vST>0</vST><vIPI>0</vIPI></imposto></det><total><ICMSTot><vNF>679.90</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>41260912345678000190550010000024391000024395</chNFe></infProt></protNFe></nfeProc>`;
  const payload = module.exports.buildEvolusomTriangularPayload({
    orderCode: 'BNT-123', companyCnpj: '33.482.950/0002-30', xml,
    email: 'comprador@example.com', phone: '(41) 99999-9999',
    trackingNumber: 'AB123BR', labelUrl: 'https://app.bentevi.shop/api/public/etiquetas/pedido?token=synthetic&format=placeholder_evolusom',
    danfeUrl: 'https://app.bentevi.shop/api/public/notas-fiscais/pedido/danfe?token=synthetic',
    products: [{ sku: '141111', quantity: 1, cost: 579.9, offerId: 'synthetic' }],
  });
  assert.equal(payload.codigo_pedido, 'BNT-123');
  assert.equal(payload.transporte.tipo, 0);
  assert.equal(payload.transporte.codrastreio, 'AB123BR');
  assert.equal(payload.itens[0].cod_produto, '141111');
  assert.equal(payload.itens[0].preco_revenda, 579.9);
  assert.equal(payload.itens[0].preco_cliente_final, 679.9);
  assert.equal(payload.nfe.valor, 679.9);
  assert.throws(() => module.exports.buildEvolusomTriangularPayload({
    orderCode: 'BNT-123', companyCnpj: '33.482.950/0002-30', xml,
    email: 'comprador@example.com', phone: '(41) 99999-9999', trackingNumber: '',
    labelUrl: payload.transporte.urletiqueta, danfeUrl: payload.nfe.url,
    products: [{ sku: '141111', quantity: 1, cost: 579.9, offerId: null }],
  }), /rastreio/);
});

test('etiqueta genérica é servida em link público assinado sem login', async () => {
  const source = fs.readFileSync(require.resolve('../src/app/api/public/etiquetas/[id]/route.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'synthetic', numero: 1 }, error: null }) }) }) }) };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/lib/supabase': { createServiceClient: () => db },
    '@/lib/shipping-label-storage': {},
    '@/lib/public-shipping-label-links': { verifyPublicShippingLabelToken: () => true },
    '@/lib/shipping-label-pdf': {},
    '@/lib/dslite/placeholder-label': { loadDslitePlaceholderLabel: async () => Buffer.from('%PDF-synthetic') },
  };
  new Function('require', 'module', 'exports', compiled)((id) => mocks[id], module, module.exports);
  const response = await module.exports.GET(
    new Request('https://app.bentevi.shop/api/public/etiquetas/synthetic?token=synthetic&format=placeholder_evolusom'),
    { params: Promise.resolve({ id: 'synthetic' }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(await response.text(), /^%PDF/);
});
