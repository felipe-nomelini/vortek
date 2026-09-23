const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const load=require('./helpers/load-integration-module');
const audit=load('src/services/pricing-audit.ts',{zod:require('zod')});
const gate=require('../src/lib/ml/pricing-execution.js');
const domain=load('src/services/pricing-decisions.ts',{zod:require('zod'),'node:crypto':require('crypto'),'./pricing-audit':audit,
  '@/lib/ml/pricing-execution':gate,'./pricing-execution-access':{requirePricingExecutionAccount:async()=>{throw Error('pricing_execution_not_ready')}}});
const id='00000000-0000-4000-8000-000000000001';
function input(){return {sellerId:'123',itemId:'MLB1',currentPriceCents:10000,priceCents:11000,automatic:false,listingSafety:{verified:true,evidence:[]},
  group:{id,version:1,state:'verified',members:[{itemId:'MLB1',variationId:'',catalog:false}],protection:null,inFlight:false},
  pricing:{current:{status:'estimated',memory:{revenueCents:11000,margin:.10,band:{floor:.07},cost:{amountCents:4000,observedAt:'2026-09-08T00:00:00Z',expiresAt:null},fee:{expiresAt:null},shipping:{expiresAt:null}}},target:{ok:true},floor:{ok:true},breakEven:{ok:true},revalidation:{status:'queried'}}};}
