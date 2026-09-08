const test=require('node:test'),assert=require('node:assert/strict');
const {validateCatalogExpansionContext,catalogExpansionKey,assertCatalogExpansionCanAdvance,catalogExpansionReadbackIssues,CATALOG_EXPANSION_BATCH}=require('../src/lib/ml/catalog-expansion.ts');
const context={batchId:CATALOG_EXPANSION_BATCH,preparationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
test('lote Evolusom 06 autoriza somente os 531 produtos selecionados',()=>{
 const {EVOLUSOM_PREMIUM_BATCH_06,EVOLUSOM_PREMIUM_SKUS_06}=require('../src/lib/ml/catalog-expansion.ts');
 assert.equal(EVOLUSOM_PREMIUM_SKUS_06.length,531);assert.equal(new Set(EVOLUSOM_PREMIUM_SKUS_06).size,531);
 const batch={...context,batchId:EVOLUSOM_PREMIUM_BATCH_06};
 assert.doesNotThrow(()=>validateCatalogExpansionContext(batch,EVOLUSOM_PREMIUM_SKUS_06[0]));
 assert.throws(()=>validateCatalogExpansionContext(batch,'SKU_FORA_DO_LOTE'));
});
test('vínculo recém-criado conserva tipo Premium e modalidade de catálogo retornados pelo ML',async()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const source=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8'),ts.ScriptTarget.Latest,true);
 const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='persistListingLink');assert.ok(fn);
 for(const catalog of [true,false]){
  let saved;const scope={persistSingleAnuncioBySku:async(_client,payload)=>{saved=payload;return{ok:true};}};
  vm.runInNewContext(ts.transpileModule(fn.getText(source),{compilerOptions:{target:9}}).outputText,scope);
  await scope.persistListingLink({supabase:{from:()=>({update:()=>({eq:async()=>({error:null})})})},produto:{id:'p',sku:'SKU'},produtoId:'p',item:{id:'MLB1',title:'Produto',price:100,listing_type_id:'gold_pro',catalog_listing:catalog},mlFee:18,mlShipping:10,mlStatus:'ativo'});
  assert.equal(saved.tipo,'gold_pro');assert.equal(saved.catalogo,catalog);
 }
});
test('descrição preserva unidades e parênteses com caracteres aceitos pelo ML',()=>{
 const {supplierTextToDescription}=require('../src/lib/ml-listing-description.ts');
 assert.equal(supplierTextToDescription('Impedância: 100 Ω\nIsolamento: 10 MΩ\nResistência: 5 kΩ\nVisão: 170°/160°（CR>10）'),'Impedância: 100 ohms\nIsolamento: 10 megaohms\nResistência: 5 quiloohms\nVisão: 170°/160°(CR>10)');
});
test('entidades técnicas do fornecedor viram texto simples',()=>{
 const {supplierTextToDescription}=require('../src/lib/ml-listing-description.ts');
 assert.equal(supplierTextToDescription('&#8805; 750; 100&plusmn;15%&#937;; 45 &#956;s; 100 &#8486;; 7&#8243;， ＜2.2KΩ' ),'>= 750; 100+/-15%ohms; 45 µs; 100 ohms; 7"\u002c <2.2Kohms');
});
test('bloqueio posterior ao milésimo evento não desaparece na paginação do lote',async()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const source=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8'),ts.ScriptTarget.Latest,true);
 const loader=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='loadCatalogExpansionSafetyEvents');assert.ok(loader);
 assert.equal((source.text.match(/await loadCatalogExpansionSafetyEvents\(supabase, batch.batchId\)/g)||[]).length,2);
 const events=Array.from({length:500},(_,i)=>[{event_type:'CREATE_REQUESTED',produto_id:String(i)},{event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:String(i)}]).flat();
 events.push({id:'last-stop',event_type:'CATALOG_EXPANSION_SAFETY_STOP',produto_id:'499',ml_item_id:'MLB_LAST',created_at:new Date().toISOString()});
 const ranges=[],query={select(){return this;},contains(){return this;},in(){return this;},order(){return this;},async range(a,b){ranges.push([a,b]);return{data:events.slice(a,b+1),error:null};}};
 const code=ts.transpileModule(loader.getText(source)+'\n(async()=>{const batchEvents=await loadCatalogExpansionSafetyEvents(supabase,batch.batchId);assertCatalogExpansionCanAdvance(batchEvents,batch.batchId);})()',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 await assert.rejects(vm.runInNewContext(code,{supabase:{from:()=>query},batch:{batchId:'EVOLUSOM_PREMIUM_BATCH_05'},assertCatalogExpansionCanAdvance}),/SAFETY_STOP/);
 assert.deepEqual(ranges,[[0,999],[1000,1999]]);
});
test('título revisado preserva separadores do modelo e não transforma CX-2921 em 2921 unidades',()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const source=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8'),ts.ScriptTarget.Latest,true);
 const declarations=[];let expression;
 function visit(node){
  if(ts.isFunctionDeclaration(node)&&['normalizeText','truncateListingName'].includes(node.name?.text))declarations.push(node.getText(source));
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='effectiveFamilyName')expression=node.initializer.getText(source);
  ts.forEachChild(node,visit);
 }
 visit(source);assert.ok(expression);
 const js=ts.transpileModule(declarations.join('\n')+'\nresult = '+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const {presentationFacts}=require('../src/lib/ml/opportunity-identity.ts');
 for(const name of ['Câmera Citrox CX-2921 1/4 720p','Central GCP CX-7807 127/220V']){
  const scope={batch:{},pricingMode:'canonical',requestedFamilyName:name,listingNames:{familyName:''},result:null};vm.runInNewContext(js,scope);
  assert.equal(scope.result,name);assert.equal(presentationFacts(scope.result).quantity,null);assert.notEqual(presentationFacts(scope.result).packaging,'kit');
 }
});
test('quinto lote Evolusom limita autorização a 500 produtos e mantém bloqueio de criação inconclusiva',()=>{
 const {EVOLUSOM_PREMIUM_BATCH_05:batch,EVOLUSOM_PREMIUM_SKUS_05:skus}=require('../src/lib/ml/catalog-expansion.ts');
 assert.equal(skus.length,500);assert.equal(new Set(skus).size,500);
 for(const sku of skus)assert.doesNotThrow(()=>validateCatalogExpansionContext({...context,batchId:batch},sku));
 assert.throws(()=>validateCatalogExpansionContext({...context,batchId:batch},'FORA_DO_LOTE'),/NAO_AUTORIZADO/);
 assert.equal(catalogExpansionKey('p',batch),'catalog_expansion:EVOLUSOM_PREMIUM_BATCH_05:p');
 assert.throws(()=>assertCatalogExpansionCanAdvance([{event_type:'CREATE_REQUESTED',produto_id:'p'}],batch),/RECONCILIACAO/);
});
test('segundo lote Evolusom autoriza exatamente cinquenta novos SKUs e isola suas chaves',()=>{
 const {EVOLUSOM_PREMIUM_BATCH_02,EVOLUSOM_PREMIUM_SKUS_02,EVOLUSOM_PREMIUM_SKUS}=require('../src/lib/ml/catalog-expansion.ts');
 assert.equal(EVOLUSOM_PREMIUM_SKUS_02.length,50);
 assert.equal(new Set(EVOLUSOM_PREMIUM_SKUS_02).size,50);
 assert.equal(EVOLUSOM_PREMIUM_SKUS_02.some(s=>EVOLUSOM_PREMIUM_SKUS.includes(s)),false);
 for(const sku of EVOLUSOM_PREMIUM_SKUS_02)assert.doesNotThrow(()=>validateCatalogExpansionContext({...context,batchId:EVOLUSOM_PREMIUM_BATCH_02},sku));
 assert.throws(()=>validateCatalogExpansionContext({...context,batchId:EVOLUSOM_PREMIUM_BATCH_02},'VTK000001'),/NAO_AUTORIZADO/);
 assert.equal(catalogExpansionKey('p',EVOLUSOM_PREMIUM_BATCH_02),'catalog_expansion:EVOLUSOM_PREMIUM_BATCH_02:p');
});
test('Evolusom Premium limita preparação a vinte SKUs e separa as chaves do lote anterior',()=>{
 const {EVOLUSOM_PREMIUM_BATCH,EVOLUSOM_PREMIUM_SKUS}=require('../src/lib/ml/catalog-expansion.ts');
 assert.equal(EVOLUSOM_PREMIUM_SKUS.length,20);
 assert.equal(new Set(EVOLUSOM_PREMIUM_SKUS).size,20);
 const next={...context,batchId:EVOLUSOM_PREMIUM_BATCH};
 for(const sku of EVOLUSOM_PREMIUM_SKUS)assert.deepEqual(validateCatalogExpansionContext(next,sku),next);
 assert.throws(()=>validateCatalogExpansionContext(next,'VTK000001'),/NAO_AUTORIZADO/);
 assert.throws(()=>validateCatalogExpansionContext({...next,batchId:'EVOLUSOM_PREMIUM_BATCH_02'},EVOLUSOM_PREMIUM_SKUS[0]),/NAO_AUTORIZADO/);
 assert.equal(catalogExpansionKey('p'),'catalog_expansion:CATALOG_EXPANSION_BATCH_01:p');
 assert.equal(catalogExpansionKey('p',EVOLUSOM_PREMIUM_BATCH),'catalog_expansion:EVOLUSOM_PREMIUM_BATCH_01:p');
 assert.throws(()=>assertCatalogExpansionCanAdvance([{event_type:'CATALOG_EXPANSION_SAFETY_STOP'}],EVOLUSOM_PREMIUM_BATCH),/EVOLUSOM_PREMIUM_BATCH_01_SAFETY_STOP/);
});
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
test('stop só encerra com reconciliação posterior explícita do mesmo anúncio e produto',()=>{
 const stop={id:'stop1',event_type:'CATALOG_EXPANSION_SAFETY_STOP',produto_id:'p',ml_item_id:'MLB1',created_at:'2026-09-07T01:00:00Z'};
 const done={event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:'p',ml_item_id:'MLB1',created_at:'2026-09-07T01:01:00Z',payload:{reconciliation:{resolvedSafetyStopId:'stop1'}}};
 assert.doesNotThrow(()=>assertCatalogExpansionCanAdvance([stop,done]));
 for(const patch of [{payload:{}},{produto_id:'q'},{ml_item_id:'MLB2'},{created_at:'2026-09-07T00:59:00Z'},{created_at:null}])assert.throws(()=>assertCatalogExpansionCanAdvance([stop,{...done,...patch}]),/SAFETY_STOP/);
 assert.throws(()=>assertCatalogExpansionCanAdvance([stop,done,{...stop,id:'stop2',created_at:'2026-09-07T01:02:00Z'}]),/SAFETY_STOP/);
});
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
test('aviso de valor fixo exige correspondência exata com o esquema da categoria',()=>{
 const {catalogExpansionPayloadValidated:valid}=require('../src/lib/ml/catalog-expansion.ts');
 const payload={shipping:{mode:'me2',free_shipping:true}};
 const cause={type:'warning',code:'item.attributes.dropped',message:'Value of attribute VEHICLE_TYPE was dropped by category fixed-value (11377043 - Carro/Caminhonete).'};
 const response={ok:false,status:400,error:{causes:[cause]}};
 const attr={id:'VEHICLE_TYPE',tags:{fixed:true},values:[{id:'11377043',name:'Carro/Caminhonete'}]};
 assert.equal(valid(response,payload,[attr]),true);
 for(const attrs of [[],[{...attr,tags:{fixed:false}}],[{...attr,values:[{id:'different',name:'Carro/Caminhonete'}]}],[{...attr,values:[...attr.values,{id:'2',name:'Outro'}]}]])assert.equal(valid(response,payload,attrs),false);
 assert.equal(valid({...response,error:{causes:[{...cause,type:'error'}]}},payload,[attr]),false);
});
test('terceiro lote Evolusom limita publicação a 200 novos produtos e preserva reconciliação no final do lote',()=>{
 const {EVOLUSOM_PREMIUM_BATCH_03:batch,EVOLUSOM_PREMIUM_SKUS_03:skus,EVOLUSOM_PREMIUM_SKUS:previous,EVOLUSOM_PREMIUM_SKUS_02:previous2}=require('../src/lib/ml/catalog-expansion.ts');
 assert.equal(skus.length,200);assert.equal(new Set(skus).size,200);
 assert.equal(skus.some(s=>previous.includes(s)||previous2.includes(s)),false);
 for(const sku of skus)assert.doesNotThrow(()=>validateCatalogExpansionContext({...context,batchId:batch},sku));
 assert.throws(()=>validateCatalogExpansionContext({...context,batchId:batch},previous2[0]),/NAO_AUTORIZADO/);
 const events=skus.slice(0,199).flatMap(sku=>[{event_type:'CREATE_REQUESTED',produto_id:sku},{event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:sku}]);
 assert.doesNotThrow(()=>assertCatalogExpansionCanAdvance(events,batch));
 events.push({event_type:'CREATE_REQUESTED',produto_id:skus[199]});
 assert.throws(()=>assertCatalogExpansionCanAdvance(events,batch),/RECONCILIACAO/);
});
test('quarto lote Evolusom autoriza 300 produtos inéditos e bloqueia última criação inconclusiva',()=>{
 const {EVOLUSOM_PREMIUM_BATCH_04:batch,EVOLUSOM_PREMIUM_SKUS_04:skus,EVOLUSOM_PREMIUM_SKUS:a,EVOLUSOM_PREMIUM_SKUS_02:b,EVOLUSOM_PREMIUM_SKUS_03:c}=require('../src/lib/ml/catalog-expansion.ts');
 assert.equal(skus.length,300);assert.equal(new Set(skus).size,300);
 assert.equal(skus.some(s=>[...a,...b,...c].includes(s)),false);
 for(const sku of skus)assert.doesNotThrow(()=>validateCatalogExpansionContext({...context,batchId:batch},sku));
 assert.throws(()=>validateCatalogExpansionContext({...context,batchId:batch},c[0]),/NAO_AUTORIZADO/);
 assert.equal(catalogExpansionKey('p',batch),'catalog_expansion:EVOLUSOM_PREMIUM_BATCH_04:p');
 const events=skus.slice(0,299).flatMap(sku=>[{event_type:'CREATE_REQUESTED',produto_id:sku},{event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:sku}]);
 assert.doesNotThrow(()=>assertCatalogExpansionCanAdvance(events,batch));events.push({event_type:'CREATE_REQUESTED',produto_id:skus[299]});assert.throws(()=>assertCatalogExpansionCanAdvance(events,batch),/RECONCILIACAO/);
});

