const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const xml = `<nfeProc><NFe><infNFe><ide><serie>1</serie><nNF>2439</nNF><dhEmi>2026-06-18T10:30:00-03:00</dhEmi></ide><dest><xNome>Comprador Sintético</xNome><CPF>07778845938</CPF><enderDest><xLgr>Rua Um</xLgr><nro>9</nro><xBairro>Centro</xBairro><xMun>Curitiba</xMun><UF>PR</UF><CEP>80000000</CEP></enderDest></dest><det nItem="1"><prod><cProd>141111</cProd><xProd>Produto da nota fiscal</xProd><vUnCom>679.90</vUnCom></prod><imposto><vST>0</vST><vIPI>0</vIPI></imposto></det><total><ICMSTot><vNF>679.90</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>41260612345678000190550010000024391000024395</chNFe></infProt></protNFe></nfeProc>`;

function purchaseHarness({ initialPurchase = null, buyer = null, trackingNumber = 'AB123BR', placeholder = false, shipment = null, labelDownloadOk = true, storageOk = true, productName = 'Produto Evolusom de teste', response = { codigo: 456, status: 'Pendente' } } = {}) {
  let purchase = initialPurchase;
  const sent = [];
  let labelDownloads = 0;
  let labelStores = 0;
  const order = {
    id: 'order-1', numero: 123, ml_order_id: 'ml-123', ml_shipment_id: shipment ? 'shipment-1' : null,
    rastreio: trackingNumber, ml_label_storage_path: placeholder ? null : 'label.pdf',
    billing_documento: '07778845938', buyer_ml_id: null,
  };
  const client = {
    from(table) {
      let action = 'select';
      let values;
      const filters = {};
      const query = {
        select() { return query; },
        limit() { return query; },
        eq(column, value) { filters[column] = value; return query; },
        in() { return query; },
        insert(value) { action = 'insert'; values = value; return query; },
        update(value) { action = 'update'; values = value; return query; },
        maybeSingle() { return Promise.resolve(run()); },
        single() { return Promise.resolve(run()); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      function run() {
        if (action === 'select') {
          if (table === 'pedidos') return { data: order, error: null };
          if (table === 'empresa') return { data: { cnpj: '33482950000230' }, error: null };
          if (table === 'clientes') return { data: buyer, error: null };
          if (table === 'compras') return { data: purchase, error: null };
          if (table === 'produto_fornecedor_ofertas') return { data: { produto_id: 'product-1' }, error: null };
          if (table === 'produtos') return { data: productName ? { nome: productName } : null, error: null };
        }
        if (table === 'compras' && action === 'insert') {
          purchase = { id: 'purchase-1', ...values };
          return { data: { id: purchase.id }, error: null };
        }
        if (table === 'compras' && action === 'update') {
          if (!purchase || filters.id !== purchase.id ||
              (filters.evolusom_request_state && filters.evolusom_request_state !== purchase.evolusom_request_state)) {
            return { data: null, error: null };
          }
          purchase = { ...purchase, ...values };
          return { data: { id: purchase.id }, error: null };
        }
        if (table === 'pedidos' && action === 'update') {
          Object.assign(order, values);
          return { data: null, error: null };
        }
        throw new Error(`Unexpected ${action} on ${table}`);
      }
      return query;
    },
  };
  const source = fs.readFileSync(require.resolve('../src/services/evolusom-purchase.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mocks = {
    '@/lib/supabase': { createServiceClient: () => client },
    '@/lib/public-nfe-links': { buildPublicNfeUrl: () => 'https://app.bentevi.shop/nfe-synthetic' },
    '@/lib/public-shipping-label-links': { buildPublicShippingLabelUrl: (_base, _id, format) => `https://app.bentevi.shop/label-synthetic/${format}` },
    '@/lib/ml/fiscal-release': { isMlShipmentLabelPrintable: (value) => value?.status === 'ready_to_ship' && ['ready_to_print', 'printed'].includes(value?.substatus) },
    '@/lib/shipping-label-storage': { storeShippingLabelForPedido: async () => {
      labelStores += 1;
      if (!storageOk) return { ok: false, storagePath: null };
      order.ml_label_storage_path = 'label.pdf';
      return { ok: true, storagePath: 'label.pdf' };
    } },
    '@/services/integration': {
      fetchML: async () => shipment,
      baixarEtiquetaML: async () => { labelDownloads += 1; return { pdf: labelDownloadOk ? Buffer.from('%PDF-test') : null }; },
    },
    '@/services/evolusom': {
      EvolusomApiError: class EvolusomApiError extends Error {},
      evolusomRequest: async (path, init) => {
        assert.equal(path, '/v1/pedidos/triangular');
        sent.push(JSON.parse(init.body));
        return response;
      },
    },
    '@/lib/dslite/placeholder-label': { DSLITE_EVOLUSOM_PLACEHOLDER_LABEL_SOURCE: 'placeholder_evolusom' },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => mocks[id], module, module.exports);
  return {
    create: () => module.exports.createEvolusomPurchase({
      pedidoId: order.id, orderIds: [order.id], xml,
      products: [{ sku: '141111', quantity: 1, cost: 579.9, offerId: 'offer-1' }],
      supplierPaymentMode: 'postpaid',
    }),
    getPurchase: () => purchase,
    getOrder: () => order,
    getLabelDownloads: () => labelDownloads,
    getLabelStores: () => labelStores,
    sent,
  };
}

test('reserva usa a data da compra, aceita contatos ausentes e evita segundo POST', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness();
  const started = Date.now();
  const result = await harness.create();
  const ended = Date.now();
  assert.equal(result.state, 'created');
  assert.equal(harness.sent.length, 1);
  assert.ok(Date.parse(harness.getPurchase().data_criacao) >= started);
  assert.ok(Date.parse(harness.getPurchase().data_criacao) <= ended);
  assert.notEqual(harness.sent[0].data_pedido, harness.sent[0].nfe.data_emissao);
  assert.equal(harness.sent[0].cliente.email, null);
  assert.equal(harness.sent[0].cliente.telefone, null);
  assert.equal(harness.sent[0].cliente.celular, null);
  assert.equal(harness.getPurchase().produto_descricao, 'Produto Evolusom de teste');
  assert.equal((await harness.create()).state, 'created');
  assert.equal(harness.sent.length, 1);
});

test('etiqueta provisória usa o código do exemplo sem registrar rastreio fictício', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({ trackingNumber: null, placeholder: true });
  assert.equal((await harness.create()).state, 'created');
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].transporte.codrastreio, '99999999999');
  assert.match(harness.sent[0].transporte.urletiqueta, /placeholder_evolusom/);
  assert.equal(harness.getPurchase().rastreio, null);
});

