const test=require('node:test'),assert=require('node:assert/strict');
const {resolveWarranty,warrantySaleTerms,normalizeMlWarrantyTime,normalizeMlSaleTerms}=require('../src/lib/ml-sale-terms.ts');
const {strategyIsCurrent,loadGroupStrategies}=require('../src/services/pricing-strategy.ts');
const {evaluateEconomics,unitResult}=require('../src/services/pricing.ts');
const {PRICING_POLICY,validatePricingPolicy}=require('../src/services/pricing-policy.ts');
const at='2026-09-06T00:00:00Z',subject={productId:'p',gtin:'789',offerId:'o'};
const evidence=(origin,duration=12,extra={})=>({...subject,origin,duration,unit:'meses',source:'Documento do produto p',observedAt:at,...extra});
const durability=kind=>({productId:'p',gtin:'789',kind,source:'Classificação revisada do produto',observedAt:at});
const resolve=(e=[],d)=>resolveWarranty({...subject,evidence:e,durability:d});
const schemas=[{id:'WARRANTY_TYPE',values:[{id:'2230279',name:'Garantia de fábrica'},{id:'2230280',name:'Garantia do vendedor'}]},{id:'WARRANTY_TIME',value_type:'number_unit',allowed_units:[{id:'dias'},{id:'meses'},{id:'anos'}]}];
test('fabricante comprovado prevalece sobre fornecedor divergente',()=>{
 const w=resolve([evidence('GARANTIA_FORNECEDOR',3),evidence('FABRICANTE',6)]);
 assert.equal(w.origin,'FABRICANTE');assert.equal(w.duration,6);assert.equal(warrantySaleTerms(w,schemas)[0].value_id,'2230279');
});
test('garantia de fornecedor mantém origem e não vira fabricante no ML',()=>{
 const w=resolve([evidence('GARANTIA_FORNECEDOR',3)]);assert.equal(w.origin,'GARANTIA_FORNECEDOR');assert.equal(warrantySaleTerms(w,schemas)[0].value_id,'2230280');
});
test('ausência contratual usa classificação comprovada: legal 30/90',()=>{
 for(const [kind,days] of [['durable',90],['non_durable',30]]){const w=resolve([],durability(kind));assert.equal(w.origin,'GARANTIA_LEGAL');assert.equal(w.duration,days);assert.equal(warrantySaleTerms(w,schemas)[1].value_name,`${days} dias`);}
});
test('granel e evidência de outro SKU não resolvem durabilidade nem inventam prazo',()=>{
 const w=resolve([evidence('FABRICANTE',12,{productId:'other'})]);assert.equal(w.status,'pending');
 assert.equal(resolve([],durability('unknown')).status,'pending');
 assert.equal(resolve([evidence('GARANTIA_FORNECEDOR',12,{offerId:'other'})]).status,'pending');
});
test('contradição na mesma precedência e duração inválida exigem revisão',()=>{
 assert.equal(resolve([evidence('FABRICANTE',12),evidence('FABRICANTE',6)]).reason,'GARANTIA_FONTES_CONTRADITORIAS');
 for(const duration of [0,-1,NaN,Infinity,1.2])assert.equal(resolve([evidence('FABRICANTE',duration)]).reason,'GARANTIA_EVIDENCIA_INVALIDA');
});
test('normalização nunca cria 12 meses ou escolhe primeiro termo',()=>{
 assert.deepEqual(normalizeMlSaleTerms([]),[]);for(const v of [null,'','invalido','0 dias'])assert.equal(normalizeMlWarrantyTime(v),'');
 const w=resolve([evidence('FABRICANTE',6)]);
 assert.throws(()=>warrantySaleTerms(w,[schemas[0],{id:'WARRANTY_TIME',value_type:'list',values:[{id:'1',name:'12 meses'}]}]),/DURACAO_NAO_ACEITA/);
 assert.throws(()=>warrantySaleTerms(w,[]),/REPRESENTACAO_ML/);
});
test('validade acima de 30 dias e até revogação são explícitas; ausência não autoriza',()=>{
 const now=Date.parse(at);assert.equal(strategyIsCurrent({validUntil:'2027-12-01'},now),true);
 assert.equal(strategyIsCurrent({untilRevoked:true,validUntil:null},now),true);
 assert.equal(strategyIsCurrent({validUntil:null},now),false);assert.equal(strategyIsCurrent({},now),false);
 assert.equal(strategyIsCurrent({untilRevoked:true,validUntil:'2027-01-01'},now),false);
 assert.equal(strategyIsCurrent({validUntil:'2026-01-01'},now),false);
});
test('revogação explícita remove proteção do grupo sem depender de custom_price',async()=>{
 let events=[{id:'override',event_type:'STRATEGY_REGISTERED',pricing_group_id:'g',payload:{kind:'manual_pricing_override',untilRevoked:true,validUntil:null}}];
 const client={from:()=>{const q={select:()=>q,eq:()=>q,in:()=>q,order:async()=>({data:events,error:null})};return q;}};
 assert.equal((await loadGroupStrategies(client,'g')).length,1);
 events.push({id:'revoke',event_type:'STRATEGY_REVOKED',payload:{strategyId:'override'}});
 assert.equal((await loadGroupStrategies(client,'g')).length,0);
});
test('tabela comercial rejeita percentuais alterados sem nova homologação',()=>{
 const modified=structuredClone(PRICING_POLICY);modified.bands[0].floor=.1;assert.throws(()=>validatePricingPolicy(modified));
 assert.equal(validatePricingPolicy(PRICING_POLICY),PRICING_POLICY);
});
test('campos econômicos órfãos não afetam fórmula nem novas memórias',()=>{
 const amount=n=>({amount:n,source:'ml_live',observedAt:at,evidence:'ML'});
 const m=evaluateEconomics({price:100,cost:60,offerId:'o',supplierId:'s',costObservedAt:at,fee:amount(10),shipping:amount(5),tax:{rate:.05,status:'confirmed',referenceMonth:'2026-09'},evaluatedAt:at,variableCosts:{amount:1000,source:'confirmed'},margem_lucro:30,minProfit:150});
 assert.equal(m.result,20);assert.equal(m.status,'available');assert.equal('variableCosts' in m,false);assert.equal('minProfit' in m,false);
 assert.equal(unitResult({revenue:100,cost:60,fee:10,shipping:5,tax:5,variableCosts:NaN}),20);
});

