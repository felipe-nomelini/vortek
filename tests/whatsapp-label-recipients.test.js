const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/whatsapp-label-job.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadLocalModule(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
  return module.exports;
}
const { normalizeWhatsappChatId } = loadLocalModule('../src/services/waha.ts');
const supplierBalance = loadLocalModule('../src/lib/supplier-balance.ts');

function loadJob(dependencies = {}, env = {}) {
  const module = { exports: {} };
  const resolved = {
    ...dependencies,
    '@/lib/supplier-balance': supplierBalance,
    '@/services/waha': { normalizeWhatsappChatId, ...dependencies['@/services/waha'] },
  };
  // Never load private environment values or real WAHA transport in these tests.
  new Function('require', 'module', 'exports', 'process', compiled)(
    (name) => resolved[name] || {}, module, module.exports, { env },
  );
  return module.exports;
}

const recipients = [
  { key: 'primary', chatId: '5511999990001@c.us' },
  { key: 'secondary_test', chatId: '5511999990002@c.us' },
];

function setupSend({ sendFile, sendText } = {}) {
  const calls = [];
  let allocated = 0;
  let persisted = [];
  const job = loadJob({
    '@/services/waha': {
      getWahaNewMessageId: async () => `message-${++allocated}`,
      sendWahaFile: async (input) => {
        assert.ok(persisted.some((entry) => entry.message_id === input.messageId), 'ID salvo antes do envio');
        calls.push({ kind: 'file', ...input });
        return sendFile?.(input) || { id: input.messageId };
      },
      sendWahaText: async (input) => {
        calls.push({ kind: 'text', ...input });
        return sendText?.(input) || { id: input.messageId };
      },
    },
  });
  const input = {
    recipients, logEntries: [], caption: 'Etiqueta de teste', filename: 'teste.pdf',
    pdf: Buffer.from('PDF simulado'), labelShortUrl: 'https://dev.bentevi.shop/s/teste',
    persistCheckpoint: async () => { persisted = structuredClone(input.logEntries); },
  };
  return { job, input, calls, get persisted() { return persisted; }, get allocated() { return allocated; } };
}

test('retomada de sucesso parcial envia apenas ao destinatário pendente com o mesmo ID', async () => {
  let fail = true;
  const harness = setupSend({ sendFile: ({ chatId }) => {
    if (fail && chatId === recipients[1].chatId) throw new Error('Falha simulada');
  } });
  await assert.rejects(harness.job.sendWhatsappLabelRecipients(harness.input), /secondary_test/);
  assert.equal(harness.persisted.filter((entry) => entry.event === 'whatsapp_label_recipient_sent').length, 1);
  fail = false;
  harness.input.logEntries = structuredClone(harness.persisted);
  const results = await harness.job.sendWhatsappLabelRecipients(harness.input);
  assert.deepEqual(harness.calls.map((call) => [call.chatId, call.messageId]), [
    [recipients[0].chatId, 'message-1'], [recipients[1].chatId, 'message-2'],
    [recipients[1].chatId, 'message-2'],
  ]);
  assert.equal(results[0].alreadySent, true);
  assert.equal(results[1].alreadySent, false);
  assert.equal(harness.allocated, 2);
  assert.ok(!JSON.stringify(harness.persisted).includes(recipients[0].chatId));
  harness.input.logEntries = structuredClone(harness.persisted);
  await harness.job.sendWhatsappLabelRecipients(harness.input);
  assert.equal(harness.calls.length, 3);
});

test('falha ao salvar ID impede qualquer envio e interrompe os próximos destinatários', async () => {
  const harness = setupSend();
  harness.input.persistCheckpoint = async () => { throw new Error('checkpoint indisponível'); };
  await assert.rejects(harness.job.sendWhatsappLabelRecipients(harness.input), /checkpoint/);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.allocated, 1);
});

test('falha ao salvar confirmação interrompe sequência e preserva ID durável para retomada', async () => {
  const harness = setupSend();
  const persist = harness.input.persistCheckpoint;
  harness.input.persistCheckpoint = async () => {
    if (harness.input.logEntries.some((entry) => entry.event === 'whatsapp_label_recipient_sent')) {
      throw new Error('checkpoint após envio indisponível');
    }
    await persist();
  };
  await assert.rejects(harness.job.sendWhatsappLabelRecipients(harness.input), /checkpoint/);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.allocated, 1);
  assert.equal(harness.persisted.some((entry) => entry.event === 'whatsapp_label_recipient_sent'), false);
  harness.input.logEntries = structuredClone(harness.persisted);
  harness.input.persistCheckpoint = persist;
  await harness.job.sendWhatsappLabelRecipients(harness.input);
  assert.equal(harness.calls[1].messageId, harness.calls[0].messageId);
});