test('foto previamente enviada ao ML usa id, sem iniciar outro download por URL',()=>{
 const payload=listingService().buildMlCreatePayload({categoryId:'cat',price:100,availableQuantity:1,condition:'new',listingTypeId:'gold_pro',description:'Produto',pictures:[{id:'123-MLB456_092026'},'https://example.org/product.jpg'],attributes:[]});
 assert.deepEqual(JSON.parse(JSON.stringify(payload.pictures)),[{id:'123-MLB456_092026'},{source:'https://example.org/product.jpg'}]);
});
test('lanterna de camping não exige pesca por compartilhar o departamento, mas vara ainda exige',()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const source=ts.createSourceFile('guard.ts',fs.readFileSync('src/lib/ml-category-guard.ts','utf8'),ts.ScriptTarget.Latest,true);
 const declarations=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['normalizeCategoryText','assertNicheCategoryEvidence'].includes(n.name?.text)).map(n=>n.getText(source)).join('\n');
 const scope={};vm.runInNewContext(ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const guard=scope.assertNicheCategoryEvidence,root='Esportes e Fitness > Camping, Caça e Pesca';
 assert.doesNotThrow(()=>guard({nome:'Lanterna recarregável',descricao:'Ideal para camping'},{path:root+' > Faróis e Lanternas > Lanternas',domain:'MLB-FLASHLIGHTS'}));
 assert.throws(()=>guard({nome:'Cabo coaxial'},{path:root+' > Pesca > Varas',domain:'MLB-FISHING_RODS'}),/Pesca/);
 assert.doesNotThrow(()=>guard({nome:'Vara de pesca'},{path:root+' > Pesca > Varas',domain:'MLB-FISHING_RODS'}));
 assert.throws(()=>guard({nome:'Cabo coaxial'},{path:'Pet Shop > Aquários',domain:null}),/Aquários/);
});
test('descrição de roteador conserva área, corrente contínua e temperaturas sem caracteres rejeitados',()=>{
 const {supplierTextToDescription}=require('../src/lib/ml-listing-description.ts');
 assert.equal(supplierTextToDescription('200m&sup2;; estáveis \u200b\u200bcom 12V ⎓ 1A; 0 ℃ a 40 ℃ (32 ℉ a 104 ℉)'),'200m²; estáveis com 12V DC 1A; 0 °C a 40 °C (32 °F a 104 °F)');
});
test('categoria preserva metadados do GTIN oculto e publicação não reenvia código somente leitura',async()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const service=ts.createSourceFile('service.ts',fs.readFileSync('src/services/mercadolibre.ts','utf8'),ts.ScriptTarget.Latest,true);
 const fn=service.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getCategoryAttributes').getText(service).replace('export ','');
 const readonly={id:'GTIN',tags:{hidden:true,read_only:true}},scope={fetchML:async()=>[readonly,{id:'BRAND',tags:{}},{id:'INTERNAL',tags:{hidden:true}}]};
 vm.runInNewContext(ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 assert.deepEqual(Array.from(await scope.getCategoryAttributes('MLB46559'),a=>a.id),['GTIN','BRAND']);
 const route=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8'),ts.ScriptTarget.Latest,true);let removal,gtinExpression;
 function visit(n){if(ts.isIfStatement(n)&&n.getText(route).includes('attributesMap.delete("GTIN")')&&n.expression.getText(route)==='gtinAttr?.tags?.read_only')removal=n.getText(route);if(ts.isPropertyAssignment(n)&&n.name.getText(route)==='fiscalData'&&ts.isObjectLiteralExpression(n.initializer))gtinExpression=n.initializer.properties.find(p=>p.name?.getText(route)==='gtin').initializer.getText(route);ts.forEachChild(n,visit);}visit(route);assert.ok(removal);assert.ok(gtinExpression);
 const js=ts.transpileModule(removal+'\nresult = '+gtinExpression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const readOnly of [true,false]){const s={gtinAttr:{tags:{read_only:readOnly}},attributesMap:new Map([['GTIN',{id:'GTIN',value_name:'7896359519552'}]]),hasExplicitEmptyGtinReason:false,fiscal:{gtin:'7896359519552'},gtinForMl:'7896359519552',result:null};vm.runInNewContext(js,s);assert.equal(s.attributesMap.has('GTIN'),!readOnly);assert.equal(s.result,readOnly?undefined:'7896359519552');}
});
test('preparação aceita mínimo ML de 500 pixels e rejeita dimensões abaixo do limite',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),s=fs.readFileSync('scripts/catalog-expansion-batch-01.cjs','utf8');
 const check=s.match(/if\(Math\.min\(meta\.width[^\n]+IMAGEM_DIMENSAO_INSUFICIENTE'\);/)[0];
 for(const meta of [{width:500,height:500},{width:1000,height:250}])assert.doesNotThrow(()=>vm.runInNewContext(check,{meta}));
 for(const meta of [{width:499,height:499},{width:1000,height:249}])assert.throws(()=>vm.runInNewContext(check,{meta}),/IMAGEM_DIMENSAO/);
});
test('marca antiga divergente bloqueia antes do pedido de criação mesmo com GTIN igual',()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),path=require('node:path');
 const source=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8'),ts.ScriptTarget.Latest,true);let declaration,guard,claim;
 function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='canonicalIdentity'))declaration=n;if(ts.isIfStatement(n)&&n.expression.getText(source)==='canonicalIdentity.blockingConflicts.length')guard=n;if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='creationClaim')claim=n;ts.forEachChild(n,visit);}visit(source);
 assert.ok(declaration&&guard&&claim);assert.ok(guard.end<claim.pos);
 const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ml-critical-attributes.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText,{module:mod,exports:mod.exports,require:id=>require(id.startsWith('@/')?path.resolve('src',id.slice(2)+'.ts'):id)});
 const code=ts.transpileModule('(function(){'+declaration.getText(source)+guard.getText(source)+'return {status:200};})()',{compilerOptions:{target:9}}).outputText;
 for(const marca of ['STORM','NWT']){const result=vm.runInNewContext(code,{assessMlProductIdentity:mod.exports.assessMlProductIdentity,listingPayload:{attributes:[{id:'BRAND',value_name:'NWT'},{id:'GTIN',value_name:'7898566207987'}]},produto:{sku:'VTK005015',marca,gtin:'7898566207987'},gtinForMl:'7898566207987',supplierOffers:[],NextResponse:{json:(data,options)=>({...data,...options})}});assert.equal(result.status,marca==='STORM'?422:200);}
});
test('diâmetro de montagem da lente preserva valor sem o símbolo recusado pelo ML',()=>{
 const {supplierTextToDescription}=require('../src/lib/ml-listing-description.ts');
 assert.equal(supplierTextToDescription('Montagem de lente: φ14\nLente: 2.8-12mm'),'Montagem de lente: diâmetro 14\nLente: 2.8-12mm');
});
test('preparação confere dimensão após o recorte do ML, não apenas a imagem original',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('scripts/catalog-expansion-batch-01.cjs','utf8');
 const code=source.match(/const mlDimensions=[^\n]+\n\s*if\(mlDimensions[^\n]+/)[0];
 for(const max_size of ['683x414','343x738','500x250'])assert.doesNotThrow(()=>vm.runInNewContext(code,{uploaded:{max_size}}));
 for(const max_size of ['434x434','1000x249',undefined,'unknown'])assert.throws(()=>vm.runInNewContext(code,{uploaded:{max_size}}),/IMAGEM_DIMENSAO_ML/);
});
test('marcadores invisíveis de direção não contaminam peso e dimensões do fornecedor',()=>{
 const {supplierTextToDescription}=require('../src/lib/ml-listing-description.ts');
 assert.equal(supplierTextToDescription('Peso: \u200e20 g; Dimensões: \u200f20 x 4,4 x 1,5 cm'),'Peso: 20 g; Dimensões: 20 x 4,4 x 1,5 cm');
});
test('limites inferiores e superiores mantêm o sentido nas especificações em texto simples',()=>{
 const {supplierTextToDescription}=require('../src/lib/ml-listing-description.ts');
 assert.equal(supplierTextToDescription('Consumo em repouso ≤0,4 mA; isolação ≥100 MΩ'),'Consumo em repouso <=0,4 mA; isolação >=100 megaohms');
});
test('embalagem viva com quatro peças não pode ser publicada como unidade',()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),{identityFacts}=require('../src/lib/ml/opportunity-identity.ts');
 const source=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8'),ts.ScriptTarget.Latest,true),nodes=[];
 function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['livePackQuantity','declaredPresentation'].includes(d.name.getText(source))))nodes.push(n.getText(source));if(ts.isIfStatement(n)&&n.expression.getText(source)==='livePackQuantity > 1 && declaredPresentation.quantity !== livePackQuantity')nodes.push(n.getText(source));ts.forEachChild(n,visit);}visit(source);assert.equal(nodes.length,3);
 const code=ts.transpileModule(nodes.join('\n'),{compilerOptions:{target:9}}).outputText;
 const run=(qty,title,attributes=[])=>vm.runInNewContext(code,{liveOffer:{embalagem_quantidade:qty},listingPayload:{attributes},effectiveFamilyName:title,listingDescription:'',identityFacts});
 assert.throws(()=>run(4,'Calota Grid'),/QUANTIDADE_EMBALAGEM/);assert.doesNotThrow(()=>run(4,'Kit 4 Calotas Grid'));assert.doesNotThrow(()=>run(1,'Kit 2 Resistências'));
 assert.doesNotThrow(()=>run(20,'Pilha Alcalina AA',[{id:'PACKS_NUMBER',value_name:'10'},{id:'UNITS_PER_PACK',value_name:'2'}]));
});
test('executor retoma anúncios validados sem POST e exige reconciliação de pedido já registrado',async()=>{
 const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
 const source=ts.createSourceFile('runner.js',fs.readFileSync('scripts/catalog-expansion-batch-01.cjs','utf8'),ts.ScriptTarget.Latest,true);
 const code=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='execute').getText(source);
 const draft={familyName:'Produto',categoriaId:'MLB1',listingType:'gold_pro',attributes:[]},candidate={sku:'VTK1',productId:'p1',preparationId:'prep1',status:'PREPARADO',categoryReview:{version:1},draft};
 for(const mode of ['validated','claimed','changed']){
  const calls=[],targets=[],scope={dir:'/batch',BATCH:'test',SKUS:['VTK1'],console:{log(){}},save(){},fs:{existsSync:()=>false,readFileSync:path=>JSON.stringify(path.endsWith('review.json')?[{sku:'VTK1',status:'APTO_PREPARACAO',title:mode==='changed'?'Alterado':'Produto',attributes:[]}]:{results:[candidate]})},appRuntime:async()=>({app:async(...args)=>{calls.push(args);throw Error('Chamada externa inesperada');}}),verifyPublicationTarget:async(_app,c,id)=>targets.push({sku:c.sku,id}),checked:async q=>q.event==='CATALOG_EXPANSION_VALIDATED'?(mode==='validated'?{id:'v',ml_item_id:'MLB123'}:null):mode==='claimed'?[{id:'claim'}]:[],db:{from(){return{select(){return this;},eq(k,v){if(k==='event_type')this.event=v;return this;},contains(){return this;},maybeSingle(){return this;},order(){return this;},limit(){return this;}};}}};
  vm.runInNewContext(code,scope);
  if(mode==='claimed')await assert.rejects(scope.execute(),/RECONCILIACAO_PENDENTE_VTK1/);else await scope.execute();
  assert.equal(calls.length,0);assert.equal(targets.length,mode==='validated'?1:0);
 }
});

