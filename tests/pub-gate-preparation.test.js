const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), ts=require('typescript');
const load=require('./helpers/load-integration-module');
const audit=load('src/services/pricing-audit.ts',{zod:require('zod')});
const id='00000000-0000-4000-8000-000000000001';
const input=()=>({produtoId:id,categoriaId:'MLB1',listingType:'gold_pro',priceCents:11000,
  attributes:[{id:'BRAND',value_name:'Marca comprovada'}],sale_terms:[],warrantyRevision:'r1',
  shipping:{mode:'not_specified',logisticType:'not_specified',freeShipping:false}});
function harness(options={}) {
  const calls=[], saved=[];
  const product={id,ativo:true,sku:'TEST1',nome:'Produto comprovado',imagens:options.noImages?[]:['https://images.example.com/product.jpg'],ml_item_id:options.linked?'MLB2':null};
  const memory={revenueCents:11000,resultCents:1100,margin:options.belowFloor?.01:.1,band:{floor:.07},cost:{expiresAt:null},fee:{expiresAt:null},shipping:{expiresAt:null}};
  if(options.partialMemory){memory.resultCents=null;memory.margin=null;}
  const pricing={current:{status:'available',memory},target:{ok:true,evaluation:{memory}},floor:{ok:true},breakEven:{ok:true},revalidation:{status:options.inconclusive?'inconclusive':'queried'}};
  const client={from(table){const q={select(){return q},eq(){return q},insert(row){saved.push(row);return q},
    single:async()=>({data:table==='produtos'?product:{id}}),then(resolve){resolve({data:[],error:null})}};return q;}};
  const source='src/services/publication-preparation.ts';
  const mocks=Object.fromEntries(ts.preProcessFile(fs.readFileSync(source,'utf8')).importedFiles.map(i=>[i.fileName,{}]));
  Object.assign(mocks,{
    'node:crypto':require('node:crypto'),zod:require('zod'),'@/lib/supabase':{createServiceClient:()=>client},
    '@/lib/ml-category-guard':{assertAllowedMlCategoryForProduct:async()=>{}},
    '@/lib/ml-critical-attributes':{loadMlIdentityKit:async()=>({}),assessMlProductIdentity:()=>({comparisons:[{field:'BRAND',local:'A',remote:'A',status:'SEM_CONFLITO',reason:'same',evidence:[{collectedAt:new Date().toISOString()}]}]})},
    '@/lib/ml-listing-identity':{isMlIdentityComplete:()=>!options.identityPending},
    '@/lib/ml-listing-description':{buildEvidenceBasedMlDescription:()=> 'Descrição comprovada'},
    '@/lib/dslite/supplier-policy':{loadOperationalDropshippingSupplierIds:async()=>new Set()},
    '@/lib/orders/fulfillment-capacity-loader':{loadProductFulfillmentCapacity:async()=>({safe:options.noStock?0:3})},
    '@/lib/fiscal-strict':{fiscalStrictSchema:{safeParse:()=>({success:!options.invalidFiscal,data:{ncm:'valid'}})}},
    '@/lib/product-warranty':{warrantySaleTerms:()=>({compatible:true,terms:[{id:'WARRANTY_TIME',value_name:'12 meses'}]}),warrantyDescription:x=>x,warrantyDescriptionConflicts:()=>false},
    './product-warranty':{loadProductWarranty:async()=>({resolution:{revision:options.warrantyChanged?'r2':'r1'}})},
    './mercadolibre':{getCategoryAttributes:async()=>[],getCategorySaleTerms:async()=>[]},
    './integration':{fetchMLResult:async(path,init)=>{calls.push([path,init]);return path==='/users/me'?{ok:true,data:{id:123,tags:['test_user']}}:
      path.endsWith('/conditional')?{ok:true,data:{required_attributes:options.conditionalMissing?[{id:'GTIN'}]:[]}}:{ok:!options.validationFailed};}},
    './pricing-detail':{loadPricingDetail:async()=>Response.json({pricing})},'./pricing-audit':audit,
    './ml-listing-links':{resolveProductMlLinks:async()=>({classification:options.uncertainLink?'VINCULO_INCONCLUSIVO':'NOVO_ANUNCIO_CANDIDATO',candidates:[]})},
    './pricing-execution-access':{requireTestPricingAccount:async()=> '123',testPricingTransport:()=>({})},
  });
  return {module:load(source,mocks),calls,saved};
}
test('preparation uses the canonical memory, safe capacity, real images and null future IDs',async()=>{
  const h=harness(), prepared=await h.module.preparePublication(input(),id);
  assert.equal(prepared.decisionContext.priceCents,11000);assert.equal(prepared.preparation.payload.price,110);
  assert.equal(prepared.preparation.capacity,3);assert.equal(prepared.decisionContext.itemId,null);assert.equal(prepared.decisionContext.groupId,null);
  assert.equal(prepared.decisionContext.operationKind,'listing_create');assert.equal(h.saved.length,1);
  assert.ok(h.calls.some(([path])=>path==='/items/validate'));
  assert.ok(!h.calls.some(([path])=>path==='/items'));
  const again=await h.module.preparePublication(input(),id);assert.equal(again.decisionContext.fingerprint,prepared.decisionContext.fingerprint);
});
test('legacy modes, fabricated identity fields and actor injection are rejected by the contract',()=>{
  const h=harness();for(const extra of [{pricingMode:'profitable_shelf_2'},{targetNetProfit:20},{basePrice:110},{actorId:id},{allowOutOfStockListing:true}])
    assert.equal(h.module.publicationInputSchema.safeParse({...input(),...extra}).success,false);
});
test('missing/conflicting evidence never becomes a publishable preparation',async()=>{
  for(const option of ['noImages','noStock','linked','identityPending','invalidFiscal','warrantyChanged','inconclusive','uncertainLink','validationFailed','belowFloor','conditionalMissing','partialMemory']) {
    const h=harness({[option]:true});await assert.rejects(h.module.preparePublication(input(),id));assert.equal(h.saved.length,0,option);
    assert.ok(!h.calls.some(([path])=>path==='/items'),option);
  }
});
