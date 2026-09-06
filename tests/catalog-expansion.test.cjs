const test=require('node:test'),assert=require('node:assert/strict');
const {validateCatalogExpansionContext,catalogExpansionKey,assertCatalogExpansionCanAdvance,catalogExpansionReadbackIssues,CATALOG_EXPANSION_BATCH}=require('../src/lib/ml/catalog-expansion.ts');
const context={batchId:CATALOG_EXPANSION_BATCH,preparationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
test('autorização restrita aos dez SKUs e preparação persistente',()=>{
 assert.deepEqual(validateCatalogExpansionContext(context,'VTK018523'),context);
 for(const [c,sku] of [[context,'VTK000001'],[{...context,batchId:'NEXT'},'VTK018523'],[{...context,preparationId:''},'VTK018523']])assert.throws(()=>validateCatalogExpansionContext(c,sku),/NAO_AUTORIZADO/);
});
test('nova aprovação não altera chave de publicação por produto',()=>{assert.equal(catalogExpansionKey('p'),catalogExpansionKey('p'));assert.notEqual(catalogExpansionKey('p'),catalogExpansionKey('q'));});
test('timeout após claim bloqueia próximo SKU e reinício; somente readback validado encerra',()=>{
 const events=[{event_type:'CREATE_REQUESTED',produto_id:'p'}];assert.throws(()=>assertCatalogExpansionCanAdvance(events),/RECONCILIACAO/);
 events.push({event_type:'CREATED_REMOTE',produto_id:'p'});assert.throws(()=>assertCatalogExpansionCanAdvance(events),/RECONCILIACAO/);
 events.push({event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:'p'});assert.doesNotThrow(()=>assertCatalogExpansionCanAdvance(events));
 events.push({event_type:'CATALOG_EXPANSION_SAFETY_STOP'});assert.throws(()=>assertCatalogExpansionCanAdvance(events),/SAFETY_STOP/);
});
const expected={price:200,quantity:7,categoryId:'cat',catalogProductId:'product'};
const item={id:'MLB1',price:200,available_quantity:7,category_id:'cat',catalog_product_id:'product',condition:'new',shipping:{mode:'me2'},status:'active',sub_status:[]};
const memory={result:10,margin:.05,band:{floor:.05},fee:{source:'ml_live'},shipping:{source:'ml_live'}};
test('piso inclusivo e leitura remota exata autorizam conclusão',()=>assert.deepEqual(catalogExpansionReadbackIssues(expected,item,memory),[]));
test('preço estoque categoria catálogo logística condição e margem errados bloqueiam',()=>{
 for(const patch of [{price:201},{available_quantity:70},{category_id:'other'},{catalog_product_id:null},{shipping:{mode:'custom'}},{condition:'used'}])assert.ok(catalogExpansionReadbackIssues(expected,{...item,...patch},memory).length);
 assert.ok(catalogExpansionReadbackIssues(expected,item,{...memory,margin:.0499}).includes('ECONOMIA_ABAIXO_DO_PISO'));
});
test('fonte stale ou GET ausente não prova prejuízo; status pendente não é publicado validado',()=>{
 assert.deepEqual(catalogExpansionReadbackIssues(expected,null,memory),['READBACK_INDISPONIVEL']);
 assert.deepEqual(catalogExpansionReadbackIssues(expected,item,{...memory,shipping:{source:'local'}}),['ECONOMIA_INCONCLUSIVA']);
 assert.deepEqual(catalogExpansionReadbackIssues(expected,{...item,status:'paused',sub_status:['picture_download_pending']},memory),['STATUS_NAO_VALIDADO']);
});
function listingService(fetchML) {
 const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),mod={exports:{}};
 const code=ts.transpileModule(fs.readFileSync('src/services/mercadolibre.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:id=>id==='./integration'?{fetchML}:id==='@/lib/ml-sale-terms'?require('../src/lib/ml-sale-terms.ts'):{},console,setTimeout,clearTimeout,URLSearchParams});return mod.exports;
}
test('payload de catálogo preserva termos e não escreve descrição administrada pelo ML',()=>{
 const service=listingService();const payload=service.buildMlCreatePayload({catalogProductId:'MLB999',familyName:'Par Bravox CX50BK',categoryId:'cat',price:200,availableQuantity:7,condition:'new',listingTypeId:'gold_special',description:'Descrição revisada',pictures:['https://example.org/product.jpg'],attributes:[{id:'GTIN',value_name:'789'}],sellerCustomField:'VTK018523',saleTerms:[{id:'WARRANTY_TYPE',value_id:'2230280'},{id:'WARRANTY_TIME',value_name:'90 dias'}]});
 assert.equal(payload.catalog_listing,true);assert.equal(payload.catalog_product_id,'MLB999');assert.equal('description' in payload,false);assert.equal(payload.available_quantity,7);assert.equal(payload.sale_terms[1].value_name,'90 dias');
});
test('falha de busca remota não significa anúncio inexistente; SKU legado também é consultado',async()=>{
 await assert.rejects(listingService(async()=>null).searchItemBySellerSku('x'),/INCONCLUSIVA/);
 const calls=[];const service=listingService(async p=>{calls.push(p);if(p==='/users/me')return{id:1};if(p.includes('seller_sku='))return{results:[],paging:{total:0}};if(p.includes('?sku='))return{results:['MLB1'],paging:{total:1}};return{id:'MLB1',status:'paused'};});
 assert.equal(await service.searchItemBySellerSku('x'),'MLB1');assert.ok(calls.some(p=>p.includes('?sku=')));
});
test('400 com avisos de ME1 e frete grátis já atendidos não bloqueia; qualquer erro real bloqueia',()=>{
 const {catalogExpansionPayloadValidated:valid}=require('../src/lib/ml/catalog-expansion.ts');
 const payload={shipping:{mode:'me2',free_shipping:true}},warning={type:'warning',code:'item.shipping.mandatory_free_shipping'};
 const response=causes=>({ok:false,status:400,error:{causes}});
 assert.equal(valid(response([warning,{type:'warning',code:'shipping.lost_me1_by_user'}]),payload),true);
 for(const causes of [[],[{...warning,type:'error'}],[{type:'warning',code:'UNKNOWN'}],[warning,{type:'error',code:'item.attribute.required'}]])assert.equal(valid(response(causes),payload),false);
 assert.equal(valid(response([warning]),{shipping:{mode:'custom',free_shipping:true}}),false);
 assert.equal(valid(response([warning]),{shipping:{mode:'me2',free_shipping:false}}),false);
});
