const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const terms = require('../src/lib/ml-sale-terms.ts');
const domain = load('src/lib/product-warranty.ts', { zod: require('zod'), './ml-sale-terms': terms });
const service = load('src/services/product-warranty.ts', { 'server-only': {}, 'node:crypto': require('node:crypto'), zod: require('zod'),
  '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'), '@/lib/ml-product-facts': require('../src/lib/ml-product-facts.ts'),
  '@/lib/product-warranty': domain, '@/lib/ml-sale-terms': terms, './product-attribute-research': { researchWarrantySources: async () => [] } });
const id = '00000000-0000-4000-8000-000000000091';
const base = { kind: 'manufacturer', duration: 12, unit: 'meses', url: 'https://marca.example.com/manual',
  excerpt: 'Produto Exato tem garantia de 12 meses no Brasil.', identity: 'Produto Exato', brazil: true, coversKit: false,
  classification: null, scope: 'manufacturer:marca', collectedAt: '2026-09-07T12:00:00Z', origin: 'web', reviewed: false };
const sources = [{ id, scope: base.scope, host: 'marca.example.com', state: 'approved', reason: 'Fonte oficial validada', created_at: base.collectedAt }];
const resolve = (candidates = [base], extra = {}) => domain.resolveWarranty({ candidates, sources, isKit: false, revision: 'revision', ...extra });
const category = [{ id: 'WARRANTY_TYPE', values: [{ id: '2230279', name: 'Garantia de fábrica' }, { id: '2230280', name: 'Garantia do vendedor' }] },
  { id: 'WARRANTY_TIME', allowed_units: [{ id: 'meses' }, { id: 'dias' }] }];