test('retentativa explícita permite somente o mesmo produto uma vez e conserva bloqueios',()=>{
 const batch=CATALOG_EXPANSION_BATCH;
 const claim={id:'claim',event_type:'CREATE_REQUESTED',produto_id:'p',created_at:'2026-09-08T00:00:00Z'};
 const auth={id:'auth',event_type:'CATALOG_EXPANSION_RETRY_AUTHORIZED',produto_id:'p',created_at:'2026-09-08T01:01:00Z',payload:{batchId:batch,previousClaimId:'claim',explicitUserAuthorization:true,remoteSearch:{complete:true,skuSearchComplete:true,matches:0,observedAt:'2026-09-08T01:00:00Z'}}};
 const retry={productId:'p',authorizationId:'auth'};
 assert.doesNotThrow(()=>assertCatalogExpansionCanAdvance([claim,auth],batch,retry));
 assert.throws(()=>assertCatalogExpansionCanAdvance([claim,auth],batch),/RECONCILIACAO/);
 assert.throws(()=>assertCatalogExpansionCanAdvance([claim,auth],batch,{...retry,productId:'q'}),/RETENTATIVA/);
 for(const extra of [{id:'claim2',event_type:'CREATE_REQUESTED',produto_id:'p'},{event_type:'CREATED_REMOTE',produto_id:'p',ml_item_id:'MLB1'},{event_type:'CATALOG_EXPANSION_SAFETY_STOP'}])assert.throws(()=>assertCatalogExpansionCanAdvance([claim,auth,extra],batch,retry));
 for(const remoteSearch of [{...auth.payload.remoteSearch,matches:1},{...auth.payload.remoteSearch,complete:false},{...auth.payload.remoteSearch,observedAt:'2026-09-07T00:00:00Z'}])assert.throws(()=>assertCatalogExpansionCanAdvance([claim,{...auth,payload:{...auth.payload,remoteSearch}}],batch,retry),/RETENTATIVA/);
});

