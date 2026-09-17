const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');
const gate = require('../src/lib/ml/pricing-execution.js');

test('test execution is explicit, bound to DEV and exact test seller; legacy writers stay closed', () => {
  const valid = { mode: 'test_only', appUrl: 'https://dev.bentevi.shop', allowedSellerIds: ['123'],
    allowedOperations: ['price_change'],
    account: { id: 123, site_id: 'MLB', tags: ['test_user'] }, sellerId: '123' };
  assert.equal(gate.pricingExecutionAllowed(valid), true);
  assert.equal(gate.pricingOperationAllowed(gate.getPricingExecutionCapability(valid), 'price_change'), true);
  assert.equal(gate.pricingOperationAllowed(gate.getPricingExecutionCapability(valid), 'listing_create'), false);
  assert.equal(gate.getPricingExecutionCapability({ ...valid, allowedSellerIds: [] }).enabled, false);
  for (const patch of [{ mode: undefined }, { mode: 'production' }, { appUrl: 'https://app.bentevi.shop' },
    { appUrl: 'https://dev.bentevi.shop.evil.example' }, { allowedSellerIds: [] }, { sellerId: '124' },
    { account: { id: 123, site_id: 'MLB', tags: ['business'] } }])
    assert.equal(gate.pricingExecutionAllowed({ ...valid, ...patch }), false);
  assert.ok(gate.getPricingExecutionBlock());
});

test('production capability requires the exact runtime, origin, allowlist and a non-test MLB account', () => {
  const valid = { mode: 'production_controlled', runtimeEnvironment: 'production',
    appUrl: 'https://app.bentevi.shop', allowedSellerIds: ['7000000001'], sellerId: '7000000001',
    allowedOperations: ['price_change'],
    account: { id: 7000000001, site_id: 'MLB', tags: ['normal'] } };
  assert.deepEqual(gate.getPricingExecutionCapability(valid), {
    mode: 'production_controlled', enabled: true, target: 'production', allowedOperations: ['price_change'],
  });
  assert.equal(gate.pricingExecutionAllowed(valid), true);
  for (const patch of [{ runtimeEnvironment: 'homologation' }, { appUrl: 'http://app.bentevi.shop' },
    { appUrl: 'https://app.bentevi.shop/path' }, { appUrl: 'https://app.bentevi.shop.evil.example' },
    { appUrl: 'https://user:password@app.bentevi.shop' }, { allowedSellerIds: [] }, { sellerId: '7000000002' },
    { account: { id: 7000000001, site_id: 'MLA', tags: ['normal'] } },
    { account: { id: 7000000001, site_id: 'MLB', tags: ['test_user'] } },
    { account: { id: 7000000001, site_id: 'MLB' } }])
    assert.equal(gate.pricingExecutionAllowed({ ...valid, ...patch }), false);
  assert.deepEqual(gate.getPricingExecutionCapability({ mode: 'unexpected', appUrl: valid.appUrl }), {
    mode: 'disabled', enabled: false, target: null, allowedOperations: [],
  });
});

test('server guard revalidates destination and the exact production token before the claim', async t => {
  const keys = ['ML_PRICING_EXECUTION_MODE','VORTEK_RUNTIME_ENVIRONMENT','NEXT_PUBLIC_APP_URL','ML_ALLOWED_USER_IDS','ML_PRICING_EXECUTION_ALLOWED_OPERATIONS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { ML_PRICING_EXECUTION_MODE:'production_controlled',
    VORTEK_RUNTIME_ENVIRONMENT:'production', NEXT_PUBLIC_APP_URL:'https://app.bentevi.shop',
    ML_ALLOWED_USER_IDS:'7000000001', ML_PRICING_EXECUTION_ALLOWED_OPERATIONS:'price_change' });
  const originalFetch = globalThis.fetch;
  t.after(() => {
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
    globalThis.fetch = originalFetch;
  });
  const calls=[];let destination='192.168.1.162';
  const account={id:7000000001,site_id:'MLB',tags:['normal']};
  const access=load('src/services/pricing-execution-access.ts',{
    'server-only':{},'node:dns/promises':{lookup:async()=>{calls.push('destination');return [{address:destination}]}},
    '@/lib/ml/pricing-execution':gate,'./integration':{fetchMLResult:async()=>{calls.push('account');return {ok:true,data:account}}},
    '@/lib/supabase-url':{resolveSupabaseServiceUrl:()=> 'http://supabase.internal'},
  });
  assert.deepEqual(await access.requirePricingExecutionAccount('7000000001'),{
    sellerId:'7000000001',capability:{mode:'production_controlled',enabled:true,target:'production',allowedOperations:['price_change']},
  });
  globalThis.fetch=async()=>{calls.push('token');return Response.json(account)};
  await access.pricingExecutionTransport('7000000001',async()=>{calls.push('claim')}).validateToken('opaque');
  assert.deepEqual(calls.slice(-3),['destination','token','claim']);
  destination='192.168.1.160';
  await assert.rejects(access.requirePricingExecutionAccount('7000000001'),/pricing_execution_destination_required/);
  assert.equal(calls.at(-1),'destination');
});

