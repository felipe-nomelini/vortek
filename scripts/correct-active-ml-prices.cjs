#!/usr/bin/env node
// Revisão pontual autorizada: economia do motor canônico e escrita pelas rotas do ERP.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
require('dotenv').config({ path: '.env.local', quiet: true });
const RUN = 'ACTIVE_ML_TARGET_REVIEW_2026_09_07';
const DIR = path.resolve('reports', RUN);
const SELLER = '3294514937';
const atTarget = m => !!m && m.result > 0 && m.margin + 1e-10 >= m.band.target && m.fee.source === 'ml_live' && m.shipping.source === 'ml_live';
function chooseProduct(item, products, listings) {
  const sku = item.seller_custom_field || item.attributes?.find(a => a.id === 'SELLER_SKU')?.value_name;
  const linked = listings.filter(a => a.ml_item_id === item.id && a.produto_id).map(a => a.produto_id);
  const matched = products.filter(p => p.ml_item_id === item.id || (sku && p.sku === sku)).map(p => p.id);
  const ids = [...new Set([...linked, ...matched])];
  if (ids.length !== 1) throw Error(ids.length ? 'VINCULO_DIVERGENTE' : 'SEM_VINCULO');
  const product = products.find(p => p.id === ids[0]);
  if (!product) throw Error('PRODUTO_AUSENTE');
  return product;
}
module.exports = { atTarget, chooseProduct };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
async function main() {
  const db = require('@supabase/supabase-js').createClient(process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const checked = async q => { const r = await q; if (r.error) throw Error(r.error.message); return r.data; };
  const token = (await checked(db.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single())).access_token;
  async function ml(endpoint, method = 'GET', body) {
    const response = await fetch('https://api.mercadolibre.com' + endpoint, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = null; }
    return { ok: response.ok, status: response.status, data };
  }
  const get = async p => { const r = await ml(p); if (!r.ok) throw Error('ML_' + r.status + ':' + p); return r.data; };
  function load(relative, mocks = {}) {
    const filename = path.resolve(relative), mod = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require: id => mocks[id] ?? require(id.startsWith('@/') ? path.resolve('src', id.slice(2) + '.ts') : id.startsWith('.') ? path.resolve(path.dirname(filename), id) : id), URLSearchParams, Date, Intl, console, Map, Set });
    return mod.exports;
  }
  const diagnostics = [];
  const pricing = require('../src/services/pricing.ts');
  const engine = load('src/services/pricing-context.ts', { './integration': { fetchMLResult: endpoint => ml(endpoint) }, './pricing.ts': { ...pricing, solveQuotedPrice: async input => { const result = await pricing.solveQuotedPrice(input); if (!result.ok) diagnostics.push(result); return result; } } });
  const critical = load('src/lib/ml-critical-attributes.ts');
  fs.mkdirSync(path.join(DIR, 'items'), { recursive: true });
  function save(name, data) { const file = path.join(DIR, name); fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(file + '.tmp', file); }
  const read = name => JSON.parse(fs.readFileSync(path.join(DIR, name)));
  const itemFile = id => 'items/' + id + '.json';
  async function all(table, fields) { const rows = []; for (let i = 0; ; i += 1000) { const page = await checked(db.from(table).select(fields).order('id').range(i, i + 999)); rows.push(...page); if (page.length < 1000) return rows; } }
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  async function mapLimit(rows, concurrency, fn) { let cursor = 0; await Promise.all(Array.from({ length: concurrency }, async () => { while (!stopping && cursor < rows.length) await fn(rows[cursor++]); })); }
  const command = process.argv[2] || 'audit';
  const only = process.argv.find(v => v.startsWith('--items='))?.slice(8).split(',');
  if (command === 'inventory') {
    const ids = new Set(); let scroll; let expected; let pages = 0;
    for (;;) {
      const result = await get('/users/' + SELLER + '/items/search?status=active&search_type=scan&limit=100' + (scroll ? '&scroll_id=' + encodeURIComponent(scroll) : ''));
      expected ??= result.paging?.total; pages++; for (const id of result.results || []) ids.add(id);
      if (!result.results?.length) break;
      scroll = result.scroll_id; if (!scroll) throw Error('PAGINACAO_INCOMPLETA');
    }
    const [products, listings] = await Promise.all([all('produtos', 'id,sku,nome,gtin,marca,ml_item_id,ativo,oferta_preferencial_id,dslite_fornecedor_id'), all('anuncios_ml', 'id,produto_id,ml_item_id,status,pricing_group_id,preco_ml')]);
    save('inventory.json', { run: RUN, at: new Date().toISOString(), seller: SELLER, expected, pages, ids: [...ids], products, listings });
    console.log({ inventory: ids.size, expected, localListings: listings.length }); return;
  }
  const inventory = read('inventory.json');
  const runtime = await engine.loadPricingRuntime(db);
  const ids = only || inventory.ids;
  const evaluate = (productId, itemId, extra = {}) => engine.evaluateProductPricing(db, { productId, itemId, runtime, requireLive: true, ...extra });
  if (command === 'diagnose') {
    for (const id of ids) { const r = read(itemFile(id)); const result = await evaluate(r.productId, id, { objective: 'target' }); save('diagnostic-' + id + '.json', { result, diagnostics: diagnostics.splice(0) }); console.log({ id, failure: result.failure, price: result.memory?.price }); } return;
  }
  if (command === 'audit' || command === 'verify') {
    const persistCurrent = command === 'verify' && process.argv.includes('--persist');
    const reconciler = persistCurrent ? load('src/lib/ml/reconcile-anuncio.ts') : null;
    let count = 0;
    await mapLimit(ids, command === 'verify' ? 8 : 4, async itemId => {
      const existing = fs.existsSync(path.join(DIR, itemFile(itemId))) ? read(itemFile(itemId)) : null;
      if (command === 'audit' && existing?.audit) return;
      const record = existing || { itemId, attempts: [] };
      try {
        const item = await get('/items/' + itemId);
        record.remoteTitle = item.title; record.name ||= item.title;
        if (String(item.seller_id) !== SELLER) throw Error('VENDEDOR_DIVERGENTE');
        if (item.status !== 'active') { record.status = 'NAO_MAIS_ATIVO'; record.remoteStatus = item.status; save(itemFile(itemId), record); return; }
        const product = chooseProduct(item, inventory.products, inventory.listings);
        Object.assign(record, { productId: product.id, sku: product.sku, name: product.nome });
        const [economics, prices] = await Promise.all([evaluate(product.id, itemId), get('/items/' + itemId + '/prices')]);
        const standard = prices.prices?.filter(p => p.type === 'standard' && !p.conditions?.context_restrictions?.length) || [];
        if (standard.length !== 1 || standard[0].amount !== item.price || prices.prices.length !== 1) throw Error('PRECO_DE_VENDA_REQUER_REVISAO');
        const identity = critical.assessMlProductIdentity(item, economics.product, economics.offers);
        const result = { at: new Date().toISOString(), price: item.price, remoteStatus: item.status, memory: economics.memory, failure: economics.failure, identity, prices, relations: item.item_relations, supplierId: economics.memory?.supplierId, quoteContext: economics.context, localLink: inventory.listings.filter(l => l.ml_item_id === itemId) };
        if (persistCurrent && !identity.blockingConflicts.length && economics.memory?.result !== null && economics.memory) {
          const reconciled = await reconciler.reconcileAnuncioMlFromItem(db, item, 'observed_sync');
          if (!reconciled.ok || !reconciled.found) throw Error('RECONCILIACAO_LOCAL_PENDENTE');
          const local = await checked(db.from('anuncios_ml').select('preco_ml,pricing_group_id').eq('ml_item_id', itemId).single());
          if (Number(local.preco_ml) !== item.price) throw Error('PRECO_LOCAL_DIVERGENTE');
          result.persistedEvaluationId = await engine.persistPricingEvaluation(db, { ...economics, scenario: 'current', itemId, groupId: local.pricing_group_id });
        }
        record[command === 'audit' ? 'audit' : 'verification'] = result;
        if (identity.blockingConflicts.length) record.status = 'IDENTIDADE_PENDENTE';
        else if (!economics.memory || economics.memory.result === null || economics.memory.fee.source !== 'ml_live' || economics.memory.shipping.source !== 'ml_live') record.status = 'ECONOMIA_INCONCLUSIVA';
        else record.status = atTarget(economics.memory) ? 'ALVO_VALIDADO' : 'ABAIXO_DO_ALVO';
        delete record.error;
      } catch (e) { record.status = 'PENDENTE'; record.error = e.message; }
      save(itemFile(itemId), record); if (++count % 25 === 0) console.log({ command, processed: count, last: itemId });
    }); return;
  }
  if (command === 'report') {
    const rows = inventory.ids.map(id => fs.existsSync(path.join(DIR, itemFile(id))) ? read(itemFile(id)) : { itemId: id, status: 'NAO_AUDITADO' });
    const statuses = rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
    const supplierNames = Object.fromEntries((await checked(db.from('fornecedores').select('dslite_id,nome,apelido'))).map(s => [s.dslite_id, s.apelido || s.nome]));
    const supplierOf = r => { const m = (r.verification || r.audit)?.memory; const sourceIds = [...new Set((m?.costComponents || []).map(c => c.supplierId).filter(Boolean))]; return m?.supplierId || (sourceIds.length === 1 ? sourceIds[0] : 'INCONCLUSIVO'); };
    const suppliers = {};
    for (const r of rows) { const supplier = supplierOf(r); const group = suppliers[supplier] ??= { name: supplierNames[supplier] || supplier }; group[r.status] = (group[r.status] || 0) + 1; }
    const before = new Map(rows.filter(r => r.audit).map(r => [r.itemId, r.audit.price]));
    for (const row of rows) for (const attempt of row.attempts || []) for (const member of attempt.members || []) before.set(member.id, Math.min(before.get(member.id) ?? Infinity, member.price));
    const changed = rows.filter(r => r.verification?.price > before.get(r.itemId));
    for (const row of changed) { const group = suppliers[supplierOf(row)]; group.changed = (group.changed || 0) + 1; }
    const memoryOf = r => (r.verification || r.audit)?.memory;
    const confirmed = rows.filter(r => atTarget(memoryOf(r)));
    const belowTarget = rows.filter(r => memoryOf(r)?.result !== null && memoryOf(r)?.result !== undefined && !atTarget(memoryOf(r)));
    const initiallyNegative = rows.filter(r => r.audit?.memory?.result < 0);
    const summary = { run: RUN, at: new Date().toISOString(), total: inventory.ids.length, statuses, suppliers, changed: changed.length, economicsAtTarget: confirmed.length, belowTarget: belowTarget.map(r => r.itemId), economicsUnknown: rows.length - confirmed.length - belowTarget.length, initiallyNegative: initiallyNegative.length, initiallyNegativeCorrected: initiallyNegative.filter(r => atTarget(memoryOf(r))).length, automationRemovals: rows.flatMap(r => r.automationRemovals || []).filter(r => r.state === 'REMOVIDA').length };
    const csv = [['anuncio','sku','produto','fornecedor','status','preco_anterior','preco_verificado','margem_verificada','alvo','pendencia'], ...rows.map(r => { const m = (r.verification || r.audit)?.memory; return [r.itemId,r.sku,r.name,supplierNames[supplierOf(r)] || supplierOf(r),r.status,before.get(r.itemId),r.verification?.price,m?.margin,m?.band?.target,r.status === 'ALVO_VALIDADO' ? '' : r.error || (r.verification || r.audit)?.failure || (r.verification || r.audit)?.identity?.blockingConflicts?.map(c => c.field + ': cadastro=' + c.expected + ', ML=' + c.remote).join(' | ') || m?.reasons?.join(' | ') || '']; })].map(row => row.map(v => '"' + String(v ?? '').replaceAll('"','""') + '"').join(';')).join('\n');
    fs.writeFileSync(path.join(DIR, 'anuncios.csv'), '\uFEFF' + csv + '\n');
    save('summary.json', summary); console.log(summary); return;
  }
  if (command === 'reconcile') {
    const reconciler = load('src/lib/ml/reconcile-anuncio.ts');
    const reconciliationGroups = [...Map.groupBy(ids.filter(id => fs.existsSync(path.join(DIR, itemFile(id)))), id => read(itemFile(id)).productId || id).values()];
    await mapLimit(reconciliationGroups, 4, async groupIds => { for (const id of groupIds) {
      if (!fs.existsSync(path.join(DIR, itemFile(id)))) continue;
      const record = read(itemFile(id));
      for (const attempt of record.attempts.filter(a => ['APLICACAO_SOLICITADA', 'INCONCLUSIVA'].includes(a.state))) {
        const applied = await checked(db.from('pricing_events').select('id').eq('event_type', 'APPLIED').contains('payload', { approvalId: attempt.approval.approvalId }).limit(1));
        if (!applied.length) {
          const failed = await checked(db.from('pricing_events').select('payload').eq('event_type', 'APPLY_INCONCLUSIVE').contains('payload', { approvalId: attempt.approval.approvalId }));
          const rejectedBeforeWrite = attempt.apply?.status === 409 && attempt.apply?.data?.error === 'GRUPO_ECONOMICO_DIVERGENTE';
          if (rejectedBeforeWrite || failed.some(e => [400, 422].includes(e.payload.remoteStatus))) {
            const unchanged = await Promise.all(attempt.members.map(m => get('/items/' + m.id)));
            if (unchanged.every(m => m.price === attempt.members.find(before => before.id === m.id).price)) {
              attempt.state = 'REJEITADA_SEM_ALTERACAO'; record.status = 'ABAIXO_DO_ALVO';
              attempt.reconciliation = { at: new Date().toISOString(), reason: 'Requisição rejeitada; todos os preços anteriores permanecem confirmados.', failed };
              delete record.error; save(itemFile(id), record);
            }
          }
          continue;
        }
        let members = await Promise.all(attempt.members.map(m => get('/items/' + m.id)));
        const divergent = members.filter(m => m.price !== attempt.simulation.memory.price);
        const unavailablePeers = divergent.length > 0 && divergent.every(m => m.id !== id && m.status === 'under_review' && m.sub_status?.includes('forbidden'));
        if (divergent.length && !unavailablePeers) { console.log({ id, reconciliation: 'AGUARDANDO_PAR', prices: members.map(m => ({ id: m.id, price: m.price, status: m.status })) }); continue; }
        if (unavailablePeers) {
          attempt.unavailablePeers = divergent.map(m => ({ id: m.id, price: m.price, status: m.status, subStatus: m.sub_status }));
          members = members.filter(m => !divergent.some(d => d.id === m.id));
        }
        for (const member of members) {
          const result = await reconciler.reconcileAnuncioMlFromItem(db, member, 'observed_sync');
          if (!result.ok || !result.found) throw Error('RECONCILIACAO_LOCAL_PENDENTE');
          const economics = await evaluate(record.productId, member.id);
          if (inventory.ids.includes(member.id)) {
            const sibling = member.id === record.itemId ? record : fs.existsSync(path.join(DIR, itemFile(member.id))) ? read(itemFile(member.id)) : { itemId: member.id, productId: record.productId, sku: record.sku, name: record.name, attempts: [] };
            sibling.verification = { at: new Date().toISOString(), price: member.price, remoteStatus: member.status, memory: economics.memory };
            sibling.status = atTarget(economics.memory) ? 'ALVO_VALIDADO' : 'ABAIXO_DO_ALVO';
            delete sibling.error;
            save(itemFile(member.id), sibling);
          }
        }
        await checked(db.from('produtos').update({ custom_price: attempt.simulation.memory.price }).eq('id', record.productId));
        attempt.state = unavailablePeers ? 'ATIVOS_CONFIRMADOS_PAR_BLOQUEADO_ML' : 'RECONCILIADA'; delete record.error; save(itemFile(id), record);
        console.log({ id, reconciliation: 'CONFIRMADA_SEM_NOVA_ESCRITA_ML' });
      }
    } });
    return;
  }
  if (command !== 'apply') throw Error('COMANDO_INVALIDO');
  process.env.BATCH_API_URL = 'http://localhost:3000';
  const { appRuntime } = require('./catalog-expansion-batch-01.cjs');
  const { app, actor } = await appRuntime();
  async function endObservation(record) {
    const experiment = await checked(db.from('sync_runtime_config').select('value').eq('key', 'pricing_experiment_high_margin_zero_traffic_2026_09').maybeSingle());
    const state = experiment?.value ? JSON.parse(experiment.value) : null;
    const observations = [];
    if (state && state.status !== 'closed') for (const group of state.groups || []) {
      if (group.product_id === record.productId && ['active', 'awaiting_director_decision'].includes(group.status)) observations.push({ experimentId: state.experiment_id, groupId: group.pricing_group_id });
    }
    const launches = await checked(db.from('pricing_events').select('id,payload').eq('event_type', 'RADAR_LAUNCH_VALIDATED').eq('produto_id', record.productId));
    for (const launch of launches) if (Date.parse(launch.payload.observationUntil) > Date.now()) observations.push({ launchEventId: launch.id });
    for (const observation of observations) {
      const key = 'end-observation:' + (observation.launchEventId || observation.experimentId + ':' + observation.groupId);
      const existing = await checked(db.from('pricing_events').select('id').eq('dedupe_key', key).maybeSingle());
      if (existing) continue;
      await engine.recordPricingEvent(db, { event_type: 'PRICING_OBSERVATION_ENDED', produto_id: record.productId, ml_item_id: record.itemId, pricing_group_id: observation.groupId || null, pricing_source: 'manual_review', actor, reason: 'Usuário determinou priorizar margem-alvo e encerrar testes impeditivos somente nos anúncios afetados.', rule_id: runtime.policy.version, dedupe_key: key, payload: { ...observation, run: RUN, sku: record.sku } });
      console.log({ itemId: record.itemId, observationEnded: key });
    }
  }
  async function call(endpoint, body) { const r = await app(endpoint, 'POST', body); if (!r.ok || !r.data.success) throw Error(r.data.error || JSON.stringify(r.data)); return r; }
  const manualPrice = Number(process.argv.find(v => v.startsWith('--price='))?.slice(8)) || null;
  if (manualPrice && !only) throw Error('PRECO_MANUAL_EXIGE_ITENS_EXPLICITOS');
  const allRecords = inventory.ids.map(id => read(itemFile(id)));
  const selected = ids.map(id => read(itemFile(id))).filter(r => r.status === 'ABAIXO_DO_ALVO').sort((a, b) => Number(['MLB7149374856', 'MLB7314819690'].includes(b.itemId)) - Number(['MLB7149374856', 'MLB7314819690'].includes(a.itemId)) || a.audit.memory.margin - b.audit.memory.margin);
  const groups = [...Map.groupBy(selected, r => r.productId).values()];
  await mapLimit(groups, 8, async rows => { for (const selectedRecord of rows) {
    const record = read(itemFile(selectedRecord.itemId));
    const pendingGroup = allRecords.filter(r => r.productId === record.productId).map(r => read(itemFile(r.itemId))).some(r => r.itemId !== record.itemId && r.attempts.some(a => ['APLICACAO_SOLICITADA', 'INCONCLUSIVA'].includes(a.state)));
    if (pendingGroup) continue;
    if (record.status !== 'ABAIXO_DO_ALVO') continue;
    const persist = () => save(itemFile(record.itemId), record);
    try {
      if (record.attempts.some(a => a.state === 'APLICACAO_SOLICITADA' || a.state === 'INCONCLUSIVA')) throw Error('RECONCILIAR_APLICACAO_ANTERIOR');
      const item = await get('/items/' + record.itemId);
      if (item.status !== 'active') throw Error('ESTADO_MUDOU');
      const current = await evaluate(record.productId, record.itemId);
      if (critical.assessMlProductIdentity(item, current.product, current.offers).blockingConflicts.length) throw Error('IDENTIDADE_PENDENTE');
      if (atTarget(current.memory)) { record.status = 'ALVO_VALIDADO'; record.verification = { at: new Date().toISOString(), memory: current.memory, price: item.price }; persist(); continue; }
      let members = [item];
      if (item.item_relations?.length) {
        const sync = await get('/public/buybox/sync/' + item.id);
        if (!['SYNC', 'UNSYNC'].includes(sync.status)) throw Error('SINCRONIA_INCONCLUSIVA');
        if (sync.status === 'SYNC') members = await Promise.all([...new Set([item.id, ...item.item_relations.map(r => r.id)])].map(id => get('/items/' + id)));
      }
      let price = Math.max(...members.map(m => m.price));
      for (const member of members) {
        if (chooseProduct(member, inventory.products, inventory.listings).id !== record.productId) throw Error('GRUPO_ECONOMICO_DIVERGENTE');
        const target = await evaluate(record.productId, member.id, manualPrice ? { price: manualPrice } : { objective: 'target' });
        if (!atTarget(target.memory)) throw Error(target.failure || 'ALVO_INCONCLUSIVO');
        price = Math.max(price, target.memory.price);
      }
      for (const member of members) if (!atTarget((await evaluate(record.productId, member.id, { price })).memory)) throw Error('ALVO_DO_GRUPO_REQUER_REVISAO');
      await endObservation(record);
      for (const member of members.filter(m => m.tags?.includes('dynamic_standard_price'))) {
        const endpoint = '/pricing-automation/items/' + member.id + '/automation';
        const automation = await ml(endpoint);
        if (automation.status === 404) continue;
        if (!automation.ok || !members.some(m => m.id === automation.data.item_id)) throw Error('AUTOMACAO_INCONCLUSIVA');
        const removal = { at: new Date().toISOString(), before: automation.data, state: 'REMOCAO_SOLICITADA' };
        (record.automationRemovals ??= []).push(removal); persist();
        const response = await ml('/pricing-automation/items/' + automation.data.item_id + '/automation', 'DELETE');
        const readback = await ml('/pricing-automation/items/' + automation.data.item_id + '/automation');
        removal.response = response; removal.readback = readback;
        removal.state = response.ok && readback.status === 404 ? 'REMOVIDA' : 'INCONCLUSIVA'; persist();
        if (removal.state !== 'REMOVIDA') throw Error('REMOCAO_AUTOMACAO_PENDENTE');
      }
      for (const removal of record.automationRemovals || []) if (removal.state === 'REMOVIDA') {
        await engine.recordPricingEvent(db, { event_type: 'PRICING_AUTOMATION_ENDED', produto_id: record.productId, ml_item_id: removal.before.item_id, actor, pricing_source: 'manual_review', rule_id: runtime.policy.version, dedupe_key: RUN + ':automation-ended:' + removal.before.item_id, reason: 'Usuário autorizou priorizar margem-alvo sobre exceção comercial impeditiva.', payload: { run: RUN, before: removal.before } });
      }
      if (record.automationRemovals?.length) {
        const refreshed = await Promise.all(members.map(m => get('/items/' + m.id)));
        if (refreshed.some(m => m.tags?.includes('dynamic_standard_price'))) throw Error('AUTOMACAO_REMOVIDA_AGUARDA_CONFIRMACAO_ML');
        if (refreshed.some(m => m.price !== members.find(before => before.id === m.id).price)) throw Error('PRECO_MUDOU_APOS_AUTOMACAO');
      }
      const simulation = await call('/api/pricing/simulate', { productId: record.productId, itemId: item.id, price });
      if (!atTarget(simulation.data.memory) || price <= item.price) throw Error('ALVO_INCONSISTENTE');
      const approval = await call('/api/pricing/approve', { evaluationId: simulation.data.evaluationId, acknowledgeEstimates: true, reason: RUN + ': usuário autorizou corrigir todos os ativos abaixo do alvo, preservando preços superiores; imposto central estimado reconhecido.' });
      const attempt = { at: new Date().toISOString(), before: current.memory, members: members.map(m => ({ id: m.id, price: m.price, status: m.status })), simulation: simulation.data, approval: approval.data, state: 'APLICACAO_SOLICITADA' };
      record.attempts.push(attempt); persist();
      const apply = await app('/api/ml/anuncio/atualizar-preco', 'POST', { produtoId: record.productId, mlItemId: item.id, approvalId: approval.data.approvalId, targetPrice: price });
      attempt.apply = apply; attempt.state = apply.ok && apply.data.success ? 'APLICADA' : 'INCONCLUSIVA'; persist();
      if (attempt.state !== 'APLICADA') throw Error(apply.data.error || 'APLICACAO_INCONCLUSIVA');
      for (const member of members) {
        const remote = await get('/items/' + member.id), economics = await evaluate(record.productId, member.id);
        const local = await checked(db.from('anuncios_ml').select('preco_ml,status').eq('ml_item_id', member.id).single());
        if (remote.price !== price || Number(local.preco_ml) !== price || remote.status !== member.status || !atTarget(economics.memory)) throw Error('CONFERENCIA_POS_APLICACAO_PENDENTE');
        if (inventory.ids.includes(member.id)) { const sibling = member.id === record.itemId ? record : fs.existsSync(path.join(DIR, itemFile(member.id))) ? read(itemFile(member.id)) : { itemId: member.id, productId: record.productId, sku: record.sku, name: record.name, attempts: [] }; sibling.status = 'ALVO_VALIDADO'; delete sibling.error; sibling.verification = { at: new Date().toISOString(), price, remoteStatus: remote.status, memory: economics.memory }; save(itemFile(member.id), sibling); }
      }
      record.status = 'ALVO_VALIDADO'; delete record.error; persist(); console.log({ itemId: record.itemId, sku: record.sku, price, status: record.status });
    } catch (e) { record.status = 'CORRECAO_PENDENTE'; record.error = e.message; persist(); console.log({ itemId: record.itemId, status: record.status, error: e.message }); }
  } });
}