test('etiqueta real já liberada no ML é baixada e enviada na criação Evolusom', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({
    placeholder: true, trackingNumber: null,
    shipment: { status: 'ready_to_ship', substatus: 'ready_to_print', tracking_number: 'REAL123' },
  });
  const result = await harness.create();
  assert.equal(result.state, 'created');
  assert.equal(result.placeholder, false);
  assert.equal(harness.getLabelDownloads(), 1);
  assert.equal(harness.getLabelStores(), 1);
  assert.equal(harness.sent[0].transporte.urletiqueta, 'https://app.bentevi.shop/label-synthetic/pdf');
  assert.equal(harness.sent[0].transporte.codrastreio, 'REAL123');
  assert.equal(harness.getOrder().dslite_label_source, 'mercado_livre');
  assert.equal((await harness.create()).placeholder, false);
  assert.equal(harness.getLabelDownloads(), 1);
});

test('etiqueta ainda não imprimível mantém o pedido com etiqueta genérica', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({
    placeholder: true, trackingNumber: null,
    shipment: { status: 'pending', substatus: 'buffered', tracking_number: null },
  });
  assert.equal((await harness.create()).placeholder, true);
  assert.equal(harness.getLabelDownloads(), 0);
  assert.match(harness.sent[0].transporte.urletiqueta, /placeholder_evolusom/);
});

test('falha ao baixar etiqueta liberada impede envio da genérica à Evolusom', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({
    placeholder: true, labelDownloadOk: false,
    shipment: { status: 'ready_to_ship', substatus: 'ready_to_print', tracking_number: 'REAL123' },
  });
  assert.equal((await harness.create()).state, 'pending');
  assert.equal(harness.getLabelDownloads(), 1);
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.getPurchase(), null);
});