test('readback requires BRL, actual numbers and exact seller only on the selected item', () => {
  const item = { price: 110, seller_id: 123, currency_id: 'BRL' };
  assert.equal(gate.pricingReadbackMatches(item, '123', 11000, [{ item, variationId: '' }]), true);
  for (const patch of [{ price: 100 }, { price: '110' }, { seller_id: 124 }, { currency_id: 'USD' }])
    assert.equal(gate.pricingReadbackMatches({ ...item, ...patch }, '123', 11000), false);
  assert.equal(gate.pricingReadbackMatches(item, '123', 11000, [{ item: { ...item, price: 100 }, variationId: '' }]), true);
  assert.equal(gate.pricingReadbackMatches(item, '123', 11000, [{ item: undefined, variationId: '' }]), true);
});

function harness(options = {}) {
  const calls = []; const operation = { id: 'op', state: options.state || 'prepared', item_id: 'MLB1',
    group_id: options.noGroup ? null : 'g', group_version: options.noGroup ? null : 1, produto_id: 'p', actor_id: 'actor', new_price_cents: 11000,
    rule_id:'MANUAL-ML',seller_id:'123',evaluation_id:'e',
    automation_disable_requested_at:null,automation_disabled_at:null };
  const decision = { context: { sellerId: '123', itemId: 'MLB1', priceCents: 11000,
    disableAutomaticPricing:options.automatic===true,fingerprint:'fp',expiresAt:new Date(Date.now()+60000).toISOString() }, fingerprint: 'fp' };
  if(options.creation) {
    Object.assign(operation,{item_id:options.remoteId||null,group_id:null,group_version:null});
    Object.assign(decision.context,{operationKind:'listing_create',itemId:null,preparation:{
      action:options.relist?'relist':'new',sourceItemId:options.relist?'MLB0':null,
      input:{produtoId:'p'},payload:{price:110},expected:{sale_terms:[{id:'WARRANTY_TIME',value_name:'12 meses'}],catalog_listing:options.catalogListing===true},description:'Descrição comprovada'}});
  }
  let automationActive=options.automatic===true;
  const client = { from(table) {
    const q = { select(){return q}, eq(){return q}, is(){return q}, update(body){calls.push([`${table}-update`,body]);Object.assign(operation,table==='pricing_operations'?body:{});return q},
      single: async () => ({data: table === 'pricing_operations' ? { ...operation } : table==='pricing_evaluations' ? {result:{decisionContext:decision.context}} : decision}),
      maybeSingle:async()=>({data:{id:operation.id},error:null}),
      then(resolve){resolve({data: table === 'ml_pricing_group_members' ? [{ml_item_id:'MLB1',variation_id:''},{ml_item_id:'MLB2',variation_id:''}] : []})} };
    return q;
  }, rpc: async (name,args) => {
    if(name==='capture_pricing_created_item'){calls.push(['capture',args.p_item_id]);if(options.captureFailed)return {error:{message:'down'}};operation.item_id=args.p_item_id;return {data:null};}
    if(name==='transition_pricing_operation'){calls.push(['transition',args.p_state]);operation.state=args.p_state;return {data:{applied:true}};}
    calls.push(['claim']); if(options.claimError)return {error:{code:'42702'}};
    if(options.claimDenied)return {data:false}; operation.state='requested';return {data:true};
  } };
  const mod = load('src/services/pricing-dispatch.ts', {
    'server-only': {}, '@/lib/supabase': {createServiceClient:()=>client},
    './integration': {fetchMLResult: async (path, init, transport) => {
      if(path.startsWith('/pricing-automation/items/')) {
        if(init?.method==='DELETE'){await transport.validateToken('opaque');calls.push(['DELETE',path]);automationActive=false;return {ok:true,status:200,data:{}};}
        calls.push(['GET',path]);return automationActive?{ok:true,status:200,data:{}}:{ok:false,status:404,error:{code:'automation_not_found'}};
      }
      if(init?.method==='POST' && (path==='/items'||path.endsWith('/relist'))) {
        await transport.validateToken('opaque');calls.push(['POST',path]);
        if(options.timeout)throw Error('network');return {ok:true,data:{id:'MLB3',seller_id:123,catalog_listing:options.remoteCatalogListing===true}};
      }
      if(init?.method==='POST' && path.endsWith('/description')) {calls.push(['description','POST']);return {ok:!options.descriptionExists};}
      if(init?.method === 'PUT') { await transport.validateToken('opaque'); calls.push(['PUT',path,JSON.parse(init.body)]);
        if(options.timeout)throw Error('network'); return {ok:true}; }
      calls.push(['GET',path]); return {ok:!options.readUnavailable,data:{id:path.split('/').pop(),seller_id:123,currency_id:'BRL',price:options.ignored?100:110}};
    }},
    './pricing-detail': {loadPricingDetail:async(input)=> { calls.push(['revalidate',input.disableAutomaticPricing]);return Response.json({evaluationId:'e',decisionContext:{executable:true,fingerprint:options.changed?'changed':'fp'}});}},
    './pricing-audit': {persistPricingObservations:async()=>({error:null}),transitionPricingOperation:async(_,id,state)=>{calls.push(['transition',state]);operation.state=state;}},
    './pricing-decisions': {},
    './catalog-identity-guard': {assertCatalogIdentityPriceGuard:async()=>{calls.push(['identity-guard']);}},
    './publication-preparation': {preparePublication:async()=>({evaluationId:'e',decisionContext:{fingerprint:'fp'}})},
    './publication-readback': {verifyCreatedPublication:async()=>{calls.push(['creation-readback']);return !options.readUnavailable;}},
    './pricing-execution-access': {requirePricingExecutionAccount:async()=>{if(options.denied)throw Error('denied');return {sellerId:'123',capability:{mode:'test_only',enabled:true,target:'test'}};},pricingExecutionTransport:(_,before)=>({validateToken:async()=>{if(before)await before();}})},
    '@/lib/ml/pricing-execution':gate,
  });
  return { calls, run:()=>mod.dispatchApprovedPricingOperation(client,'outbox','op') };
}

