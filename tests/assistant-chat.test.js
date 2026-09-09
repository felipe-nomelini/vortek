const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const load=require('./helpers/load-integration-module');
const ID='11111111-1111-4111-8111-111111111111';
const CONV='22222222-2222-4222-8222-222222222222';
const REQ='33333333-3333-4333-8333-333333333333';
function modules(mocks={}){
  const cache=new Map();
  function read(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;
    const mod={exports:{}};cache.set(file,mod);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports',code)(name=>{
      if(Object.hasOwn(mocks,name))return mocks[name];if(name==='server-only')return {};
      if(name.startsWith('.')||name.startsWith('@/')){const p=name.startsWith('@/')?path.resolve('src',name.slice(2)):path.resolve(path.dirname(file),name);return read(p+'.ts');}
      return require(name);
    },mod,mod.exports);return mod.exports;
  }return read;
}
const read=modules();
const contracts=read('src/lib/assistant-chat.ts');
const model=read('src/services/assistant-chat-model.ts');
function result(overrides={}){return {facts:{kind:'sales',summary:{revenue:1234.56,profit:75,orders:4,margin:6.07}},state:'concluido',coverage:'completa',
  references:[{id:'dashboard',label:'Dashboard',path:'/dashboard',updatedAt:null}],warnings:[],sourceUpdatedAt:null,includesFixtures:false,
  period:{start:'2026-09-01T03:00:00Z',end:'2026-09-08T12:00:00Z',timezone:'America/Sao_Paulo'},environment:'dev',queriedAt:'2026-09-08T12:00:00Z',filters:{kind:'sales',period:'7d'},contentIsUntrusted:true,...overrides};}

test('entrada estrita, tamanho, UUID e privacidade antes de persistir',()=>{
  assert.ok(contracts.chatInputSchema.safeParse({conversationId:CONV,requestId:REQ,question:'Vendas hoje?'}).success);
  for(const extra of [{userId:ID},{model:'other'},{sql:'select 1'},{role:'admin'}])assert.equal(contracts.chatInputSchema.safeParse({conversationId:CONV,requestId:REQ,question:'ok',...extra}).success,false);
  assert.equal(contracts.chatInputSchema.safeParse({conversationId:CONV,requestId:REQ,question:'x'.repeat(4001)}).success,false);
  for(const input of ['password: synthetic-secret','Bearer fake','test@example.invalid','123.456.789-00'])assert.throws(()=>model.validateQuestionPrivacy(input));
  model.validateQuestionPrivacy('Como funciona o access token?');
});
test('navegação só aparece para admin explicitamente habilitado',()=>{
  const nav=read('src/lib/app-navigation.ts');
  assert.equal(nav.navigationForRole('admin').some(i=>i.key==='/assistente'),false);
  assert.equal(nav.navigationForRole('operador',true).some(i=>i.key==='/assistente'),false);
  assert.equal(nav.navigationForRole('admin',true)[1].key,'/assistente');
});
test('links rejeitam destinos arbitrários, javascript e path traversal',()=>{
  for(const value of ['https://evil.invalid','//evil.invalid','javascript:alert(1)','/pedidos\\evil','/etc/passwd','/produtos/../api/admin','/produtos/%2e%2e/api/admin'])assert.equal(contracts.safeAssistantLink(value),null);
  assert.equal(contracts.safeAssistantLink('/produtos/'+ID),'/produtos/'+ID);
});
test('valores formatados conservam reais, centavos e denominador percentual',()=>{
  assert.match(model.formatAssistantFact(15300,'q0.product.pricing.priceCents'),/153,00/);
  assert.equal(model.formatAssistantFact(.04,'q0.projection.rate'),'4%');
  assert.equal(model.formatAssistantFact(6.07,'q0.summary.margin'),'6,07%');
  assert.equal(model.formatAssistantFact(.07,'q0.pricing.memory.margin'),'7%');
  assert.equal(model.formatAssistantFact(null,'q0.total'),'não informado');
  assert.match(model.formatAssistantFact(0,'q0.total'),/0,00/);
});
test('resposta usa valores do servidor e preserva fontes/metadata sem inventar atualização',()=>{
  const r=result({coverage:'parcial',includesFixtures:true,warnings:['Lucro pendente']});
  const facts=model.prepareChatFacts([r]);const revenue=facts.facts.find(f=>f.path.endsWith('.revenue'));
  const answer=model.validateChatAnswer({text:`Receita: {{${revenue.id}}}.`,sourceIds:['s0:dashboard']},[r]);
  assert.match(answer.text,/1\.234,56/);assert.equal(answer.evidence[0].sourceUpdatedAt,null);
  assert.equal(answer.evidence[0].includesFixtures,true);assert.equal(answer.evidence[0].coverage,'parcial');
});
for(const [name,text,ids] of [
  ['número inventado','Receita de 999999',['s0:dashboard']],['fato desconhecido','{{f9999}}',['s0:dashboard']],
  ['fonte inventada','Receita',['fake']],['sem fonte','Receita',[]],['HTML','<script>bad</script>',['s0:dashboard']],
  ['URL externa','Veja https://evil.invalid',['s0:dashboard']],['placeholder inválido','{{system}}',['s0:dashboard']],
])test('rejeita '+name,()=>assert.throws(()=>model.validateChatAnswer({text,sourceIds:ids},[result()])));
test('fonte vazia mantém período e não vira zero',()=>{
  const answer=model.evidenceAnswer('Sem dados',[result({facts:null,state:'sem_dados',coverage:'sem_dados'})]);
  assert.equal(answer.sources.length,1);assert.equal(answer.evidence[0].period.timezone,'America/Sao_Paulo');assert.equal(answer.text,'Sem dados');
});
test('fato de outra consulta exige fonte correspondente; dado privado não vai ao modelo',()=>{
  const results=[result(),result()];const fact=model.prepareChatFacts(results).facts.find(f=>f.path==='q1.summary.profit');
  assert.throws(()=>model.validateChatAnswer({text:`Lucro {{${fact.id}}}`,sourceIds:['s0:dashboard']},results));
  assert.throws(()=>model.prepareChatFacts([result({facts:{kind:'product',name:'password: synthetic-secret'}})]));
});
test('documentação citada fica como trecho versionado, sem endpoint de arquivos arbitrários',()=>{
  const document={id:'assistant:section',path:'docs/test.md',heading:'Seção',excerpt:'Texto histórico',version:'abc',authority:'historica'};
  const r=result({facts:{kind:'documentation',documents:[document]},references:[{id:document.id,label:'Seção',path:document.path,updatedAt:null}]});
  const prepared=model.prepareChatFacts([r]);assert.equal(prepared.sources[0].path,'');assert.equal(prepared.sources[0].excerpt,'Texto histórico');assert.equal(prepared.sources[0].authority,'historica');
});
test('planner bloqueia tipo inválido, excesso e autoridade do modelo',()=>{
  for(const queries of [[{kind:'sql',query:'select 1'}],Array(4).fill({kind:'tax'}),[{kind:'tax',userId:ID}],[{kind:'order',record:{by:'sku',value:'ABC'}}]])
    assert.equal(model.plannerSchema.safeParse({queries,clarification:''}).success,false);
});