test('nome fiscal identifica a compra quando o cadastro do produto não tem nome', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({ productName: null });
  assert.equal((await harness.create()).state, 'created');
  assert.equal(harness.getPurchase().produto_descricao, 'Produto da nota fiscal');
});

test('sem etiqueta provisória, ausência de rastreio mantém a compra pendente', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({ trackingNumber: null });
  assert.equal((await harness.create()).state, 'pending');
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.getPurchase(), null);
});

test('retomada de reserva preparada preserva a data e envia contatos conhecidos', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const orderedAt = '2026-06-25T11:55:41.000Z';
  const harness = purchaseHarness({
    initialPurchase: {
      id: 'purchase-1', evolusom_request_code: '80000123',
      evolusom_request_state: 'prepared', evolusom_order_id: null, data_criacao: orderedAt,
    },
    buyer: { email: 'buyer@example.com', telefone: '41999999999' },
  });
  assert.equal((await harness.create()).state, 'created');
  assert.equal(harness.getPurchase().data_criacao, orderedAt);
  assert.equal(harness.sent[0].codigo_pedido, 80000123);
  assert.equal(harness.sent[0].data_pedido, '2026-06-25 08:55:41');
  assert.equal(harness.sent[0].nfe.data_emissao, '2026-06-18 10:30:00');
  assert.equal(harness.sent[0].cliente.email, 'buyer@example.com');
  assert.equal(harness.sent[0].cliente.telefone, '(41) 99999-9999');
});

test('rejeição HTTP 400 permite nova tentativa manual com o mesmo código e data', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const orderedAt = '2026-09-21T14:18:16.235Z';
  const harness = purchaseHarness({
    initialPurchase: {
      id: 'purchase-1', evolusom_request_code: 'BNT-123',
      evolusom_request_state: 'rejected', evolusom_order_id: null, data_criacao: orderedAt,
    },
  });
  assert.equal((await harness.create()).state, 'created');
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].codigo_pedido, 80000123);
  assert.equal(harness.getPurchase().evolusom_request_code, String(harness.sent[0].codigo_pedido));
  assert.equal(harness.sent[0].data_pedido, '2026-09-21 11:18:16');
  assert.equal(harness.getPurchase().data_criacao, orderedAt);
});

test('resposta com número dentro de data vincula a compra sem repetir o POST', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({ response: { status: 200, data: { codigo: 789, status: 'Pendente' }, message: 'Pedido criado' } });
  const result = await harness.create();
  assert.deepEqual({ state: result.state, orderId: result.orderId, status: result.status },
    { state: 'created', orderId: 789, status: 'Pendente' });
  assert.deepEqual(result.apiResponse, { status: 200, data: { codigo: 789, status: 'Pendente' }, message: 'Pedido criado' });
  assert.equal(harness.sent[0].codigo_pedido, 80000123);
  assert.equal(harness.getPurchase().evolusom_order_id, 789);
  assert.equal(harness.sent.length, 1);
});

test('HTTP 200 com erro interno no corpo não confirma pedido nem descarta a resposta', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const apiResponse = { status: 500, data: [], message: 'ORA-01438: valor acima da precisão permitida' };
  const harness = purchaseHarness({ response: apiResponse });
  const result = await harness.create();
  assert.equal(result.state, 'uncertain');
  assert.match(result.reason, /erro 500 \(ORA-01438\)/);
  assert.deepEqual(result.apiResponse, apiResponse);
  assert.equal(harness.getPurchase().evolusom_order_id, undefined);
  assert.equal(harness.getPurchase().evolusom_request_state, 'uncertain');
  assert.equal(harness.sent.length, 1);
});

test('resultado incerto continua sem repetir o POST', async (t) => {
  const previous = process.env.EVOLUSOM_DIRECT_ENABLED;
  process.env.EVOLUSOM_DIRECT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.EVOLUSOM_DIRECT_ENABLED;
    else process.env.EVOLUSOM_DIRECT_ENABLED = previous;
  });
  const harness = purchaseHarness({
    initialPurchase: {
      id: 'purchase-1', evolusom_request_code: 'BNT-123',
      evolusom_request_state: 'uncertain', evolusom_order_id: null,
      data_criacao: '2026-09-21T14:18:16.235Z',
    },
  });
  assert.equal((await harness.create()).state, 'uncertain');
  assert.equal(harness.sent.length, 0);
});