test('one origin write is claimed before sending and only readback confirms', async () => {
  const h=harness();assert.equal(await h.run(),'confirmed');
  assert.deepEqual(h.calls.filter(c=>c[0]==='PUT'),[['PUT','/items/MLB1',{price:110}]]);
  assert.ok(h.calls.findIndex(c=>c[0]==='claim')<h.calls.findIndex(c=>c[0]==='PUT'));
  assert.ok(!h.calls.some(c=>c[0]==='GET'&&c[1]==='/items/MLB2'));
});
test('missing group does not block the selected item and catalog peers remain asynchronous',async()=>{
  const h=harness({noGroup:true});assert.equal(await h.run(),'confirmed');
  assert.deepEqual(h.calls.filter(c=>c[0]==='PUT'),[['PUT','/items/MLB1',{price:110}]]);
  assert.ok(!h.calls.some(c=>c[0]==='GET'&&c[1]==='/items/MLB2'));
});
test('automatic pricing is disabled once and confirmed before the manual price is sent',async()=>{
  const h=harness({automatic:true});assert.equal(await h.run(),'confirmed');
  assert.equal(h.calls.filter(c=>c[0]==='DELETE').length,1);
  assert.ok(h.calls.findIndex(c=>c[0]==='DELETE')<h.calls.findIndex(c=>c[0]==='revalidate'));
  assert.ok(h.calls.findIndex(c=>c[0]==='DELETE')<h.calls.findIndex(c=>c[0]==='PUT'));
  assert.ok(h.calls.some(c=>c[0]==='revalidate'&&c[1]===true));
});
test('2xx ignored or unavailable readback is inconclusive, never success or retry of mutation', async () => {
  for(const options of [{ignored:true},{readUnavailable:true},{timeout:true,ignored:true}]) {
    const h=harness(options);assert.equal(await h.run(),'inconclusive');await h.run();
    assert.equal(h.calls.filter(c=>c[0]==='PUT').length,1);
    assert.ok(!h.calls.some(c=>c[0]==='transition'&&c[1]==='confirmed'));
  }
});
test('lost response reconciles; resumed requested/inconclusive performs zero mutations', async () => {
  const timeout=harness({timeout:true});assert.equal(await timeout.run(),'confirmed');
  for(const state of ['requested','inconclusive']) {const h=harness({state});assert.equal(await h.run(),'confirmed');assert.ok(!h.calls.some(c=>c[0]==='PUT'));}
});
test('wrong account, changed evidence or lost claim cannot send', async () => {
  for(const options of [{denied:true},{claimDenied:true}]) {
    const h=harness(options);await assert.rejects(h.run());assert.ok(!h.calls.some(c=>c[0]==='PUT'));
  }
  const changed=harness({changed:true});assert.equal(await changed.run(),'failed');assert.ok(!changed.calls.some(c=>c[0]==='PUT'));
});
test('database claim failure keeps the remote relist unsent and exposes a safe error code', async () => {
  const h=harness({creation:true,relist:true,claimError:true});
  await assert.rejects(h.run(),/decision_dispatch_not_claimed:42702/);
  assert.ok(!h.calls.some(c=>c[0]==='POST'));
});
test('worker separates approved operations before the unconditional legacy price block', () => {
  const source=fs.readFileSync('src/app/api/sync/anuncios/publish/route.ts','utf8');
  assert.ok(source.indexOf('if (row.pricing_operation_id)')<source.indexOf('if (applyMode.pricingBlocked)'));
  const transport=fs.readFileSync('src/services/integration.ts','utf8');
  assert.match(transport,/res.status === 429 && !execution\?\.singleAttempt/);
  assert.match(transport,/res.status === 401 && !execution\?\.singleAttempt/);
});