const context = { product: { id, nome: 'Produto Exato', marca: 'Marca', gtin: '1234567890123', descricao: '', oferta_preferencial_id: null, fornecedor_preferencial_manual: false }, offers: [], kit: null, components: [] };
test('ausência não fabrica prazo e catálogo não comprova garantia', () => {
  assert.equal(resolve([]).status, 'inconclusiva');
  assert.deepEqual(domain.warrantySaleTerms(resolve([]), category).terms, []);
  assert.equal(resolve([base], { sources: [] }).status, 'pendente_validacao');
});
test('precedência fabricante, fornecedor e legal, sem soma', () => {
  const supplier = { ...base, kind: 'supplier', duration: 6, excerpt: 'Garantia de 6 meses no Brasil.', reviewed: true };
  const legal = { ...base, kind: 'legal', duration: 90, unit: 'dias', classification: 'durable', reviewed: true };
  assert.equal(resolve([legal, supplier, base]).selected.duration, 12);
  assert.equal(resolve([legal, supplier]).selected.kind, 'supplier');
  assert.equal(resolve([legal]).status, 'legal');
  assert.equal(resolve([{ ...legal, duration: 30 }]).selected, null);
  assert.equal(resolve([{ ...legal, duration: 30, classification: 'non_durable' }]).status, 'legal');
  assert.equal(resolve([{ ...legal, classification: null }]).selected, null);
});
test('domínio confiável não transfere prazo nem cobertura ao kit ou outro país', () => {
  assert.equal(resolve([base], { isKit: true }).selected, null);
  assert.equal(resolve([{ ...base, brazil: false }]).selected, null);
  assert.equal(resolve([{ ...base, excerpt: 'Garantia de 24 meses' }]).selected, null);
  assert.equal(resolve([base], { sources: [{ ...sources[0], state: 'revoked' }] }).selected, null);
  assert.equal(resolve([{ ...base, reviewed: true }], { sources: [{ ...sources[0], state: 'revoked' }] }).selected, null);
});
test('12 meses = 1 ano; dias não são convertidos; todas as durações são confrontadas', () => {
  assert.equal(resolve([base, { ...base, duration: 1, unit: 'anos', excerpt: 'Garantia de 1 ano no Brasil' }]).status, 'comprovada');
  assert.equal(resolve([base, { ...base, duration: 6, excerpt: 'Garantia de 6 meses' }]).status, 'conflito');
  assert.equal(resolve([{ ...base, excerpt: 'Garantia de 12 meses (1 ano)' }]).status, 'comprovada');
  assert.equal(resolve([{ ...base, excerpt: 'Garantia de 12 meses ou 6 meses' }]).selected, null);
  assert.equal(resolve([base, { ...base, duration: 365, unit: 'dias', excerpt: 'Garantia de 365 dias' }]).status, 'conflito');
});
test('termos ML exigem tipo, unidade ou enumeração oficial; nunca primeiro valor', () => {
  assert.equal(domain.warrantySaleTerms(resolve(), category).terms[1].value_name, '12 meses');
  assert.equal(domain.warrantySaleTerms(resolve(), [category[0], { id: 'WARRANTY_TIME' }]).compatible, false);
  assert.equal(domain.warrantySaleTerms(resolve(), [category[0], { id: 'WARRANTY_TIME', values: [{ id: 'TIME1', name: '1 ano' }] }]).terms[1].value_id, 'TIME1');
  assert.equal(domain.warrantySaleTerms(resolve(), [category[0], { id: 'WARRANTY_TIME', values: [{ id: 'TIME1', name: '6 meses' }] }]).compatible, false);
  assert.equal(domain.warrantySaleTerms(resolve(), []).compatible, false);
  assert.equal(domain.warrantySaleTerms(resolve(), [category[0], { id: 'WARRANTY_TIME', allowed_units: [{ id: 'anos' }] }]).terms[1].value_name, '1 anos');
});
test('descrição canônica é idempotente e rejeita promessa contraditória', () => {
  const text = domain.warrantyDescription('Produto resistente. Garantia de 24 meses.\nConteúdo: 1 peça.', resolve());
  assert.match(text, /Produto resistente/); assert.match(text, /Conteúdo: 1 peça/); assert.doesNotMatch(text, /24 meses/);
  assert.equal(domain.warrantyDescription(text, resolve()), text);
  assert.equal(domain.warrantyDescriptionConflicts(text, resolve()), false);
  assert.equal(domain.warrantyDescriptionConflicts('Garantia de 24 meses', resolve()), true);
  assert.equal(domain.warrantyDescriptionConflicts('Sem garantia', resolve()), true);
  assert.equal(domain.warrantyDescriptionConflicts('GARANTIA\n24 meses', resolve()), true);
  assert.doesNotMatch(domain.warrantyDescription('Produto resistente.\nGARANTIA\n24 meses', resolve()), /24 meses/);
  assert.equal(domain.warrantyDescriptionConflicts('Garantia do fabricante: 12 meses', resolve([{ ...base, kind: 'supplier', reviewed: true }])), true);
});
test('extração exige página capturada, trecho literal, produto exato e prova Brasil', () => {
  const evidence = Object.fromEntries(Object.entries(base).filter(([k]) => !['scope','collectedAt','origin','reviewed'].includes(k)));
  const pages = [{ url: base.url, content: base.excerpt }];
  assert.equal(service.validateExtractedWarranty([evidence], pages, context)[0].brazil, true);
  assert.deepEqual(service.validateExtractedWarranty([{ ...evidence, identity: 'Outro Produto' }], pages, context), []);
  assert.deepEqual(service.validateExtractedWarranty([{ ...evidence, excerpt: 'Trecho inventado garantia de 12 meses' }], pages, context), []);
  assert.deepEqual(service.validateExtractedWarranty([{ ...evidence, url: 'https://outro.example.com/manual' }], pages, context), []);
  const foreign = { ...evidence, excerpt: 'Produto Exato tem garantia de 12 meses.' };
  assert.equal(service.validateExtractedWarranty([foreign], [{ url: base.url, content: foreign.excerpt }], context)[0].brazil, false);
  assert.deepEqual(service.validateExtractedWarranty([{ ...evidence, identity: context.product.gtin }], [{ url: base.url, content: base.excerpt + context.product.gtin }], context), []);
});
test('oferta preferencial ativa: duração explícita vira candidato, nunca prova de fabricante', () => {
  const offer = { id, ativo: true, custo: 10, estoque: 5, prioridade: 1, dslite_fornecedor_id: '1', nome: 'Produto Exato', descricao: 'Garantia de 6 meses.', gtin: null };
  const result = service.localOfferWarranty({ ...context, offers: [offer] });
  assert.equal(result[0].kind, 'supplier'); assert.equal(result[0].duration, 6); assert.equal(result[0].reviewed, false);
  assert.equal(resolve(result).selected, null);
  assert.deepEqual(service.localOfferWarranty({ ...context, offers: [{ ...offer, ativo: false }] }), []);
  assert.deepEqual(service.localOfferWarranty({ ...context, offers: [{ ...offer, descricao: 'Garantia: 6', tempo_garantia: 6 }] }), []);
});
test('URLs rejeitam credenciais, parâmetros sensíveis e endereços internos', () => {
  for (const url of ['http://example.com/a','https://127.0.0.1/a','https://192.168.1.160/a','https://user:pass@example.com/a','https://example.com/a?token=private','https://host.internal/a']) assert.equal(domain.warrantyUrl(url), null);
});
const command = { action: 'research', commandId: id, fingerprint: 'a'.repeat(64), reason: 'TEST pesquisa' };
test('contrato estrito recusa autoria injetada e fingerprint ausente', () => {
  assert.equal(domain.warrantyCommandSchema.safeParse(command).success, true);
  assert.equal(domain.warrantyCommandSchema.safeParse({ ...command, actorId: id }).success, false);
  assert.equal(domain.warrantyCommandSchema.safeParse({ ...command, fingerprint: '' }).success, false);
});
const permissions = load('src/lib/permissions.ts');
function harness(options = {}) {
  let writes = 0;
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { cargo: options.role || 'admin' } }) };
  const route = load('src/app/api/produtos/[id]/warranty/route.ts', { zod: require('zod'), 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id } } }) }, from: () => query }), createServiceClient: () => ({}) },
    '@/lib/api-request-auth': { authorizeApiRequest: async () => options.denied ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, userId: id } },
    '@/lib/permissions': permissions, '@/lib/products/bnt-d07-visual-review': { loadBntD07VisualReview: async () => options.fixture ? { items: [{ product: { id } }] } : null },
    '@/lib/product-warranty': domain, '@/services/product-warranty': { loadProductWarranty: async () => ({ context, resolution: resolve() }), manageProductWarranty: async () => { writes++; if (options.conflict) throw Error('warranty_context_changed'); return { context, resolution: resolve() }; } },
  });
  return { writes: () => writes, get: () => route.GET(new Request('http://test/'), { params: Promise.resolve({ id }) }),
    post: (body = command) => route.POST(new Request('http://test/', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) }) };
}
test('GET autenticado, no-store, contexto interno omitido e alçadas corretas', async () => {
  assert.equal((await harness({ anonymous: true }).get()).status, 401);
  for (const role of ['admin','gerente','operador','visualizador']) {
    const response = await harness({ role }).get(); assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json(); assert.equal(data.context, undefined); assert.equal(data.canManage, ['admin','gerente'].includes(role));
  }
});
test('POST protege fixture e permissão antes de efeitos; não afirma escrita ML', async () => {
  for (const [options, status] of [[{ denied: true },403],[{ fixture: true },409]]) {
    const h = harness(options); assert.equal((await h.post()).status, status); assert.equal(h.writes(), 0);
  }
  assert.equal((await harness().post({ ...command, actorId: id })).status, 422);
  assert.equal((await harness({ conflict: true }).post()).status, 409);
  assert.equal((await (await harness().post()).json()).externalListingChanged, false);
});
test('todos os consumidores usam resolução canônica e o bloqueio comercial permanece', () => {
  for (const name of ['schema','sugerir-campo','criar']) {
    const code = fs.readFileSync(`src/app/api/ml/anuncio/${name}/route.ts`, 'utf8');
    assert.match(code, /warrantySaleTerms/); assert.match(code, /warrantyDescription/);
    assert.doesNotMatch(code, /loadMercadoLivreConfiguration|buildSupportedMlWarrantyTerms/);
  }
  assert.equal(require('../src/lib/ml/pricing-execution.js').getPricingExecutionBlock().code, 'pricing_execution_not_ready');
});

