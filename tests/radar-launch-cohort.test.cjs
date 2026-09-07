const test=require('node:test'),assert=require('node:assert/strict');
const {payloadValidated,readbackChecks,assertCohortSize}=require('../scripts/run-radar-launch-cohort.cjs');
const payload={seller_custom_field:'VTK1',price:100,available_quantity:2,category_id:'MLB1',catalog_product_id:'MLB2',listing_type_id:'gold_special',condition:'new',family_name:'Produto X1',shipping:{mode:'me2',free_shipping:true},attributes:[{id:'BRAND',value_name:'Roadstar'},{id:'MODEL',value_name:'X1'},{id:'GTIN',value_name:'789123'}]};
const item={...payload,id:'MLB3',seller_id:1,catalog_listing:true,status:'active',attributes:payload.attributes,item_relations:[]};
test('warnings de frete conhecidos não são reprovação; erro real e warning desconhecido bloqueiam',()=>{
 const response={ok:false,status:400,data:{error:'validation_error',cause:[{type:'warning',code:'shipping.lost_me1_by_user'}]}};
 assert.equal(payloadValidated(response,payload),true);
 assert.equal(payloadValidated({...response,status:503},payload),false);
 assert.equal(payloadValidated({...response,data:{...response.data,cause:[{type:'error',code:'item.attribute.required'}]}},payload),false);
 assert.equal(payloadValidated({...response,data:{...response.data,cause:[{type:'warning',code:'unknown'}]}},payload),false);
 assert.equal(payloadValidated(response,{...payload,shipping:{mode:'me1'}}),false);
});
test('leitura posterior detecta preço, quantidade, identidade, catálogo, conta e par inesperados',()=>{
 assert.equal(readbackChecks(payload,item,1).ok,true);
 for(const change of [{price:99},{available_quantity:20},{seller_id:2},{catalog_product_id:'MLB4'},{category_id:'MLB5'},{item_relations:[{id:'MLB6'}]},{attributes:[{id:'BRAND',value_name:'Outra'}]}])assert.equal(readbackChecks(payload,{...item,...change},1).ok,false,JSON.stringify(change));
});
test('limite de dez e unicidade por SKU são obrigatórios',()=>{
 assert.doesNotThrow(()=>assertCohortSize(Array.from({length:10},(_,i)=>({sku:'VTK'+i}))));
 assert.throws(()=>assertCohortSize(Array.from({length:11},(_,i)=>({sku:'VTK'+i}))));
 assert.throws(()=>assertCohortSize([{sku:'VTK1'},{sku:'VTK1'}]));
});
test('proteção de preço inclui a coorte Radar sem substituir o experimento anterior',async()=>{
 const {getProtectedPricingExperimentSkus}=require('../src/lib/ml/pricing-experiment.ts');
 const state={version:1,experiment_id:'PRICING_EXPERIMENT_HIGH_MARGIN_ZERO_TRAFFIC_2026_09',status:'active',groups:[{sku:'OLD',status:'active'}]};
 const db={from:table=>{const b={select:()=>b,eq:()=>b,contains:()=>b,then:resolve=>resolve({data:[]}),gte:()=>Promise.resolve({data:[{payload:{sku:'NEW',observationUntil:new Date(Date.now()+86400000).toISOString()}},{payload:{sku:'EXPIRED',observationUntil:'2020-01-01'}}]}),maybeSingle:()=>Promise.resolve({data:{value:JSON.stringify(state)}})};return b;}};
 const skus=await getProtectedPricingExperimentSkus(db);assert.deepEqual([...skus].sort(),['NEW','OLD']);
});
test('encerramento por grupo libera apenas a observação autorizada e sobrevive ao estado antigo',async()=>{
 const {getProtectedPricingExperimentSkus,getHighMarginPricingExperiment}=require('../src/lib/ml/pricing-experiment.ts');
 const state={version:1,experiment_id:'PRICING_EXPERIMENT_HIGH_MARGIN_ZERO_TRAFFIC_2026_09',status:'active',groups:[{sku:'END',pricing_group_id:'g1',status:'active'},{sku:'KEEP',pricing_group_id:'g2',status:'active'}]};
 const ended=[{created_at:new Date().toISOString(),payload:{experimentId:state.experiment_id,groupId:'g1'}},{payload:{launchEventId:'launch1'}}];
 const launches=[{id:'launch1',payload:{sku:'RADAR_END',observationUntil:'2099-01-01'}},{id:'launch2',payload:{sku:'RADAR_KEEP',observationUntil:'2099-01-01'}}];
 const db={from:()=>{let type;const b={select:()=>b,eq:(k,v)=>(k==='event_type'&&(type=v),b),contains:()=>b,gte:()=>b,maybeSingle:async()=>({data:{value:JSON.stringify(state)}}),then:resolve=>resolve({data:type==='RADAR_LAUNCH_VALIDATED'?launches:ended})};return b;}};
 const loaded=await getHighMarginPricingExperiment(db);assert.equal(loaded.groups[0].status,'closed');assert.equal(state.groups[0].status,'active');
 assert.deepEqual([...await getProtectedPricingExperimentSkus(db)].sort(),['KEEP','RADAR_KEEP']);
});
test('checkpoints distinguem D7, D15 e D30 sem atribuir demanda inexistente',()=>{
 const fs=require('fs'),vm=require('vm'),ts=require('typescript');const m={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/radar-launch-monitor.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,require:()=>({})});
 assert.equal(m.exports.radarCheckpointClassification(7,0),'OBSERVACAO_SEM_TRAFEGO');
 assert.equal(m.exports.radarCheckpointClassification(15,0),'ALERTA_AMARELO_SEM_TRAFEGO');
 assert.equal(m.exports.radarCheckpointClassification(30,0),'AUDITORIA_EXPOSICAO_QUALIDADE');
 assert.equal(m.exports.radarCheckpointClassification(30,100),'TRAFEGO_OBSERVADO');
});
test('descrição de catálogo é conferida na fonte, incluindo ausência documentada; erro de leitura nunca passa',()=>{
 const {catalogDescriptionMatches}=require('../scripts/run-radar-launch-cohort.cjs');
 const catalog={short_description:{content:'Descrição ML'}};
 assert.equal(catalogDescriptionMatches(catalog,{ok:true,data:{plain_text:'Descrição ML'}}),true);
 assert.equal(catalogDescriptionMatches(catalog,{ok:true,data:{plain_text:'Outro produto'}}),false);
 assert.equal(catalogDescriptionMatches(catalog,{ok:false,status:404}),true);
 assert.equal(catalogDescriptionMatches({short_description:{content:''}},{ok:false,status:404}),true);
 assert.equal(catalogDescriptionMatches({},{ok:false,status:503}),false);
});
test('atributo multivalorado usa IDs, não espaços na representação do ML, sem aceitar valores faltantes',()=>{
 const a={id:'MICROPHONE_RECOMMENDED_USES',value_name:'Podcast, Vídeo',values:[{id:'1',name:'Podcast'},{id:'2',name:'Vídeo'}]};
 const p={...payload,attributes:[...payload.attributes,a]};
 const r={...item,attributes:[...item.attributes,{...a,value_name:'Podcast,Vídeo',values:[...a.values].reverse()}]};
 assert.equal(readbackChecks(p,r,1).ok,true);
 assert.equal(readbackChecks(p,{...r,attributes:[...item.attributes,{...a,values:a.values.slice(0,1)}]},1).ok,false);
});