test('creation captures remote identity before any post-processing and confirms only after readback',async()=>{
  const h=harness({creation:true});assert.equal(await h.run(),'confirmed');
  assert.ok(h.calls.findIndex(c=>c[0]==='capture')<h.calls.findIndex(c=>c[0]==='description'));
  assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
  assert.ok(h.calls.some(c=>c[0]==='creation-readback'));
});
test('creation replaces a description that the catalog already supplied',async()=>{
  const h=harness({creation:true,descriptionExists:true});assert.equal(await h.run(),'confirmed');
  assert.ok(h.calls.some(c=>c[0]==='description'&&c[1]==='POST'));
  assert.ok(h.calls.some(c=>c[0]==='PUT'&&c[1]==='/items/MLB3/description?api_version=2'
    &&c[2].plain_text==='Descrição comprovada'));
  assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
});
test('creation keeps the official description of a catalog listing',async()=>{
  const h=harness({creation:true,catalogListing:true});assert.equal(await h.run(),'confirmed');
  assert.ok(!h.calls.some(c=>c[0]==='description'));
  assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
});
test('relist respects the catalog status returned by ML even for an older preparation',async()=>{
  const h=harness({creation:true,relist:true,remoteCatalogListing:true});
  assert.equal(await h.run(),'confirmed');
  assert.ok(!h.calls.some(c=>c[0]==='description'));
  assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
});
test('ambiguous creation is never repeated, with or without a persisted remote identity',async()=>{
  for(const options of [{timeout:true},{readUnavailable:true}]) {
    const h=harness({creation:true,...options});assert.equal(await h.run(),'inconclusive');await h.run();
    assert.equal(h.calls.filter(c=>c[0]==='POST').length,1);
  }
  const broken=harness({creation:true,captureFailed:true});await assert.rejects(broken.run(),/publication_remote_capture_failed/);
  assert.equal(await broken.run(),'inconclusive');assert.equal(broken.calls.filter(c=>c[0]==='POST').length,1);
  assert.ok(!broken.calls.some(c=>c[0]==='description'));
});
test('creation recovery with durable remote ID is read-only',async()=>{
  const h=harness({creation:true,state:'requested',remoteId:'MLB3'});assert.equal(await h.run(),'confirmed');
  assert.ok(!h.calls.some(c=>c[0]==='POST'||c[0]==='description'||c[0]==='claim'));
});
test('relist uses the closed source once and reapplies the fixed sale terms after capturing the new ID',async()=>{
  const h=harness({creation:true,relist:true});assert.equal(await h.run(),'confirmed');
  assert.deepEqual(h.calls.filter(c=>c[0]==='POST'),[['POST','/items/MLB0/relist']]);
  assert.ok(h.calls.findIndex(c=>c[0]==='capture')<h.calls.findIndex(c=>c[0]==='PUT'));
  assert.ok(h.calls.some(c=>c[0]==='PUT'&&c[1]==='/items/MLB3'));
});
