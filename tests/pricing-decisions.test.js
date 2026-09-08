const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const load=require('./helpers/load-integration-module');
const audit=load('src/services/pricing-audit.ts',{zod:require('zod')});
const gate=require('../src/lib/ml/pricing-execution.js');
const domain=load('src/services/pricing-decisions.ts',{zod:require('zod'),'node:crypto':require('crypto'),'./pricing-audit':audit,'@/lib/ml/pricing-execution':gate});
const id='00000000-0000-4000-8000-000000000001';
function input(){return {sellerId:'123',itemId:'MLB1',currentPriceCents:10000,priceCents:11000,automatic:false,listingSafety:{verified:true,evidence:[]},
  group:{id,version:1,state:'verified',members:[{itemId:'MLB1',variationId:'',catalog:false}],protection:null,inFlight:false},
  pricing:{current:{status:'estimated',memory:{revenueCents:11000,margin:.10,band:{floor:.07},cost:{amountCents:4000,observedAt:'2026-09-08T00:00:00Z',expiresAt:null},fee:{expiresAt:null},shipping:{expiresAt:null}}},target:{ok:true},floor:{ok:true},breakEven:{ok:true},revalidation:{status:'queried'}}};}
test('contexto canônico exige grupo, memória e revalidação; não calcula preço',()=>{
  const i=input();assert.equal(domain.decisionContext(i).executable,true);
  for(const change of [x=>x.group=null,x=>x.group.inFlight=true,x=>x.automatic=true,x=>x.pricing.revalidation.status='inconclusive',x=>x.pricing.current.memory.revenueCents=10999,x=>x.pricing.current.memory.margin=.06,x=>x.priceCents=10000]){
    const x=input();change(x);assert.equal(domain.decisionContext(x).executable,false);
  }
});
test('identidade e elegibilidade atuais são obrigatórias; evidência material invalida aprovação',()=>{
  const i=input();delete i.listingSafety;assert.equal(domain.decisionContext(i).executable,false);
  i.listingSafety={verified:false,evidence:[]};assert.equal(domain.decisionContext(i).executable,false);
  const a=input(), b=input();b.listingSafety.evidence=[{field:'BRAND',local:'A',remote:'A'}];
  assert.notEqual(domain.decisionContext(a).fingerprint,domain.decisionContext(b).fingerprint);
});
test('impressão material ignora coleta, mas muda com preço/custo/grupo/override',()=>{
  const a=domain.decisionContext(input());const clock=input();clock.pricing.current.memory.cost.observedAt='2026-09-09T00:00:00Z';assert.equal(a.fingerprint,domain.decisionContext(clock).fingerprint);
  for(const change of [x=>x.currentPriceCents=9999,x=>x.pricing.current.memory.cost.amountCents++,x=>x.group.version++,x=>x.group.protection={id:'OTHER'}]){
    const b=input();change(b);assert.notEqual(a.fingerprint,domain.decisionContext(b).fingerprint);
  }
});
test('validade limitada à fonte; fonte vencida não autoriza',()=>{
  const i=input();const expires=new Date(Date.now()+10000).toISOString();i.pricing.current.memory.fee.expiresAt=expires;
  assert.equal(domain.decisionContext(i).expiresAt,expires);
  i.pricing.current.memory.fee.expiresAt='2000-01-01T00:00:00Z';assert.equal(domain.decisionContext(i).executable,false);
});
test('Buy Box inconclusiva não resolve conflito anterior nem produz prejuízo real',()=>{
  const c=domain.decisionContext(input());assert.equal(domain.pricingAlertObservations(c,{classification:'INCONCLUSIVO'}).some(r=>r.rule==='buy_box_economy'),false);
  const conflict=domain.pricingAlertObservations(c,{classification:'PREJUIZO_NO_PRECO_COMPETITIVO',buyBoxConflict:true}).find(r=>r.rule==='buy_box_economy');assert.equal(conflict.active,true);assert.equal(conflict.severity,'P1');
  assert.equal(domain.pricingAlertObservations(c,{classification:'VIAVEL_NO_ALVO',buyBoxConflict:false}).find(r=>r.rule==='buy_box_economy').active,false);
});
test('contratos rejeitam autor forjado, dados extras e adiamento sem data',()=>{
  const command={commandId:id,action:'approve',reason:'Teste'};assert.equal(domain.decisionCommandSchema.safeParse(command).success,true);
  assert.equal(domain.decisionCommandSchema.safeParse({...command,actorId:id}).success,false);
  assert.equal(domain.decisionCommandSchema.safeParse({...command,action:'defer'}).success,false);
  assert.equal(domain.decisionCommandSchema.safeParse({...command,deferredUntil:'2026-09-09T12:00:00Z'}).success,false);
});
test('gate bloqueia antes de revalidar ou consumir e não aceita parâmetro de bypass',async()=>{
  let calls=0;await assert.rejects(domain.consumePricingDecision({rpc:async()=>{calls++;}}, {decisionId:id,operationId:id,actorId:id},async()=>{calls++;return id;}),/pricing_execution_not_ready/);assert.equal(calls,0);
});
function harness(options={}){
  const calls=[];let live=0;const decision={id,state:options.state||'pending',context:{itemId:'MLB1',priceCents:11000},alert:{produto_id:id}};
  const client={from(table){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:table==='pricing_events'?(options.replay?{id:1}:null):decision,error:null})};return q;},rpc:async(name,args)=>{calls.push({name,args});return {data:{state:'approved',executionBlocked:true},error:options.rpcError?{message:options.rpcError}:null};}};
  const routes=load('src/app/api/pricing/decisions/route.ts',{
    'next/server':{NextResponse:{json:(b,i)=>Response.json(b,i)}},zod:require('zod'),
    '@/lib/api-request-auth':{authorizeApiRequest:async()=>options.denied?{ok:false,response:Response.json({}, {status:403})}:{ok:true,userId:id}},
    '@/lib/permissions':{hasPermission:()=>true},'@/lib/supabase':{createServiceClient:()=>client},
    '@/services/pricing-detail':{loadPricingDetail:async()=>{live++;return Response.json(options.liveError?{error:'ML indisponível'}:{evaluationId:id},{status:options.liveError?503:200});}},
    '@/services/pricing-decisions':domain,
  });
  return {calls,live:()=>live,post:body=>routes.POST(new Request('http://local',{method:'POST',body:JSON.stringify(body)}))};
}
test('API checa permissão e validação antes de leitura comercial/escrita',async()=>{
  const h=harness({denied:true});assert.equal((await h.post({})).status,403);assert.equal(h.calls.length,0);
  const invalid=harness();assert.equal((await invalid.post({action:'prepare',actorId:id})).status,422);assert.equal(invalid.live(),0);assert.equal(invalid.calls.length,0);
});
test('API aprovação revalida no servidor e origem do autor nunca vem do body',async()=>{
  const h=harness();const r=await h.post({decisionId:id,command:{commandId:id,action:'approve',reason:'Teste'}});assert.equal(r.status,200);assert.equal(h.live(),1);assert.equal(h.calls[0].args.p_actor_id,id);assert.equal(h.calls[0].args.p_fresh_evaluation_id,id);
});
test('falha ML conserva decisão; replay e rejeição não provocam outra consulta',async()=>{
  const down=harness({liveError:true});assert.equal((await down.post({decisionId:id,command:{commandId:id,action:'approve',reason:'Teste'}})).status,503);assert.equal(down.calls.length,0);
  for(const options of [{replay:true},{action:'reject'}]){const h=harness(options);await h.post({decisionId:id,command:{commandId:id,action:options.action||'approve',reason:'Teste'}});assert.equal(h.live(),0);assert.equal(h.calls.length,1);}
});
test('erros desconhecidos não vazam payloads de backend',async()=>{
  const h=harness({rpcError:'private-config-value'});const r=await h.post({action:'prepare',commandId:id,evaluationId:id,reason:'Teste'});assert.equal(r.status,503);assert.equal((await r.text()).includes('private-config-value'),false);
});
test('interface única conserva ações explícitas, estados separados e não publica',()=>{
  const ui=fs.readFileSync('src/components/products/PricingDecisionCenter.tsx','utf8');
  for(const label of ['Alertas e decisões','Aprovar proposta','Rejeitar','Adiar','aplicação bloqueada pelo gate','Motivo obrigatório','Histórico','Registrar proposta'])assert.ok(ui.includes(label));
  assert.doesNotMatch(ui,/setInterval|setTimeout|atualizar-preco|enqueueMlPublishOutbox/);assert.match(ui,/command\s*\?\?/);assert.match(ui,/generation\.current/);
  const roles=load('src/lib/permissions.ts');for(const role of ['admin','gerente'])assert.equal(roles.hasPermission(role,'pricing.decisions.manage'),true);
  for(const role of ['operador','visualizador']){assert.equal(roles.hasPermission(role,'pricing.decisions.manage'),false);assert.equal(roles.hasPermission(role,'pricing.read'),true);}
});