function harness(options={}){
  const calls=[];const messages=new Map();let claims=0,reads=0,modelCalls=0;
  class ChatError extends Error{constructor(state,status=400){super(state);this.state=state;this.status=status;}}
  const history={ChatError,
    authorizeAssistant:async()=>{calls.push('auth');if(options.denied||options.revoked&&reads)throw new ChatError('acesso_negado',403);return ID;},
    beginMessage:async(user,conversation,request,question)=>{
      assert.equal(user,ID);if(options.wrongOwner)throw new ChatError('acesso_negado',404);
      if(messages.has(request))return {created:false,message:messages.get(request)};
      if([...messages.values()].some(m=>['running','cancel_requested'].includes(m.state)))throw new ChatError('ocupado',409);
      claims++;const message={id:request,conversation_id:conversation,request_id:request,role:'assistant',content:'',state:'running',answer:null,created_at:new Date().toISOString(),deadline_at:new Date(Date.now()+120000).toISOString()};messages.set(request,message);return {created:true,message};
    },
    assertMessageRunning:async(user,id)=>{if(messages.get(id)?.state!=='running')throw new ChatError('cancelado');},
    finishMessage:async(user,id,state,answer)=>{const current=messages.get(id);if(!current||!['running','cancel_requested'].includes(current.state))return null;
      if(current.state==='cancel_requested'){state='cancelado';answer=null;}const next={...current,state,content:answer?.text||'',answer};messages.set(id,next);calls.push('finish:'+state);return next;},
    conversationContext:async()=>Array.from({length:2},()=>({question:'Anterior',answer:'Resposta anterior'})),
    cancelMessage:async(user,conversation,request)=>{const item=messages.get(request);messages.set(request,{...item,state:'cancel_requested'});},
    emptyChatAnswer:text=>({text,sources:[],evidence:[],model:'gpt-6-astra'}),
  };
  const query=async()=>{reads++;if(options.queryFails)return result({state:'fonte_indisponivel',facts:null});return result(options.empty?{facts:null,state:'sem_dados',coverage:'sem_dados'}:{});};
  let release;const wait=new Promise(resolve=>release=resolve);
  const handler=load('src/services/assistant-chat-handler.ts',{'server-only':{},zod:require('zod'),'@/lib/assistant-chat':{...contracts,CHAT_TIMEOUT_MS:options.shortTimeout?20:contracts.CHAT_TIMEOUT_MS},'./assistant-history':history,
    './assistant-knowledge':{queryAssistantKnowledge:query},'./assistant-chat-model':{...model,
      assistantRuntimeState:()=>options.unavailable||null,
      planAssistantQueries:async(question,context,signal)=>{modelCalls++;calls.push('plan');if(options.hang)await wait;return options.clarify?{queries:[],clarification:'Qual é o SKU?'}:{queries:[{kind:'sales',period:'7d'}],clarification:''};},
      composeAssistantAnswer:async()=>{modelCalls++;calls.push('compose');if(options.modelError)throw new Error(options.modelError);return model.evidenceAnswer('Resposta fundamentada',[result()]);},
    }});
  const request=(requestId=REQ,signal)=>new Request('https://dev.bentevi.shop/api/assistente/mensagens',{method:'POST',signal,headers:{'Content-Type':'application/json','Origin':'https://dev.bentevi.shop'},body:JSON.stringify({conversationId:CONV,requestId,question:'Vendas hoje?'})});
  return {handler,request,calls,messages,release,stats:()=>({claims,reads,modelCalls})};
}
test('chat: pipeline real de handler, fases, fontes e persistência final',async()=>{
  const h=harness();const response=await h.handler.sendHandler(h.request());assert.equal(response.status,200);const events=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(e=>e.type==='phase').map(e=>e.phase),['Interpretando a pergunta','Consultando as fontes do ERP','Preparando a resposta com as fontes']);
  assert.equal(events.at(-1).message.state,'concluido');assert.equal(h.stats().modelCalls,2);
});
test('acesso indevido, proprietário diferente e runtime ausente não chamam modelo',async()=>{
  for(const options of [{denied:true},{wrongOwner:true},{unavailable:'autenticacao_necessaria'}]){const h=harness(options);const response=await h.handler.sendHandler(h.request());assert.notEqual(response.status,200);assert.equal(h.stats().modelCalls,0);}
});
test('reenvio idempotente não consome assinatura novamente',async()=>{
  const h=harness();await(await h.handler.sendHandler(h.request())).text();const second=await h.handler.sendHandler(h.request());assert.equal((await second.json()).message.state,'concluido');assert.deepEqual(h.stats(),{claims:1,reads:1,modelCalls:2});
});
test('duas abas: segunda execução recusada; cancelamento descarta saída tardia',async()=>{
  const h=harness({hang:true});const first=await h.handler.sendHandler(h.request());await new Promise(setImmediate);
  const second=await h.handler.sendHandler(h.request('44444444-4444-4444-8444-444444444444'));assert.equal(second.status,409);
  const cancel=await h.handler.cancelHandler(new Request('https://dev.bentevi.shop/api/assistente/cancelar',{method:'POST',body:JSON.stringify({conversationId:CONV,requestId:REQ})}));assert.equal(cancel.status,200);
  h.release();await first.text();assert.equal(h.messages.get(REQ).state,'cancelado');assert.equal(h.messages.get(REQ).answer,null);assert.equal(h.stats().reads,0);
});
test('revogação durante consulta descarta resposta antes da composição',async()=>{
  const h=harness({revoked:true});await(await h.handler.sendHandler(h.request())).text();assert.equal(h.messages.get(REQ).state,'acesso_negado');assert.equal(h.stats().modelCalls,1);
});
test('deadline encerra mesmo se provedor não cooperar; saída tardia descartada',async()=>{
  const h=harness({hang:true,shortTimeout:true});const response=await h.handler.sendHandler(h.request());
  const keepAlive=setTimeout(()=>{},1000);
  try{await response.text();assert.equal(h.messages.get(REQ).state,'tempo_esgotado');h.release();await new Promise(setImmediate);
    assert.equal(h.messages.get(REQ).answer,null);assert.equal(h.stats().reads,0);
  }finally{clearTimeout(keepAlive);}
});