function automaticFixture({margin=.02, strategies=[], sales=0}={}) {
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
 const filename=path.resolve('src/lib/ml/automatic-pricing.ts'),mod={exports:{}},calls=[],events=[];
 const client={from: table=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'p',sku:'sku',ativo:true,ml_item_id:'MLB1'}}),maybeSingle:async()=>({data:{vendidos:sales,visitas:10}})};return q;}};
 const overrides={
  '../../services/pricing-strategy':{loadGroupStrategies:async()=>strategies},
  '../../services/ml-pricing-group':{resolveMlPricingGroup:async()=>({complete:true,groupId:'g',itemIds:['MLB1','MLB2']})},
  '../../services/integration':{fetchMLResult:async()=>({ok:true,data:{id:'MLB1'}})},
  '../../services/pricing':require('../src/services/pricing.ts'),
  '../../services/pricing-context':{loadPricingRuntime:async()=>({policy:PRICING_POLICY}),evaluateProductPricing:async(_,input)=>{calls.push(input);return {memory:{price:input.objective?104:100,result:margin*100,margin,band:PRICING_POLICY.bands[0]},costBasis:{observedAt:at}}},persistPricingEvaluation:async()=> 'evaluation',recordPricingEvent:async(_,event)=>events.push(event)},
  './automatic-pricing-selection':{resolveAutomaticPricingProductIds:()=>['p']},
  './pricing-experiment':{getProtectedPricingExperimentSkus:async()=>new Set()},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require:id=>overrides[id]});
 return {calls,events,run:()=>mod.exports.enqueueAutomaticPricesForCostChanges(client,[{productId:'p',previous:{custo:50},next:{custo:60}}])};
}
test('recuperação de existente propõe piso com cotação viva, grupo e confirmação',async()=>{
 const f=automaticFixture();const r=await f.run();assert.equal(r.proposals,1);assert.equal(r.outboxEnqueued,0);
 assert.deepEqual(f.calls.map(c=>c.objective),[undefined,'floor']);assert.ok(f.calls.every(c=>c.requireLive));
 assert.equal(f.events[0].pricing_group_id,'g');assert.equal(f.events[0].previous_price,100);assert.equal(f.events[0].payload.autonomy,'REQUIRES_CONFIRMATION');
});
test('override e liquidação do grupo impedem proposta automática',async()=>{
 for(const kind of ['manual_pricing_override','clearance','functional']){
 const f=automaticFixture({strategies:[{payload:{kind}}]});const r=await f.run();assert.equal(r.skipped,1);assert.equal(f.calls.length,0);assert.equal(f.events.length,0);
 }
});
test('margem premium com vendas gera manutenção, nunca proposta de redução',async()=>{
 const f=automaticFixture({margin:.3,sales:2});const r=await f.run();assert.equal(r.proposals,0);assert.equal(f.events[0].event_type,'MAINTAIN');assert.equal(f.events[0].previous_price,f.events[0].new_price);
});

test('12 meses e 1 ano na mesma precedência são a mesma duração',()=>{
 assert.equal(resolve([evidence('FABRICANTE',12),evidence('FABRICANTE',1,{unit:'anos'})]).status,'resolved');
});
