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

test('erro HTTP 400 informa os campos rejeitados sem expor os valores do fornecedor', async (t) => {
  const originalToken = process.env.EVOLUSOM_API_TOKEN;
  const originalFetch = global.fetch;
  process.env.EVOLUSOM_API_TOKEN = 'synthetic-test-token';
  global.fetch = async () => new Response(JSON.stringify({
    message: 'Documento 12345678901 inválido para pessoa de teste',
    errors: {
      'cliente.documento': ['Documento 12345678901 inválido'],
      'cliente.email': ['Email pessoa@example.com obrigatório'],
      'itens.0.cod_produto': ['SKU 141111 indisponível'],
    },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.EVOLUSOM_API_TOKEN;
    else process.env.EVOLUSOM_API_TOKEN = originalToken;
  });
  await assert.rejects(evolusomRequest('/v1/pedidos/triangular', { method: 'POST', body: '{}' }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /cliente\.documento, cliente\.email, itens\.0\.cod_produto/);
    assert.doesNotMatch(error.message, /12345678901|pessoa@example\.com|141111/);
    return true;
  });
});

test('erro HTTP 400 com validação dentro de message identifica o campo rejeitado', async (t) => {
  const originalToken = process.env.EVOLUSOM_API_TOKEN;
  const originalFetch = global.fetch;
  process.env.EVOLUSOM_API_TOKEN = 'synthetic-test-token';
  global.fetch = async () => new Response(JSON.stringify({
    status: 400,
    message: { codigo_pedido: ['O campo codigo pedido deve ser um número.'] },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.EVOLUSOM_API_TOKEN;
    else process.env.EVOLUSOM_API_TOKEN = originalToken;
  });
  await assert.rejects(evolusomRequest('/v1/pedidos/triangular', { method: 'POST', body: '{}' }),
    (error) => {
      assert.match(error.message, /Campos rejeitados: codigo_pedido/);
      assert.deepEqual(error.responseBody, {
        status: 400,
        message: { codigo_pedido: ['O campo codigo pedido deve ser um número.'] },
      });
      return true;
    });
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
    orderCode: 123, orderedAt: '2026-09-21T14:55:41.000Z', companyCnpj: '33.482.950/0002-30', xml,
    email: 'comprador@example.com', phone: '(41) 99999-9999',
    trackingNumber: 'AB123BR', labelUrl: 'https://app.bentevi.shop/api/public/etiquetas/pedido?token=synthetic&format=placeholder_evolusom',
    danfeUrl: 'https://app.bentevi.shop/api/public/notas-fiscais/pedido/danfe?token=synthetic',
    products: [{ sku: '141111', quantity: 1, cost: 579.9, offerId: 'synthetic' }],
  });
  assert.equal(payload.codigo_pedido, 123);
  assert.equal(payload.data_pedido, '2026-09-21 11:55:41');
  assert.equal(payload.nfe.data_emissao, '2026-09-18 10:30:00');
  assert.equal(payload.transporte.tipo, 0);
  assert.equal(payload.transporte.codrastreio, 'AB123BR');
  assert.equal(payload.itens[0].cod_produto, '141111');
  assert.equal(payload.itens[0].preco_revenda, 579.9);
  assert.equal(payload.itens[0].preco_cliente_final, 679.9);
  assert.equal(payload.nfe.valor, 679.9);
  assert.throws(() => module.exports.buildEvolusomTriangularPayload({
    orderCode: 123, orderedAt: '2026-09-21T14:55:41.000Z', companyCnpj: '33.482.950/0002-30', xml,
    email: 'comprador@example.com', phone: '(41) 99999-9999', trackingNumber: '',
    labelUrl: payload.transporte.urletiqueta, danfeUrl: payload.nfe.url,
    products: [{ sku: '141111', quantity: 1, cost: 579.9, offerId: null }],
  }), /rastreio/);
  const withoutContact = module.exports.buildEvolusomTriangularPayload({
    orderCode: 124, orderedAt: '2026-09-21T14:55:41.000Z', companyCnpj: '33.482.950/0002-30', xml,
    email: null, phone: null, trackingNumber: 'AB123BR',
    labelUrl: payload.transporte.urletiqueta, danfeUrl: payload.nfe.url,
    products: [{ sku: '141111', quantity: 1, cost: 579.9, offerId: null }],
  });
  assert.equal(withoutContact.cliente.email, null);
  const localSkuXml = xml.replace('<cProd>141111</cProd>', '<cProd>VTK021855</cProd>');
  const withLocalSku = module.exports.buildEvolusomTriangularPayload({
    orderCode: 125, orderedAt: '2026-09-21T14:55:41.000Z', companyCnpj: '33.482.950/0002-30',
    xml: localSkuXml, email: null, phone: null, trackingNumber: 'AB123BR',
    labelUrl: payload.transporte.urletiqueta, danfeUrl: payload.nfe.url,
    products: [{ sku: '380381', invoiceSku: 'VTK021855', quantity: 1, cost: 579.9, offerId: 'synthetic' }],
  });
  assert.equal(withLocalSku.itens[0].cod_produto, '380381');
  assert.equal(withLocalSku.itens[0].preco_cliente_final, 679.9);
  assert.equal(withoutContact.cliente.telefone, null);
  assert.equal(withoutContact.cliente.celular, null);
  assert.throws(() => module.exports.buildEvolusomTriangularPayload({
    orderCode: 125, orderedAt: '', companyCnpj: '33.482.950/0002-30', xml,
    email: null, phone: null, trackingNumber: 'AB123BR',
    labelUrl: payload.transporte.urletiqueta, danfeUrl: payload.nfe.url,
    products: [{ sku: '141111', quantity: 1, cost: 579.9, offerId: null }],
  }), /Data de criação/);
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

test('consulta do job não expõe a resposta integral da Evolusom', async () => {
  const source = fs.readFileSync(require.resolve('../src/app/api/dslite/pedido/status/route.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/services/dslite': { consultarPedido: async () => null },
    '@/lib/supabase': { createServiceClient: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: {
          id: 'job-synthetic', status: 'completo', progresso: 100, total: 1, processados: 1,
          unidade_progresso: null, finished_at: '2026-09-21T15:00:00Z',
          log: [{ event: 'progress_snapshot', state: 'success', steps: [],
            result: { evolusom_order_id: 789 },
            private_evolusom_response: { data: { codigo: 789, private_value: 'secret-synthetic' } } }],
        }, error: null,
      }) }) }) }),
    }) },
  };
  new Function('require', 'module', 'exports', compiled)((id) => mocks[id], module, module.exports);
  const response = await module.exports.GET(new Request('https://app.bentevi.shop/api/dslite/pedido/status?jobId=job-synthetic'));
  const body = await response.json();
  assert.equal(body.data.evolusom_order_id, 789);
  assert.doesNotMatch(JSON.stringify(body), /secret-synthetic|private_evolusom_response/);
});