test('revisão da categoria compara árvore completa, uso e oferta DSLite e invalida origem alterada',()=>{
 const {assertMlCategoryReview}=require('../src/lib/ml-category-guard.ts');
 const live={produtoid:'1',titulo:'Controle remoto automotivo PX80',descricao:'Controle para alarme do carro',categoria_nome:'Automotivo',marca:'Positron'};
 const info={path:'Acessórios para Veículos > Segurança Veicular > Alarmes e Acessórios > Otros',domain:'MLB-VEHICLE_SECURITY'};
 const review={version:1,categoryId:'MLB440298',...info,offerId:'o',supplierProductId:'1',productUse:'Controle de alarme automotivo',sourceExcerpt:live.descricao,source:{nome:live.titulo,descricao:live.descricao,categoria:live.categoria_nome,marca:live.marca}};
 assert.doesNotThrow(()=>assertMlCategoryReview(review,review.categoryId,info,'o',live));
 for(const changed of [undefined,{...review,version:0},{...review,offerId:'other'},{...review,path:'Otros'},{...review,sourceExcerpt:'Inventado'}])assert.throws(()=>assertMlCategoryReview(changed,review.categoryId,info,'o',live),/REVISAO/);
 assert.throws(()=>assertMlCategoryReview(review,review.categoryId,info,'o',{...live,titulo:'Controle residencial'}),/REVISAO/);
 const bad={...review,path:'Casa > Segurança > Controles remotos',domain:'MLB-HOME_ALARM_REMOTE_CONTROLS'};
 assert.throws(()=>assertMlCategoryReview(bad,bad.categoryId,bad,'o',live),/AUTOMOTIVO/);
});