test('guard real exige DEV, piloto exato e cargo atual; contexto é limitado',async t=>{
  const old={enabled:process.env.BENTEVI_ASSISTANT_ENABLED,pilot:process.env.BENTEVI_ASSISTANT_PILOT_USER_ID};
  t.after(()=>{for(const [key,value] of [['BENTEVI_ASSISTANT_ENABLED',old.enabled],['BENTEVI_ASSISTANT_PILOT_USER_ID',old.pilot]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  process.env.BENTEVI_ASSISTANT_ENABLED='1';process.env.BENTEVI_ASSISTANT_PILOT_USER_ID=ID;
  let destination='http://192.168.1.162:8000',actor=ID,role='admin',rows=[];
  const client={from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,
    maybeSingle:async()=>({data:table==='profiles'?{cargo:role}:{id:CONV},error:null}),limit:async()=>({data:rows,error:null})};return q;}};
  const history=load('src/services/assistant-history.ts',{'server-only':{},zod:require('zod'),'@/lib/supabase':{createServiceClient:()=>client},
    '@/lib/api-request-auth':{authorizeApiRequest:async()=>({ok:true,userId:actor})},'@/lib/supabase-url':{resolveSupabaseServiceUrl:()=>destination},
    './assistant-read-transport':read('src/services/assistant-read-transport.ts'),'@/lib/assistant-chat':contracts});
  const request=new Request('https://dev.bentevi.shop');assert.equal(await history.authorizeAssistant(request),ID);
  actor=CONV;await assert.rejects(history.authorizeAssistant(request),/acesso_negado/);actor=ID;
  role='visualizador';await assert.rejects(history.authorizeAssistant(request),/acesso_negado/);role='admin';
  destination='http://192.168.1.160:8000';await assert.rejects(history.authorizeAssistant(request),/ambiente_bloqueado/);destination='http://192.168.1.162:8000';
  rows=Array.from({length:12},(_,i)=>[{role:'user',request_id:String(i),content:'Q'+i},{role:'assistant',request_id:String(i),state:'concluido',content:'A'+i}]).flat().reverse();
  const context=await history.conversationContext(ID,CONV,'11');assert.equal(context.length,8);assert.equal(context[0].question,'Q3');assert.equal(context.at(-1).answer,'A10');
  rows=rows.map(row=>({...row,content:'x'.repeat(5000)}));assert.ok(JSON.stringify(await history.conversationContext(ID,CONV,'11')).length<=24000);
});
test('sem dados e esclarecimento não disparam segunda inferência',async()=>{
  for(const options of [{empty:true},{clarify:true}]){const h=harness(options);await(await h.handler.sendHandler(h.request())).text();assert.equal(h.stats().modelCalls,1);assert.equal(h.messages.get(REQ).state,options.empty?'sem_dados':'esclarecimento_necessario');}
});
for(const code of ['codex_rate_limit','codex_model_unavailable','codex_auth_required','codex_output_invalid'])test('falha sanitizada: '+code,async()=>{
  const h=harness({modelError:code});const text=await(await h.handler.sendHandler(h.request())).text();assert.equal(h.messages.get(REQ).state,model.modelErrorState(new Error(code)));assert.equal(text.includes('codex_'),false);assert.equal(h.messages.get(REQ).answer,null);
});
test('origem externa e campos extras são recusados antes do claim',async()=>{
  const h=harness();const request=new Request('https://dev.bentevi.shop/api/assistente/mensagens',{method:'POST',headers:{origin:'https://evil.invalid'},body:'{}'});
  assert.equal((await h.handler.sendHandler(request)).status,403);assert.equal(h.stats().claims,0);
});
test('origem DEV funciona atrás do proxy; loopback exige Host correspondente',async()=>{
  for(const [url,origin,host,expected] of [
    ['http://0.0.0.0:80','https://dev.bentevi.shop','dev.bentevi.shop',200],
    ['http://localhost:3102','http://127.0.0.1:3102','127.0.0.1:3102',200],
    ['http://localhost:3102','http://127.0.0.1:9999','127.0.0.1:3102',403],
    ['http://0.0.0.0:80','https://app.bentevi.shop','app.bentevi.shop',403],
  ]){
    const h=harness();const req=new Request(url+'/api/assistente/mensagens',{method:'POST',headers:{origin,host},body:JSON.stringify({conversationId:CONV,requestId:REQ,question:'Vendas hoje?'})});
    const response=await h.handler.sendHandler(req);assert.equal(response.status,expected);await response.text();
  }
});
test('trechos documentais vigentes cabem no payload e passam minimização',async()=>{
  const documents=read('src/services/assistant-documents.ts');
  for(const topic of ['pricing','orders','inventory','settings','assistant','pricing_history']){
    const docs=await documents.loadAssistantDocuments(topic);
    const r=result({facts:{kind:'documentation',documents:docs},references:docs.map(doc=>({id:doc.id,label:doc.heading,path:doc.path,updatedAt:null}))});
    assert.ok(JSON.stringify(model.prepareChatFacts([r])).length<180000);
  }
});