test('ID legado vale apenas para primary e não significa envio confirmado', async () => {
  const harness = setupSend();
  harness.input.logEntries = [{ event: 'whatsapp_message_id_allocated', message_id: 'legacy-id' }];
  await harness.input.persistCheckpoint();
  await harness.job.sendWhatsappLabelRecipients(harness.input);
  assert.deepEqual(harness.calls.map((call) => call.messageId), ['legacy-id', 'message-1']);
  assert.equal(harness.allocated, 1);
});

test('fallback restrito a WAHA Core conserva ID e registra confirmação de texto', async () => {
  const harness = setupSend({ sendFile: () => { throw new Error('Available only in Plus'); } });
  harness.input.recipients = [recipients[0]];
  const [result] = await harness.job.sendWhatsappLabelRecipients(harness.input);
  assert.equal(result.sendMode, 'text_link');
  assert.deepEqual(harness.calls.map((call) => [call.kind, call.messageId]), [
    ['file', 'message-1'], ['text', 'message-1'],
  ]);
  harness.input.logEntries = structuredClone(harness.persisted);
  await harness.job.sendWhatsappLabelRecipients(harness.input);
  assert.equal(harness.calls.length, 2);
});

test('erro comum ou ausência do link não inicia fallback indevido nem confirmação', async () => {
  for (const error of ['timeout', 'Available only in Plus']) {
    const harness = setupSend({ sendFile: () => { throw new Error(error); } });
    harness.input.recipients = [recipients[0]];
    harness.input.labelShortUrl = null;
    await assert.rejects(harness.job.sendWhatsappLabelRecipients(harness.input));
    assert.equal(harness.calls.some((call) => call.kind === 'text'), false);
    assert.equal(harness.persisted.some((entry) => entry.event === 'whatsapp_label_recipient_sent'), false);
  }
});

function setupWorker(failureStage, options = {}) {
  const stored = { id: 'job-test', status: 'pendente', log: [] };
  const sends = [];
  let claims = 0;
  let failed = false;
  let allocated = 0;
  let labelLoads = 0;
  const pedido = { id: 'pedido-test', numero: 123, ml_shipment_id: 'shipment-test', ml_label_storage_path: 'teste.pdf', ...options.pedido };
  const client = { from(table) {
    let update;
    let statuses;
    let selected = false;
    const execute = () => {
      if (table === 'jobs') {
        if (selected) {
          if (!statuses.includes(stored.status)) return { data: null, error: null };
          stored.status = update.status;
          claims++;
          return { data: structuredClone(stored), error: null };
        }
        Object.assign(stored, structuredClone(update));
        return { error: null };
      }
      if (table === 'pedidos') {
        if (update && failureStage === 'pedido' && !failed) {
          failed = true;
          return { error: { message: 'Falha simulada após envio' } };
        }
        return { data: pedido, error: null };
      }
      if (table === 'compras') return { data: options.compra || null, error: options.compraError || null };
      throw new Error(`Tabela inesperada: ${table}`);
    };
    const query = {
      update(value) { update = value; return query; },
      eq() { return query; },
      in(_key, values) { statuses = values; return query; },
      select() { selected = true; return query; },
      maybeSingle: async () => execute(),
      then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
    };
    return query;
  } };
  const job = loadJob({
    '@/lib/supabase': { createServiceClient: () => client },
    '@/services/waha': {
      getWahaNewMessageId: async () => `worker-message-${++allocated}`,
      sendWahaFile: async (input) => {
        sends.push(input);
        await options.sendFile?.(input);
        return { id: input.messageId };
      },
    },
    '@/lib/shipping-label-storage': { downloadShippingLabelFromStorage: async () => { labelLoads++; return Buffer.from('PDF simulado'); } },
    '@/lib/dslite/placeholder-label': { loadDslitePlaceholderLabel: async () => { labelLoads++; return Buffer.from('PDF teste'); } },
    '@/lib/public-shipping-label-links': { buildPublicShippingLabelUrl: () => 'https://dev.bentevi.shop/etiqueta' },
    '@/lib/short-links': { createShortLink: async ({ targetUrl }) => targetUrl },
    '@/lib/notifications/templates': { buildSupplierLabelWhatsapp: () => 'Etiqueta simulada Bentevi' },
    '@/services/nf-auditoria': { registrarEventoNfAuditoria: async ({ evento, respostaMl }) => {
      if (evento !== 'whatsapp_label_send_success') return;
      assert.ok(stored.log.some((entry) => entry.event === 'whatsapp_label_recipient_sent'), 'confirmação precede auditoria');
      assert.equal(respostaMl.recipient_results[0].wahaResponse, undefined);
      if (failureStage === 'audit' && !failed) { failed = true; throw new Error('Falha de auditoria simulada'); }
    } },
  }, { EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE: options.additionalPhone });
  const input = { jobId: stored.id, pedidoId: pedido.id, phoneNumber: '11999990001', appBaseUrl: 'https://dev.bentevi.shop', usePlaceholderLabel: options.placeholder };
  return { job, stored, sends, input, get claims() { return claims; }, get labelLoads() { return labelLoads; } };
}