test('leitura deriva expiração e filtra a decisão atual, sem alterar a auditoria',async()=>{
  const calls=[];const expired={id,state:'approved',expires_at:'2000-01-01T00:00:00Z',operation_id:null};
  const client={from(table){const q={
    select(value){calls.push(['select',table,value]);return q},
    eq(...args){calls.push(['eq',...args]);return q},is(){return q},
    or(...args){calls.push(['or',...args]);return q},order(...args){calls.push(['order',...args]);return q},
    range(){return q},single:async()=>({data:{cargo:'admin'},error:null}),
    then(resolve){resolve({data:[{id,decisions:expired}],count:1,error:null})},
  };return q;}};
  const routes=load('src/app/api/pricing/decisions/route.ts',{
    'next/server':{NextResponse:{json:(b,i)=>Response.json(b,i)}},zod:require('zod'),
    '@/lib/api-request-auth':{authorizeApiRequest:async()=>({ok:true,userId:id})},
    '@/lib/permissions':{hasPermission:()=>true},'@/lib/supabase':{createServiceClient:()=>client},
    '@/services/pricing-detail':{loadPricingDetail:async()=>{throw Error('unexpected_live_read')}},
    '@/services/pricing-decisions':domain,
  });
  const r=await routes.GET(new Request('http://local/api/pricing/decisions?decision=expired'));
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.data[0].decisions[0].state,'expired');assert.equal(expired.state,'approved');
  assert.ok(calls.some(c=>c[0]==='select'&&c[2].includes('pricing_alerts_latest_decision_id_fkey!inner')));
  assert.ok(calls.some(c=>c[0]==='or'&&c[1].includes('operation_id.is.null')));
  assert.deepEqual(calls.find(c=>c[0]==='order'),['order','severity_order',{ascending:true}]);
});
