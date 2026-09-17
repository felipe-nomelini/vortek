const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const load=require('./helpers/load-integration-module');
const auth=load('src/lib/ml/agent-price-auth.ts',{'node:crypto':crypto});
const secret='a'.repeat(64);
test('assinatura vincula método, caminho, query, corpo e tempo',()=>{
  const url='https://app.bentevi.shop/api/ml/agente/preco?operationId=123';
  const now=Date.now(),timestamp=String(now);
  const signature=auth.signAgentPriceRequest(secret,'POST',url,timestamp,'{"priceCents":7599}');
  const request=(method,url,signature)=>new Request(url,{method,headers:{
    'x-bentevi-agent-timestamp':timestamp,'x-bentevi-agent-signature':signature,
  }});
  assert.equal(auth.verifyAgentPriceRequest(request('POST',url,signature),secret,'{"priceCents":7599}',now),true);
  assert.equal(auth.verifyAgentPriceRequest(request('GET',url,signature),secret,'{"priceCents":7599}',now),false);
  assert.equal(auth.verifyAgentPriceRequest(request('POST',url+'&extra=1',signature),secret,'{"priceCents":7599}',now),false);
  assert.equal(auth.verifyAgentPriceRequest(request('POST',url,signature),secret,'{"priceCents":7600}',now),false);
  assert.equal(auth.verifyAgentPriceRequest(request('POST',url,signature),secret,'{"priceCents":7599}',now+300001),false);
});