test('worker retoma falha posterior na auditoria ou no pedido sem reenviar', async () => {
  for (const stage of ['audit', 'pedido']) {
    const harness = setupWorker(stage);
    await harness.job.runWhatsappLabelJob(harness.input);
    assert.equal(harness.stored.status, 'on_hold');
    assert.equal(harness.sends.length, 1);
    await harness.job.runWhatsappLabelJob(harness.input);
    assert.equal(harness.stored.status, 'completo');
    assert.equal(harness.sends.length, 1);
    const snapshot = harness.stored.log.filter((entry) => entry.event === 'progress_snapshot').at(-1);
    assert.equal(snapshot.result.recipientCount, 1);
    assert.equal(snapshot.result.recipientResults[0].alreadySent, true);
  }
});

test('duas retomadas concorrentes mantêm aquisição exclusiva e um único envio', async () => {
  const harness = setupWorker();
  await Promise.all([
    harness.job.runWhatsappLabelJob(harness.input),
    harness.job.runWhatsappLabelJob(harness.input),
  ]);
  assert.equal(harness.claims, 1);
  assert.equal(harness.sends.length, 1);
  assert.equal(harness.stored.status, 'completo');
});

test('Evolusom oficial adiciona contato e deduplica formato nacional/internacional', () => {
  const { resolveWhatsappLabelRecipients } = loadJob();
  const input = { primaryChatId: recipients[0].chatId, fornecedorId: 133, additionalPhone: '(11) 99999-0002' };
  assert.deepEqual(resolveWhatsappLabelRecipients(input), [
    recipients[0], { key: 'evolusom_additional', chatId: recipients[1].chatId },
  ]);
  for (const phone of ['11999990001', '+55 (11) 99999-0001']) {
    assert.deepEqual(resolveWhatsappLabelRecipients({ ...input, additionalPhone: phone }), [recipients[0]]);
  }
  for (const fornecedorId of [null, undefined, '108', 'Evolusom', '1330']) {
    assert.deepEqual(resolveWhatsappLabelRecipients({ ...input, fornecedorId, additionalPhone: undefined }), [recipients[0]]);
  }
  assert.deepEqual(resolveWhatsappLabelRecipients({ ...input, usePlaceholderLabel: true, additionalPhone: undefined }), [recipients[0]]);
});

test('configuração adicional inválida impede envio e retry automático no worker', async () => {
  for (const phone of [undefined, '', 'invalid', '123', 'abc11999990002']) {
    const harness = setupWorker(undefined, {
      pedido: { dslite_id: 'purchase-test' }, compra: { fornecedor_id: '133' }, additionalPhone: phone,
    });
    await harness.job.runWhatsappLabelJob(harness.input);
    assert.equal(harness.stored.status, 'erro');
    assert.equal(harness.sends.length, 0);
    assert.equal(harness.labelLoads, 0);
    assert.equal(harness.stored.log.some((row) => row.event === 'queue_hold'), false);
    const result = harness.stored.log.filter((row) => row.event === 'progress_snapshot').at(-1).result;
    assert.equal(result.reason, 'invalid_evolusom_recipient_configuration');
    assert.match(result.error, /EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE/);
    if (phone === 'abc11999990002') assert.ok(!JSON.stringify(harness.stored.log).includes(phone));
  }
});