test('categoria distingue marca Aquário, cabo RF e rebatimento de retrovisor de usos incompatíveis',()=>{
 const {assertMlCategoryReview}=require('../src/lib/ml-category-guard.ts');
 function run(nome,marca,path,domain){const source={nome,marca,descricao:'',categoria:''};return assertMlCategoryReview({version:1,categoryId:'cat',path,domain,offerId:'o',supplierProductId:'1',source,productUse:nome,sourceExcerpt:nome},'cat',{path,domain},'o',{produtoid:'1',titulo:nome,marca});}
 assert.throws(()=>run('Cabo de antena Aquário CF440','Aquário','Pet Shop > Aquários','MLB-AQUARIUMS'),/Aquários/);
 assert.throws(()=>run('Cabo adaptador de antena CF440','Aquário','Eletrônicos > Cabos de Áudio e Vídeo','MLB-AUDIO_AND_VIDEO_CABLES'),/CABO_RF/);
 assert.throws(()=>run('Módulo rebatimento retrovisor Tury Park2','Tury','Veículos > Máquinas de vidros','MLB-WINDOW_REGULATORS'),/RETROVISOR/);
 assert.doesNotThrow(()=>run('Cabo RCA de áudio','Technoise','Eletrônicos > Cabos de Áudio e Vídeo','MLB-AUDIO_AND_VIDEO_CABLES'));
 assert.doesNotThrow(()=>run('Filtro para peixes de aquário','Aquário','Pet Shop > Aquários','MLB-AQUARIUMS'));
});

