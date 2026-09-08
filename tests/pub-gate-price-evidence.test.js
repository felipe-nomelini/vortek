const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), ts=require('typescript');
const load=require('./helpers/load-integration-module');
const audit=load('src/services/pricing-audit.ts',{zod:require('zod')});
const decisions=load('src/services/pricing-decisions.ts',{zod:require('zod'),'node:crypto':require('node:crypto'),
  './pricing-audit':audit,'@/lib/ml/pricing-execution':require('../src/lib/ml/pricing-execution.js')});
async function quote(options={}) {
  const product={id:'p',ativo:!options.inactive,ml_item_id:'MLB1'};
  const remote=id=>({id,seller_id:123,currency_id:'BRL',price:100,status:options.closed?'closed':'active',
    category_id:'MLB10',listing_type_id:'gold_pro',condition:'new',shipping:{mode:'not_specified',logistic_type:'not_specified',free_shipping:false}});
  const group={id:'g',version:1,state:'verified',members:['MLB1','MLB2'].map(itemId=>({itemId,variationId:'',catalog:false})),protection:null,inFlight:false};
  const calls=[];
  const client={from(table){const q={select(){return q},eq(){return q},
    single:async()=>({data:product}),maybeSingle:async()=>({data:table==='produtos'?product:
      {ml_item_id:'MLB1',ml_sync_blocked_until:options.blocked?'2099-01-01T00:00:00Z':null}}),
    then(resolve){resolve({data:[],error:null})}};return q;}};
  const source='src/services/pricing-detail.ts';
  const mocks=Object.fromEntries(ts.preProcessFile(fs.readFileSync(source,'utf8')).importedFiles.map(i=>[i.fileName,{}]));
  Object.assign(mocks,{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},zod:require('zod'),
    '@/lib/supabase':{createServiceClient:()=>client},
    '@/lib/products/bnt-d07-visual-review':{loadBntD07VisualReview:async()=>null},
    '@/services/integration':{fetchMLResult:async(path)=>{
      calls.push(path);if(path==='/users/me')return {ok:true,data:{id:123,site_id:'MLB'}};
      if(path.startsWith('/public/buybox/sync/'))return {ok:true,data:{status:'SYNC',item_id:'MLB1',relations:['MLB2']}};
      return {ok:true,data:remote(path.split('/').pop())};}},
    '@/services/pricing-overrides':{loadPricingOverrides:async()=>({status:'available',groups:[group]})},
    '@/lib/ml/item-price-policy':{hasMlAutomaticPrice:()=>false},
    '@/services/pricing-market-quote':{quoteMoney:v=>Math.round(v*100)},
    '@/services/pricing-live':{loadLiveProductPricing:async(_,p,c,price,revalidate)=>{
      const valid=await revalidate();return {current:{status:'available',memory:{revenueCents:price,resultCents:1100,margin:.1,band:{floor:.07},
        cost:{},fee:{},shipping:{amountCents:0},tax:{context:{appliedRate:.04}}}},target:{ok:true},floor:{ok:true},breakEven:{ok:true},
        revalidation:{status:valid?'queried':'inconclusive'}};}},
    '@/lib/pricing-view':{pricingView:()=>({cost:40,profit:11})},
    '@/lib/ml/quantity-pricing':{extractQuantityPricingTiers:()=>[],serializeQuantityPricingTiers:()=>[]},
    '@/services/pricing-audit':{...audit,recordPricingEvaluation:async()=> 'e'},
    '@/services/pricing-decisions':{...decisions,syncPricingAlerts:async()=>{}},
    '@/lib/ml-critical-attributes':{loadMlIdentityKit:async()=>({}),assessMlProductIdentity:item=>({
      complete:!(options.peerConflict&&item.id==='MLB2')&&!options.originConflict,
      comparisons:[{field:'BRAND',local:'A',remote:options.brand||'A',status:'SEM_CONFLITO',reason:'same'}]})},
    '@/lib/ml-listing-identity':{isMlIdentityComplete:a=>a.complete},
    '@/lib/ml/operational-listing':require('../src/lib/ml/publish-eligibility.js'),
    '@/lib/dslite/supplier-policy':{loadOperationalDropshippingSupplierIds:async()=>new Set()},
    './mercadolibre':{getCategoryAttributes:async()=>options.categoryUnavailable?null:[]},
  });
  const result=await load(source,mocks).loadPricingDetail({produtoId:'p',mlItemId:'MLB1',priceCents:11000},{actorId:'actor'});
  assert.equal(result.status,200);return {body:await result.json(),calls};
}
test('approved-price quote verifies live identity and eligibility of origin and synchronized peer',async()=>{
  const q=await quote();assert.equal(q.body.decisionContext.executable,true);
  assert.ok(q.calls.includes('/items/MLB2'));
  for(const option of ['inactive','closed','blocked','originConflict','peerConflict','categoryUnavailable']) {
    const denied=await quote({[option]:true});assert.equal(denied.body.decisionContext.executable,false,option);
  }
});
test('material identity change invalidates the previous price fingerprint',async()=>{
  assert.notEqual((await quote()).body.decisionContext.fingerprint,(await quote({brand:'B'})).body.decisionContext.fingerprint);
});