test('worker de Evolusom confirma os dois e não reabre job concluído', async () => {
  const harness = setupWorker(undefined, {
    pedido: { dslite_id: 'purchase-test' }, compra: { fornecedor_id: '133' }, additionalPhone: '11999990002',
  });
  await harness.job.runWhatsappLabelJob(harness.input);
  assert.equal(harness.stored.status, 'completo');
  assert.deepEqual(harness.sends.map((row) => row.chatId), recipients.map((row) => row.chatId));
  const result = harness.stored.log.filter((row) => row.event === 'progress_snapshot').at(-1).result;
  assert.equal(result.recipientCount, 2);
  assert.deepEqual(result.recipientResults.map((row) => row.recipientKey), ['primary', 'evolusom_additional']);
  assert.ok(!JSON.stringify(harness.stored.log).includes('11999990002'));
  await harness.job.runWhatsappLabelJob(harness.input);
  assert.equal(harness.sends.length, 2);
  assert.equal(harness.claims, 1);
});

test('worker retoma somente o adicional que falhou, preservando seu ID', async () => {
  let fail = true;
  const harness = setupWorker(undefined, {
    pedido: { dslite_id: 'purchase-test' }, compra: { fornecedor_id: '133' }, additionalPhone: '11999990002',
    sendFile: ({ chatId }) => { if (fail && chatId === recipients[1].chatId) throw new Error('simulated'); },
  });
  await harness.job.runWhatsappLabelJob(harness.input);
  assert.equal(harness.stored.status, 'on_hold');
  assert.equal(harness.stored.log.filter((row) => row.event === 'whatsapp_label_recipient_sent').length, 1);
  fail = false;
  await harness.job.runWhatsappLabelJob(harness.input);
  assert.equal(harness.stored.status, 'completo');
  assert.deepEqual(harness.sends.map((row) => [row.chatId, row.messageId]), [
    [recipients[0].chatId, 'worker-message-1'],
    [recipients[1].chatId, 'worker-message-2'],
    [recipients[1].chatId, 'worker-message-2'],
  ]);
});

test('erro ao consultar compra não se torna envio apenas ao principal', async () => {
  const harness = setupWorker(undefined, {
    pedido: { dslite_id: 'purchase-test' }, compraError: { message: 'private database error' },
  });
  await harness.job.runWhatsappLabelJob(harness.input);
  assert.equal(harness.sends.length, 0);
  assert.equal(harness.labelLoads, 0);
  assert.notEqual(harness.stored.status, 'completo');
  assert.ok(!JSON.stringify(harness.stored.log).includes('private database error'));
});

test('worker mantém um destino para teste, outro fornecedor, compra ausente ou número duplicado', async () => {
  for (const options of [
    { pedido: { dslite_id: 'purchase-test' }, compra: { fornecedor_id: '133' }, placeholder: true },
    { pedido: { dslite_id: 'purchase-test' }, compra: { fornecedor_id: '108' } },
    { pedido: { dslite_id: 'purchase-test' }, compra: null },
    {},
    { pedido: { dslite_id: 'purchase-test' }, compra: { fornecedor_id: '133' }, additionalPhone: '+55 (11) 99999-0001' },
  ]) {
    const harness = setupWorker(undefined, options);
    await harness.job.runWhatsappLabelJob(harness.input);
    assert.equal(harness.stored.status, 'completo');
    assert.equal(harness.sends.length, 1);
    assert.equal(harness.sends[0].chatId, recipients[0].chatId);
  }
});

test('Evolusom não reenvia após falha posterior e mantém exclusão concorrente', async () => {
  const options = { pedido: { dslite_id: 'purchase-test' }, compra: { fornecedor_id: '133' }, additionalPhone: '11999990002' };
  for (const stage of ['audit', 'pedido']) {
    const harness = setupWorker(stage, options);
    await harness.job.runWhatsappLabelJob(harness.input);
    assert.equal(harness.stored.status, 'on_hold');
    await harness.job.runWhatsappLabelJob(harness.input);
    assert.equal(harness.stored.status, 'completo');
    assert.equal(harness.sends.length, 2);
  }
  const harness = setupWorker(undefined, options);
  await Promise.all([harness.job.runWhatsappLabelJob(harness.input), harness.job.runWhatsappLabelJob(harness.input)]);
  assert.equal(harness.claims, 1);
  assert.equal(harness.sends.length, 2);
});