function snapshot(overrides = {}) {
  return { context, fingerprint: command.fingerprint, current: null, latest: null, sources, history: [], ...overrides };
}
test('snapshot preserva evidência anterior e expõe falha posterior sem alterar revisão', async () => {
  const current = { id, result: { candidates: [base] } };
  const data = snapshot({ current, latest: { id: 'failed', result: { candidates: [], failure: 'TEST indisponível' } } });
  const result = await service.loadProductWarranty({ rpc: async () => ({ data }) }, id);
  assert.equal(result.resolution.status, 'comprovada'); assert.equal(result.researchWarning, 'TEST indisponível');
  const same = await service.loadProductWarranty({ rpc: async () => ({ data: { ...data, latest: current } }) }, id);
  assert.equal(same.resolution.revision, result.resolution.revision);
});
test('reenvio idempotente não repete pesquisa; nenhuma pesquisa em GET', async () => {
  const calls = [];
  const client = { rpc: async (name) => { calls.push(name); return { data: name === 'begin_product_warranty_command' ? { acquired: false } : snapshot() }; } };
  await service.manageProductWarranty(client, id, id, command);
  assert.deepEqual(calls, ['get_product_warranty_snapshot','begin_product_warranty_command','get_product_warranty_snapshot']);
});
test('preparações concorrentes observam a pesquisa em curso sem novo trabalho', async () => {
  const calls = [];
  const running = { id, action: 'research', state: 'running', created_at: base.collectedAt, reason: 'TEST', actor_id: id, actor_name: 'Test' };
  const client = { rpc: async name => { calls.push(name); return { data: snapshot({ history: [running] }) }; } };
  const result = await service.prepareProductWarranty(client, id, id);
  assert.match(result.resolution.reason, /em andamento/); assert.deepEqual(calls, ['get_product_warranty_snapshot']);
});
test('revisão de outro SKU, prazo contraditório ou país não comprovado falha antes da escrita', async () => {
  const evidence = Object.fromEntries(Object.entries(base).filter(([k]) => !['scope','collectedAt','origin','reviewed'].includes(k)));
  for (const change of [{ identity: 'Outro SKU' },{ brazil: false },{ excerpt: 'Garantia de 24 meses' }]) {
    const calls = [];
    const client = { rpc: async name => { calls.push(name); return { data: snapshot() }; } };
    await assert.rejects(service.manageProductWarranty(client, id, id, { ...command, action: 'review', evidence: { ...evidence, ...change } }), /warranty_review_invalid/);
    assert.deepEqual(calls, ['get_product_warranty_snapshot']);
  }
});
test('pesquisa usa no máximo três páginas e um manual; sem retries', async t => {
  const original = process.env.FIRECRAWL_API_KEY; process.env.FIRECRAWL_API_KEY = 'test-only';
  t.after(() => { if (original === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = original; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), signal: options.signal });
    return Response.json(url.endsWith('/search') ? { data: { web: Array.from({ length: 5 }, (_, i) => ({ url: `https://marca.example.com/p${i}`, markdown: 'proof', links: ['https://marca.example.com/manual.pdf', 'https://marca.example.com/other.pdf'] })) } }
      : { data: { markdown: 'manual', metadata: { sourceURL: 'https://marca.example.com/manual.pdf' } } });
  });
  const research = load('src/services/product-attribute-research.ts', { '@/lib/product-warranty': domain });
  const controller = new AbortController();
  const pages = await research.researchWarrantySources('Produto Exato garantia', controller.signal);
  assert.equal(pages.length, 4); assert.equal(calls.length, 2); assert.equal(calls[0].body.limit, 3);
  assert.equal(calls[0].signal, controller.signal); assert.equal(calls[1].signal, controller.signal);
});
test('falha Firecrawl não repete requisição e não vaza resposta externa', async t => {
  const original = process.env.FIRECRAWL_API_KEY; process.env.FIRECRAWL_API_KEY = 'test-only';
  t.after(() => { if (original === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = original; });
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('private-test-value', { status: 429 }); });
  const research = load('src/services/product-attribute-research.ts', { '@/lib/product-warranty': domain });
  await assert.rejects(research.researchWarrantySources('q', new AbortController().signal), /^Error: warranty_search_unavailable$/); assert.equal(calls, 1);
});
function render(state, disabled = false) {
  const React = require('react'); let index = 0;
  const Component = load('src/components/products/ProductWarrantyControl.tsx', {
    react: { ...React, useState: initial => [index++ === 0 ? state : initial, () => {}], useEffect: () => {}, useCallback: fn => fn, useRef: initial => ({ current: initial }) },
    'react/jsx-runtime': require('react/jsx-runtime'), antd: require('antd'), '@/lib/product-warranty': domain,
  }).default;
  return require('react-dom/server').renderToStaticMarkup(React.createElement(Component, { productId: id, disabled }));
}
test('SSR Ant Design mostra evidência, revisão e bloqueia gestão do leitor', () => {
  const state = { resolution: resolve(), researchConfigured: false, researchWarning: null, currentId: id, history: [], canManage: true };
  const html = render(state); assert.match(html, /Garantia comprovada/); assert.match(html, /12/); assert.match(html, /Revisar evidência/); assert.match(html, /Pesquisa indisponível/);
  assert.doesNotMatch(render({ ...state, canManage: false }), /Revisar evidência|Validar fonte oficial/);
  assert.match(render(state, true), /Amostra protegida/);
});
test('API de configuração antiga responde 410 sem acessar serviço ou auditar escrita', async () => {
  const ts = require('typescript');
  const path = 'src/app/api/configuracoes/mercado-livre/route.ts';
  const deps = Object.fromEntries(ts.preProcessFile(fs.readFileSync(path, 'utf8')).importedFiles.map(i => [i.fileName, {}]));
  const route = load(path, { ...deps, 'next/server': { NextResponse: { json: (b, init) => Response.json(b, init) } },
    '@/lib/supabase': { createClient: async () => ({}), createServiceClient: () => { throw Error('unexpected_service'); } },
    '@/lib/auth/admin': { requireAdminUser: async () => ({ ok: true }) }, '@/lib/configuracoes/contracts': require('../src/lib/configuracoes/contracts.ts') });
  const response = await route.PATCH(new Request('http://test/', { method: 'PATCH', body: JSON.stringify({ section: 'warranty', warrantyTypeId: '2230279', warrantyDuration: 12, warrantyUnit: 'meses' }) }));
  assert.equal(response.status, 410); assert.equal((await response.json()).code, 'global_warranty_retired');
});
test('pesquisa completa persiste candidatos, usa prazo único e sanitiza falha do extrator', async t => {
  const previous = { FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
  process.env.FIRECRAWL_API_KEY = 'test-only'; process.env.OPENROUTER_API_KEY = 'test-only';
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const requests = []; let timeout; let invalid = false;
  t.mock.method(AbortSignal, 'timeout', ms => { timeout = ms; return new AbortController().signal; });
  const evidence = Object.fromEntries(Object.entries(base).filter(([k]) => !['scope','collectedAt','origin','reviewed'].includes(k)));
  t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push({ url, signal: options.signal }); return invalid ? new Response('private-test-value', { status: 401 })
    : Response.json({ choices: [{ message: { content: JSON.stringify({ evidence: [evidence] }) } }] }); });
  const module = load('src/services/product-warranty.ts', { 'server-only': {}, 'node:crypto': require('node:crypto'), zod: require('zod'),
    '@/lib/preferred-offer': require('../src/lib/preferred-offer.ts'), '@/lib/ml-product-facts': require('../src/lib/ml-product-facts.ts'),
    '@/lib/product-warranty': domain, '@/lib/ml-sale-terms': terms,
    './product-attribute-research': { researchWarrantySources: async (_query, signal) => { assert.ok(signal); return [{ url: base.url, content: base.excerpt }]; } } });
  let finish;
  const client = { rpc: async (name, args) => {
    if (name === 'get_product_warranty_snapshot') return { data: snapshot() };
    if (name === 'begin_product_warranty_command') return { data: { acquired: true } };
    if (name === 'finish_product_warranty_command') { finish = args; return {}; }
    throw Error('unexpected_rpc');
  } };
  await module.manageProductWarranty(client, id, id, command);
  assert.equal(timeout, 45000); assert.equal(requests.length, 1); assert.equal(finish.p_result.candidates[0].duration, 12);
  assert.equal(finish.p_result.candidates[0].reviewed, false);
  invalid = true; await module.manageProductWarranty(client, id, id, { ...command, commandId: require('node:crypto').randomUUID() });
  assert.equal(requests.length, 2); assert.deepEqual(finish.p_result.candidates, []); assert.equal(finish.p_result.failure, 'warranty_extraction_unavailable');
});