test('substituição tem tentativa própria e histórico validado não encobre nova criação inconclusiva',()=>{
 const {catalogExpansionAttemptKey,assertCatalogExpansionReplacement}=require('../src/lib/ml/catalog-expansion.ts');
 const c={...context,replacementAuthorizationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'};
 const old={event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:'p',ml_item_id:'MLBOLD',payload:{approvalId:'old'}};
 const auth={id:c.replacementAuthorizationId,event_type:'CATALOG_EXPANSION_REPLACEMENT_AUTHORIZED',produto_id:'p',payload:{batchId:c.batchId,preparationId:c.preparationId,explicitUserAuthorization:true,oldItemId:'MLBOLD',archive:{item:{id:'MLBOLD'}},deletedReadback:{id:'MLBOLD',sold_quantity:0,sub_status:['deleted']},orders:{complete:true,total:0}}};
 assert.equal(assertCatalogExpansionReplacement([old,auth],'p',c),'MLBOLD');
 assert.notEqual(catalogExpansionAttemptKey('p',c),catalogExpansionAttemptKey('p',context));
 const claim={event_type:'CREATE_REQUESTED',produto_id:'p',payload:{approvalId:'new',replacementAuthorizationId:c.replacementAuthorizationId}};
 assert.throws(()=>assertCatalogExpansionCanAdvance([old,claim],c.batchId),/RECONCILIACAO/);
 assert.throws(()=>assertCatalogExpansionReplacement([old,auth,claim],'p',c),/CONSUMIDA/);
 assert.doesNotThrow(()=>assertCatalogExpansionCanAdvance([old,claim,{event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:'p',payload:claim.payload}],c.batchId));
 for(const patch of [{preparationId:'wrong'},{policyRestriction:'DECODIFICADORES'},{orders:{complete:true,total:1}},{deletedReadback:{id:'MLBOLD',sold_quantity:0,sub_status:[]}}])assert.throws(()=>assertCatalogExpansionReplacement([old,{...auth,payload:{...auth.payload,...patch}}],'p',c),/SUBSTITUICAO/);
 assert.throws(()=>validateCatalogExpansionContext({...c,retryAuthorizationId:c.replacementAuthorizationId},'VTK002091'),/SUBSTITUICAO/);
});

test('menção a controle na descrição e departamento Antenas não mudam o tipo do produto',()=>{
 const {assertMlCategoryReview}=require('../src/lib/ml-category-guard.ts');
 const cases=[
 ['Cabo HDMI x DVI','Transmissão de vídeo','Antenas e Acessórios / Cabo HDMI','Eletrônicos > Cabos > Outros','MLB-AUDIO_AND_VIDEO_CABLES_AND_ADAPTERS'],
 ['Motor de vidro elétrico','Acionamento pelo controle remoto veicular','Automotivo','Veículos > Janelas > Sistemas de Elevação','MLB-VEHICLE_POWER_WINDOW_REGULATORS']
 ];
 for(const [nome,descricao,categoria,path,domain] of cases){const source={nome,descricao,categoria,marca:'Marca'};assert.doesNotThrow(()=>assertMlCategoryReview({version:1,categoryId:'cat',path,domain,offerId:'o',supplierProductId:'1',source,productUse:nome,sourceExcerpt:nome},'cat',{path,domain},'o',{produtoid:'1',titulo:nome,descricao,categoria_nome:categoria,marca:'Marca'}));}
});

test('parada da rota usa chave própria da substituição mesmo com parada anterior do produto',()=>{
 const fs=require('fs'),ts=require('typescript'),vm=require('vm');
 const source=ts.createSourceFile('route.ts',fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8'),ts.ScriptTarget.Latest,true);let key;
 function visit(n){if(ts.isObjectLiteralExpression(n)&&n.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='event_type'&&p.initializer.getText(source).includes('CATALOG_EXPANSION_SAFETY_STOP')))key=n.properties.find(p=>p.name?.getText(source)==='dedupe_key')?.initializer.getText(source);ts.forEachChild(n,visit);}visit(source);assert.ok(key);
 const {catalogExpansionAttemptKey}=require('../src/lib/ml/catalog-expansion.ts');
 const evaluate=batch=>vm.runInNewContext(ts.transpileModule('result = '+key,{compilerOptions:{target:9}}).outputText,{batch,batchProductId:'p',catalogExpansionAttemptKey,catalogExpansionKey,result:null});
 assert.notEqual(evaluate(context),evaluate({...context,replacementAuthorizationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}));
});

test('moderação definitiva recebida pelo reconciliador interrompe lote mesmo antes do vínculo local',async()=>{
 const fs=require('fs'),ts=require('typescript'),vm=require('vm'),mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/ml/reconcile-anuncio.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText,{module:mod,exports:mod.exports,console,require:()=>({mapMlStatusToLocalStatus:()=> 'pausado'})});
 const stops=new Map();let unavailable=false,hasBatch=true;
 const client={from(table){return{select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},async maybeSingle(){return{data:table==='pricing_events'?{produto_id:'p',actor:'actor',payload:hasBatch?{batchId:context.batchId}: {}}:null,error:null};},async upsert(value,options){assert.equal(options.ignoreDuplicates,true);if(unavailable)return{error:{message:'offline'}};stops.set(value.dedupe_key,value);return{error:null};}};}};
 const item={id:'MLB1',status:'under_review',sub_status:['forbidden'],category_id:'cat'};
 for(let n=0;n<2;n++)assert.equal((await mod.exports.reconcileAnuncioMlFromItem(client,item,'items_webhook')).ok,true);
 assert.equal(stops.size,1);const stop=[...stops.values()][0];assert.equal(stop.event_type,'CATALOG_EXPANSION_SAFETY_STOP');assert.throws(()=>assertCatalogExpansionCanAdvance([stop],context.batchId),/SAFETY_STOP/);
 unavailable=true;const failed=await mod.exports.reconcileAnuncioMlFromItem(client,item,'items_webhook');assert.equal(failed.ok,false);assert.match(failed.error,/CATALOG_EXPANSION_MODERATION_AUDIT/);
 hasBatch=false;assert.equal((await mod.exports.reconcileAnuncioMlFromItem(client,item,'items_webhook')).ok,true);
});

test('retomada não confia no alvo em cache quando o anúncio foi moderado depois',async()=>{
 const fs=require('fs'),ts=require('typescript'),vm=require('vm');const source=ts.createSourceFile('runner.js',fs.readFileSync('scripts/catalog-expansion-batch-01.cjs','utf8'),ts.ScriptTarget.Latest,true);const code=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='verifyPublicationTarget').getText(source);let reads=0;
 const scope={dir:'/batch',fs:{existsSync:()=>true,readFileSync:()=>JSON.stringify({rows:[{sku:'SKU',itemId:'MLB1',status:'ALVO_VALIDADO',after:{price:100}}]})},db:{from:()=>({select(){return this;},eq(){return this;},single(){return this;}})},checked:async()=>({access_token:'test-token'}),fetch:async()=>{reads++;return{ok:true,json:async()=>({id:'MLB1',status:'under_review',category_id:'cat',seller_custom_field:'SKU',price:100})}},AbortSignal};vm.runInNewContext(code,scope);await assert.rejects(scope.verifyPublicationTarget(()=>{throw Error('Não deve alterar preço');},{sku:'SKU',draft:{categoriaId:'cat'}},'MLB1'),/ESTADO_IDENTIDADE/);assert.equal(reads,1);
});