test('contexto canônico mantém bloqueios técnicos e converte restrições comerciais em avisos',()=>{
  const i=input();assert.equal(domain.decisionContext(i).executable,true);
  for(const change of [x=>x.group.inFlight=true]){
    const x=input();change(x);assert.equal(domain.decisionContext(x).executable,false);
  }
  const automatic=input();automatic.automatic=true;const automaticContext=domain.decisionContext(automatic);
  assert.equal(automaticContext.executable,true);assert.equal(automaticContext.disableAutomaticPricing,true);
  for(const [change,warning] of [[x=>x.group=null,'GRUPO_NAO_CONFIRMADO'],[x=>x.pricing.revalidation.status='inconclusive','ECONOMIA_INCONCLUSIVA'],
    [x=>x.pricing.current.memory.revenueCents=10999,'ECONOMIA_INCONCLUSIVA'],[x=>x.pricing.current.memory.margin=.06,'PRECO_ABAIXO_DO_PISO'],
    [x=>x.priceCents=10000,'PRECO_JA_APLICADO']]){
    const x=input();change(x);const context=domain.decisionContext(x);assert.equal(context.executable,true);assert.ok(context.warnings.includes(warning));
  }
});
test('identidade/elegibilidade comercial vira aviso e não altera a chave técnica',()=>{
  const i=input();delete i.listingSafety;assert.equal(domain.decisionContext(i).executable,true);assert.ok(domain.decisionContext(i).warnings.includes('IDENTIDADE_OU_ELEGIBILIDADE_NAO_CONFIRMADA'));
  i.listingSafety={verified:false,evidence:[]};assert.equal(domain.decisionContext(i).executable,true);
  const a=input(), b=input();b.listingSafety.evidence=[{field:'BRAND',local:'A',remote:'A'}];
  assert.equal(domain.decisionContext(a).fingerprint,domain.decisionContext(b).fingerprint);
});
test('piloto price_to_win transforma todos os gates em bloqueios e vincula a concorrência',()=>{
  const base=input();base.targetOrigin='price_to_win';base.strictEconomicGates=true;
  base.competition={itemId:'MLB1',priceCents:11000,status:'competing'};
  const approved=domain.decisionContext(base);assert.equal(approved.executable,true);
  assert.equal(approved.targetOrigin,'price_to_win');assert.equal(approved.competitivePriceCents,11000);
  for(const change of [x=>x.group=null,x=>x.listingSafety.verified=false,x=>x.pricing.current.memory.margin=.06,
    x=>x.competition.status='winning',x=>x.competition.priceCents=10999]){
    const candidate=input();candidate.targetOrigin='price_to_win';candidate.strictEconomicGates=true;
    candidate.competition={itemId:'MLB1',priceCents:11000,status:'competing'};change(candidate);
    assert.equal(domain.decisionContext(candidate).executable,false);
  }
});
test('impressão técnica ignora economia e grupo, mas muda com preço observado ou proposto',()=>{
  const a=domain.decisionContext(input());const clock=input();clock.pricing.current.memory.cost.observedAt='2026-09-09T00:00:00Z';assert.equal(a.fingerprint,domain.decisionContext(clock).fingerprint);
  for(const change of [x=>x.currentPriceCents=9999,x=>x.priceCents=12000]){
    const b=input();change(b);assert.notEqual(a.fingerprint,domain.decisionContext(b).fingerprint);
  }
  for(const change of [x=>x.pricing.current.memory.cost.amountCents++,x=>x.group.version++,x=>x.group.protection={id:'OTHER'}]){
    const b=input();change(b);assert.equal(a.fingerprint,domain.decisionContext(b).fingerprint);
  }
});
test('fonte vencida gera aviso e a autorização manual tem janela técnica própria',()=>{
  const i=input();const expires=new Date(Date.now()+10000).toISOString();i.pricing.current.memory.fee.expiresAt=expires;
  assert.ok(Date.parse(domain.decisionContext(i).expiresAt)>Date.now()+14*60*1000);
  i.pricing.current.memory.fee.expiresAt='2000-01-01T00:00:00Z';const context=domain.decisionContext(i);
  assert.equal(context.executable,true);assert.ok(context.warnings.includes('FONTES_EXPIRADAS'));
});
test('decisão manual de um preço não exige projeções de alvo, piso e equilíbrio',()=>{
  const manual=input();manual.manualPriceOnly=true;
  manual.pricing.target={ok:false};manual.pricing.floor={ok:false};manual.pricing.breakEven={ok:false};
  const result=domain.decisionContext(manual);
  assert.equal(result.manualPriceOnly,true);
  assert.equal(result.executable,true);
  assert.equal(result.warnings.includes('ECONOMIA_INCONCLUSIVA'),false);
  const legacy=input();
  assert.equal('manualPriceOnly' in domain.decisionContext(legacy),false);
});
test('agente só libera preço com lucro por venda mantido e cotações vivas',()=>{
  const i=input();
  const memory={resultCents:888,cost:{},fee:{source:'ml_live'},shipping:{source:'ml_live'},tax:{context:{manualRequired:false}}};
  i.requireNonDecreasingProfit=true;
  i.pricing.current.memory={...i.pricing.current.memory,...memory};
  i.pricing.comparisons={actual:{memory:{...memory,resultCents:827}}};
  assert.equal(domain.decisionContext(i).executable,true);
  i.pricing.comparisons.actual.memory.resultCents=889;
  assert.ok(domain.decisionContext(i).reasons.includes('LUCRO_UNITARIO_REDUZIDO'));
  i.pricing.comparisons.actual.memory.resultCents=827;
  i.pricing.current.memory.shipping.source='fallback';
  assert.ok(domain.decisionContext(i).reasons.includes('LUCRO_UNITARIO_INCONCLUSIVO'));
  i.pricing.current.memory.shipping.source='ml_live';
  i.pricing.comparisons.actual.memory=null;
  assert.ok(domain.decisionContext(i).reasons.includes('LUCRO_UNITARIO_INCONCLUSIVO'));
});
test('Buy Box inconclusiva não resolve conflito anterior nem produz prejuízo real',()=>{
  const c=domain.decisionContext(input());assert.equal(domain.pricingAlertObservations(c,{classification:'INCONCLUSIVO'}).some(r=>r.rule==='buy_box_economy'),false);
  const conflict=domain.pricingAlertObservations(c,{classification:'PREJUIZO_NO_PRECO_COMPETITIVO',buyBoxConflict:true}).find(r=>r.rule==='buy_box_economy');assert.equal(conflict.active,true);assert.equal(conflict.severity,'P1');
  assert.equal(domain.pricingAlertObservations(c,{classification:'VIAVEL_NO_ALVO',buyBoxConflict:false}).find(r=>r.rule==='buy_box_economy').active,false);
});
test('preço manual cria operação direta com o ator da sessão', async () => {
  const calls=[];
  const route=load('src/app/api/ml/anuncio/atualizar-preco/route.ts', {
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    zod:require('zod'),
    '@/lib/api-request-auth':{authorizeApiRequest:async()=>({ok:true,userId:id})},
    '@/services/pricing-detail':{loadPricingDetail:async(value,options)=>{
      calls.push(['detail',value,options]);
      return Response.json({evaluationId:id,decisionContext:{executable:true,warnings:['PRECO_ABAIXO_DO_PISO']}});
    }},
    '@/services/pricing-dispatch':{findManualMlCommand:async()=>null,enqueueManualMlCommand:async(evaluationId,operationId,actorId)=>{
      calls.push(['enqueue',evaluationId,operationId,actorId]);
      return {operationId,outboxId:id,state:'queued'};
    }},
  });
  const body={operationId:id,produtoId:id,mlItemId:'MLB123',priceCents:1};
  const response=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify(body)}));
  assert.equal(response.status,202);
  assert.equal(calls[1][3],id);
  assert.equal(calls[0][1].priceCents,1);
  assert.equal((await response.json()).state,'queued');
});

test('confirmação inválida não consulta ML nem enfileira operação', async () => {
  let calls=0;
  const route=load('src/app/api/ml/anuncio/atualizar-preco/route.ts', {
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},zod:require('zod'),
    '@/lib/api-request-auth':{authorizeApiRequest:async()=>({ok:true,userId:id})},
    '@/services/pricing-detail':{loadPricingDetail:async()=>{calls++}},
    '@/services/pricing-dispatch':{findManualMlCommand:async()=>{calls++},enqueueManualMlCommand:async()=>{calls++}},
  });
  const response=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({priceCents:-1})}));
  assert.equal(response.status,422);assert.equal(calls,0);
});

test('a interface não oferece proposta, aprovação ou central de decisões', () => {
  const product=fs.readFileSync('src/app/(app)/produtos/page.tsx','utf8');
  const listing=fs.readFileSync('src/app/(app)/anuncios/page.tsx','utf8');
  assert.doesNotMatch(product+listing,/PricingDecisionCenter|PricingProposalButton|Preparar proposta|Aprovar proposta/);
  assert.match(product,/Republicar no Mercado Livre/);
  assert.match(listing,/ManualMlPriceButton/);
});
