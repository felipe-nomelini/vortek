const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const load=require('./helpers/load-integration-module');
const auth=load('src/lib/ml/agent-price-auth.ts',{'node:crypto':crypto});
const actorId='00000000-0000-4000-8000-000000000001';
const productId='00000000-0000-4000-8000-000000000002';
const operationId='00000000-0000-4000-8000-000000000003';
const url='https://app.bentevi.shop/api/ml/agente/preco';
const secret='f'.repeat(64);
function setup(){
  const calls=[];
  const client={auth:{admin:{getUserById:async()=>({data:{user:{app_metadata:{bentevi_agent_scope:'ml_price_change'},banned_until:'2126-01-01T00:00:00Z'}},error:null})}},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:actorId,cargo:'admin'},error:null})})})})};
  const route=load('src/app/api/ml/agente/preco/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},zod:require('zod'),
    '@/lib/supabase':{createServiceClient:()=>client},
    '@/lib/ml/agent-price-auth':auth,
    '@/services/pricing-detail':{loadPricingDetail:async(input,worker)=>{
      calls.push(['detail',input,worker]);
      return Response.json({evaluationId:operationId,decisionContext:{executable:true,
        requireNonDecreasingProfit:true,previousPriceCents:8266},pricing:{current:{memory:{resultCents:888}},
          comparisons:{actual:{memory:{resultCents:827}}}}});
    }},
    '@/services/pricing-dispatch':{findManualMlCommand:async()=>null,
      enqueueManualMlCommand:async(...args)=>{calls.push(['enqueue',...args]);return {operationId,state:'queued'};}},
    '@/services/pricing-execution-access':{requirePricingExecutionAccount:async()=>({sellerId:'1'})},
  });
  const send=(data,sign=true)=>{
    const body=JSON.stringify(data),timestamp=String(Date.now());
    return route.POST(new Request(url,{method:'POST',body,headers:{
      'x-bentevi-agent-timestamp':timestamp,
      'x-bentevi-agent-signature':sign?auth.signAgentPriceRequest(secret,'POST',url,timestamp,body):'0'.repeat(64),
    }}));
  };
  return {calls,send};
}
test('agente assinado confere lucro e aplica somente após segunda chamada explícita',async()=>{
  const before={ML_AGENT_PRICE_SECRET:process.env.ML_AGENT_PRICE_SECRET,ML_AGENT_PRICE_ACTOR_ID:process.env.ML_AGENT_PRICE_ACTOR_ID};
  process.env.ML_AGENT_PRICE_SECRET=secret;process.env.ML_AGENT_PRICE_ACTOR_ID=actorId;
  try{
    const x=setup();const command={operationId,produtoId:productId,mlItemId:'MLB123',priceCents:7599};
    assert.equal((await x.send(command,false)).status,401);assert.equal(x.calls.length,0);
    const checked=await x.send({...command,checkOnly:true});assert.equal(checked.status,200);
    assert.equal((await checked.json()).proposedProfitCents,888);
    assert.equal(x.calls.filter(y=>y[0]==='enqueue').length,0);
    const applied=await x.send(command);assert.equal(applied.status,202);
    assert.equal(x.calls.filter(y=>y[0]==='enqueue').length,1);
    assert.equal(x.calls.find(y=>y[0]==='detail')[2].requireNonDecreasingProfit,true);
  }finally{
    for(const [key,value] of Object.entries(before)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
