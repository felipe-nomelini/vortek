const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const load = require('./helpers/load-integration-module');
const actor = '00000000-0000-4000-8000-000000000091';
const home = '/tmp/test/warranty-codex';

function harness(t, options = {}) {
  const env = { NODE_ENV: 'development', WARRANTY_RESEARCH_PROVIDER: 'codex', WARRANTY_CODEX_PILOT_USER_ID: actor,
    WARRANTY_CODEX_HOME: home, FIRECRAWL_API_KEY: 'test-only', OPENAI_API_KEY: 'must-not-inherit', OPENROUTER_API_KEY: 'must-not-fallback' };
  const old = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const requests = [], children = [], spawns = [];
  let module;
  function spawn(binary, args, config) {
    spawns.push({ binary, args, config });
    const child = new EventEmitter(); children.push(child);
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.exitCode = null; child.signalCode = null; child.kills = [];
    child.kill = signal => { child.kills.push(signal); child.signalCode = signal; queueMicrotask(() => child.emit('close')); return true; };
    child.send = message => {
      const line = JSON.stringify(message) + '\n';
      if (options.fragmented) { child.stdout.write(line.slice(0, 5)); child.stdout.write(line.slice(5)); }
      else child.stdout.write(line);
    };
    child.stdin.on('data', buffer => {
      const message = JSON.parse(String(buffer)); requests.push(message);
      queueMicrotask(() => {
        if (child.signalCode !== null) return;
        const reply = result => child.send({ id: message.id, result });
        if (message.method === 'initialize') {
          if (options.badProtocol) return child.stdout.write('invalid-json\n');
          if (options.unknownId) return child.send({ id: 9999, result: {} });
          if (options.outputLimit) return child.stdout.write('x'.repeat(1024 * 1024 + 1));
          if (options.exitEarly) { child.exitCode = 1; child.emit('close'); return; }
          reply({});
        }
        if (message.method === 'account/read') reply({ account: options.loggedOut ? null : { type: options.apiKey ? 'apiKey' : 'chatgpt' } });
        if (message.method === 'model/list') reply({ data: options.noModel ? [] : [{ model: 'gpt-5.4-mini', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], nextCursor: null });
        if (message.method === 'thread/start') reply({ thread: { id: `thread-${children.length}`, ephemeral: true }, model: 'gpt-5.4-mini', modelProvider: 'openai', activePermissionProfile: { id: 'warranty-extract' }, instructionSources: [] });
        if (message.method === 'turn/start') {
          const threadId = message.params.threadId, turn = { id: 'turn-1' };
          reply({ turn }); child.send({ method: 'turn/started', params: { threadId, turn } });
          if (options.hang) return;
          if (options.serverRequest) return child.send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
          if (options.providerError) return child.send({ method: 'error', params: { message: 'PRIVATE PROVIDER DETAILS', errorInfo: options.providerError } });
          if (options.rpcError) return child.send({ id: message.id, error: { message: 'PRIVATE PROVIDER DETAILS' } });
          const item = { type: options.tool || 'agentMessage', text: options.invalidJson ? 'not-json' : JSON.stringify({ evidence: options.evidence || [] }), phase: 'final_answer' };
          child.send({ method: 'item/completed', params: { threadId, turnId: options.wrongTurn ? 'wrong' : turn.id, item } });
          child.send({ method: 'turn/completed', params: { threadId, turn: { ...turn, status: options.failedTurn ? 'failed' : 'completed', items: [] } } });
        }
      });
    });
    return child;
  }
  module = load('src/services/warranty-codex.ts', { 'server-only': {}, 'node:child_process': { spawn }, 'node:path': require('node:path'),
    'node:fs': { existsSync: () => !options.noAuth, realpathSync: p => options.symlink ? '/wrong-path' : p,
      readFileSync: () => options.changedConfig ? 'model="another"' : module.warrantyCodexConfig } });
  return { module, requests, spawns, children, run: (signal = new AbortController().signal, user = actor, payload = { pages: [] }) => module.extractWarrantyWithCodex(payload, signal, user) };
}

test('App Server: JSONL fragmentado, resultado de item/completed e perfil isolado', async t => {
  const h = harness(t, { fragmented: true });
  assert.deepEqual(await h.run(), []);
  assert.deepEqual(h.requests.filter(r => r.id).map(r => r.method), ['initialize','account/read','model/list','thread/start','turn/start']);
  const { binary, args, config } = h.spawns[0];
  assert.equal(binary, 'codex'); assert.ok(args.includes('--strict-config')); assert.ok(args.includes('stdio://')); assert.equal(config.shell, false);
  assert.deepEqual(Object.keys(config.env).sort(), ['CODEX_HOME','HOME','LANG','NODE_ENV','PATH']);
  assert.equal(config.env.CODEX_HOME, home); assert.equal(config.cwd, home + '/workspace');
  const thread = h.requests.find(r => r.method === 'thread/start').params;
  assert.equal(thread.ephemeral, true); assert.equal(thread.modelProvider, 'openai'); assert.equal(thread.permissions, 'warranty-extract');
  const turn = h.requests.find(r => r.method === 'turn/start').params;
  assert.equal(turn.effort, 'low'); assert.equal(turn.model, 'gpt-5.4-mini');
  assert.equal(turn.outputSchema.additionalProperties, false);
  assert.equal(turn.permissions, 'warranty-extract');
  assert.deepEqual(h.children[0].kills, ['SIGTERM']);
});

for (const [name, options, error] of [
  ['sessão ausente', { loggedOut: true }, 'auth_required'], ['API key recusada', { apiKey: true }, 'auth_required'],
  ['modelo indisponível', { noModel: true }, 'model_unavailable'], ['JSONL inválido', { badProtocol: true }, 'protocol_invalid'],
  ['resposta estranha', { unknownId: true }, 'protocol_invalid'], ['limite de saída', { outputLimit: true }, 'output_limit'],
  ['processo encerrado', { exitEarly: true }, 'unavailable'], ['sessão expirada em turno', { providerError: '401' }, 'unavailable'],
  ['limite de uso', { providerError: '429' }, 'unavailable'], ['pedido de aprovação', { serverRequest: true }, 'tool_forbidden'],
  ['execução de comando', { tool: 'commandExecution' }, 'tool_forbidden'], ['MCP', { tool: 'mcpToolCall' }, 'tool_forbidden'],
  ['web search', { tool: 'webSearch' }, 'tool_forbidden'], ['edição', { tool: 'fileChange' }, 'tool_forbidden'],
  ['turno trocado', { wrongTurn: true }, 'protocol_invalid'], ['turno falhou', { failedTurn: true }, 'turn_failed'],
]) test(name + ': falha explícita, sem retry/fallback', async t => {
  const h = harness(t, options);
  await assert.rejects(h.run(), new RegExp('^Error: warranty_codex_' + error + '$'));
  assert.equal(h.spawns.length, 1); assert.equal(h.children[0].kills.length <= 1, true);
});

test('resposta sem JSON não vira garantia', async t => {
  await assert.rejects(harness(t, { invalidJson: true }).run(), /^Error: warranty_extraction_invalid$/);
});
test('deadline interrompe turno e encerra processo; concorrente não ganha fila ou contexto', async t => {
  const h = harness(t, { hang: true }); const controller = new AbortController();
  const running = h.run(controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.run(), /warranty_codex_busy/);
  assert.equal(h.spawns.length, 1); controller.abort();
  await assert.rejects(running, /warranty_codex_timeout/);
  assert.ok(h.requests.some(r => r.method === 'turn/interrupt'));
  assert.deepEqual(h.children[0].kills, ['SIGTERM']);
});
test('chamadas sequenciais não reutilizam thread nem conteúdo', async t => {
  const h = harness(t);
  await h.run(undefined, actor, { product: 'A' }); await new Promise(resolve => setImmediate(resolve));
  await h.run(undefined, actor, { product: 'B' });
  const turns = h.requests.filter(r => r.method === 'turn/start');
  assert.notEqual(turns[0].params.threadId, turns[1].params.threadId);
  assert.equal(turns[1].params.input[0].text, '{"product":"B"}');
});
test('usuário diferente e NODE_ENV production não iniciam processo', async t => {
  const h = harness(t);
  await assert.rejects(h.run(undefined, 'outro'), /warranty_pilot_forbidden/);
  process.env.NODE_ENV = 'production'; await assert.rejects(h.run(), /warranty_pilot_forbidden/);
  assert.equal(h.module.getWarrantyResearchAccess(actor).researchAvailable, false); assert.equal(h.spawns.length, 0);
});
for (const options of [{ symlink: true }, { changedConfig: true }]) test('perfil modificado não herda ferramentas do agente', async t => {
  const h = harness(t, options); await assert.rejects(h.run(), /warranty_codex_not_configured/); assert.equal(h.spawns.length, 0);
});
test('coleta, autenticação e seleção de provedor são independentes', t => {
  const h = harness(t);
  assert.equal(h.module.getWarrantyResearchAccess(actor).researchAvailable, true);
  delete process.env.FIRECRAWL_API_KEY;
  assert.match(h.module.getWarrantyResearchAccess(actor).researchUnavailableReason, /Firecrawl/);
  process.env.WARRANTY_RESEARCH_PROVIDER = 'invalid';
  assert.equal(h.module.getWarrantyResearchAccess(actor).researchProvider, 'unconfigured');
  assert.equal(h.module.getWarrantyResearchAccess(actor).researchAvailable, false);
  delete process.env.WARRANTY_RESEARCH_PROVIDER;
  assert.equal(h.module.getWarrantyResearchAccess(actor).researchProvider, 'openrouter');
});
test('perfil sem login não é apresentado como disponível', t => {
  assert.equal(harness(t, { noAuth: true }).module.getWarrantyResearchAccess(actor).researchAvailable, false);
});

// Opt-in only: consumes the authenticated individual's Codex allowance. No DB or Firecrawl.
test('LIVE: assinatura ChatGPT extrai evidência que passa pelo validador canônico', { skip: process.env.WARRANTY_CODEX_LIVE_TEST !== '1' }, async () => {
  const fs = require('node:fs');
  const real = load('src/services/warranty-codex.ts', { 'server-only': {}, 'node:child_process': require('node:child_process'), 'node:fs': fs, 'node:path': require('node:path') });
  const terms = require('../src/lib/ml-sale-terms.ts');
  const domain = load('src/lib/product-warranty.ts', { zod: require('zod'), './ml-sale-terms': terms });
  const service = load('src/services/product-warranty.ts', { 'server-only': {}, 'node:crypto': require('node:crypto'), zod: require('zod'),
    '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'), '@/lib/ml-product-facts': require('../src/lib/ml-product-facts.ts'),
    '@/lib/product-warranty': domain, '@/lib/ml-sale-terms': terms, './warranty-codex': real,
    './product-attribute-research': { researchWarrantySources: async () => { throw Error('unexpected_collection'); } } });
  const product = { nome: 'Produto Teste Bentevi X1', marca: 'Marca Teste', gtin: '' };
  const pages = [{ url: 'https://marca.example.com/manual', content: 'Produto Teste Bentevi X1 tem garantia do fabricante Marca Teste de 12 meses no Brasil. Amostra sintética de validação, não uma garantia comercial real.' }];
  const start = Date.now();
  const evidence = await real.extractWarrantyWithCodex({ product, isKit: false, pages }, AbortSignal.timeout(45000), process.env.WARRANTY_CODEX_PILOT_USER_ID);
  const candidates = service.validateExtractedWarranty(evidence, pages, { product, offers: [], kit: null, components: [] });
  assert.equal(candidates.length, 1); assert.equal(candidates[0].duration, 12); assert.equal(candidates[0].reviewed, false);
  assert.equal(candidates[0].brazil, true); assert.equal(candidates[0].kind, 'manufacturer');
  console.log(JSON.stringify({ livePilot: 'chatgpt', model: real.warrantyCodexModel, elapsedMs: Date.now() - start, canonicalCandidates: candidates.length }));
});
