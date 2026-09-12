const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const load=require('./helpers/load-integration-module');
const pure=require('../src/lib/ml/listing-link.ts');
function service(fetchMLResult, extra={}) {return load('src/services/ml-listing-links.ts',{
  '@/services/integration':{fetchMLResult},'@/services/mercadolibre':{},
  '@/lib/ml/items-bulk':require('../src/lib/ml/items-bulk.ts'),
  '@/lib/ml-critical-attributes':{},'@/lib/ml-listing-identity':{},'@/lib/dslite/supplier-policy':{},
  '@/lib/ml/listing-link':pure,
  ...extra,
});}

function resolverFixture(options={}) {
  const product={id:'P1',sku:'VTK1',ml_item_id:'MLB1'};
  const item={id:'MLB1',seller_id:1,status:'active',category_id:'CAT1',catalog_listing:false,item_relations:[],variations:[],...options.item};
  const calls=[];
  const client={from:table=>{
    const rows=table==='anuncios_ml'?[{ml_item_id:'MLB1',produto_id:options.owner||'P1'}]:[];
    const query={select(){return this},eq(){return this},in(){return this},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve)}};return query;
  }};
  const api=service(async path=>{calls.push(path);
    if(path.includes('/items/search?'))return {ok:true,data:{results:['MLB1'],paging:{total:1}}};
    if(path.startsWith('/items/bulk?')){
      if(options.bulkFailed)return {ok:false,status:503};
      const requested=new URL(path,'https://ml.test').searchParams.get('attributes').split(',').filter(value=>value.startsWith('body.')).map(value=>value.slice(5));
      return {ok:true,data:[{id:'MLB1',status_code:200,body:Object.fromEntries(requested.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]))}]};
    }
    if(path.startsWith('/items/MLB1?'))return options.variationFailed?{ok:false,status:503}:{ok:true,data:item};
    return {ok:false,status:404};
  },{
    '@/services/mercadolibre':{getCategoryAttributes:async()=>[]},
    '@/lib/ml-critical-attributes':{loadMlIdentityKit:async()=>({status:'not_kit',components:[]}),assessMlProductIdentity:()=>({complete:!options.identityPending})},
    '@/lib/ml-listing-identity':{isMlExistingListingIdentitySafe:a=>a.complete,hasConfirmedMlIdentityConflict:()=>false},
    '@/lib/dslite/supplier-policy':{loadOperationalDropshippingSupplierIds:async()=>new Set()},
  });
  return {run:()=>api.resolveProductMlLinks(client,product,1),calls};
}
test('resolvedor integra descoberta, ownership, identidade e grupos independentes',async()=>{
  const f=resolverFixture();const r=await f.run();assert.equal(r.classification,'JA_ANUNCIADO_ATIVO');assert.equal(r.groups.length,1);assert.equal(r.candidates.length,1);assert.equal(f.calls.filter(p=>p.startsWith('/items/bulk')).length,1);
  const bulk=f.calls.find(p=>p.startsWith('/items/bulk'));for(const attribute of ['seller_id','status','category_id','catalog_listing','item_relations','variations','attributes','seller_custom_field'])assert.ok(bulk.includes(`body.${attribute}`));
});
for(const options of [{bulkFailed:true},{owner:'P2'},{identityPending:true},{item:{seller_id:2}},{item:{item_relations:null}}])test('resolvedor não valida fonte falha ou propriedade ambígua',async()=>{
  const r=await resolverFixture(options).run();assert.equal(r.classification,'VINCULO_INCONCLUSIVO');
});
test('variação usa leitura individual documentada e nunca herda SKU raiz como seleção',async()=>{
  const f=resolverFixture({item:{variations:[{id:'V1',seller_custom_field:'VTK1'}]}});const r=await f.run();assert.equal(r.candidates[0].variationId,'V1');assert.ok(f.calls.includes('/items/MLB1?include_attributes=all'));
  const failed=await resolverFixture({item:{variations:[{id:'V1'}]},variationFailed:true}).run();assert.equal(failed.classification,'VINCULO_INCONCLUSIVO');
});
test('pesquisa pagina ambos os campos oficiais, deduplicando IDs sem escolher primeiro',async()=>{
  const calls=[];const api=service(async path=>{calls.push(path);const offset=Number(new URL(path,'https://ml.test').searchParams.get('offset'));
    return {ok:true,data:{results:offset?['MLB2']:['MLB1'],paging:{total:2}}};});
  const r=await api.searchListingIdsBySkus(1,['SKU','SKU']);assert.equal(calls.length,4);assert.deepEqual(r.ids,['MLB1','MLB2']);assert.equal(r.complete,true);
  assert.ok(calls.some(p=>p.includes('?sku=')));assert.ok(calls.some(p=>p.includes('?seller_sku=')));
});
for(const status of [403,404,429,500])test(`falha ${status} nunca é ausência comprovada`,async()=>{
  const api=service(async()=>({ok:false,status}));assert.equal((await api.searchListingIdsBySkus(1,['SKU'])).complete,false);
});
test('payload sem total não é busca completa',async()=>{
  const api=service(async()=>({ok:true,data:{results:[]}}));assert.equal((await api.searchListingIdsBySkus(1,['SKU'])).complete,false);
});
test('persistência usa somente RPC observacional e não ignora observação rejeitada',async()=>{
  const calls=[];const api=service(async()=>{throw Error('ML não esperado')});
  const result=await api.persistProductMlGroups({rpc:async(name,args)=>{calls.push({name,args});return {data:{applied:false,reason:'older_observation'}};}},'P1',1,{coverage:'partial',groups:[]},'2026-09-07T00:00:00.000Z');
  assert.equal(result.applied,false);assert.equal(calls[0].name,'reconcile_ml_pricing_groups');assert.equal(calls[0].args.p_complete,false);
});
test('rota de vinculação reutiliza job autenticado e não contém writer por SKU',()=>{
  const s=fs.readFileSync('src/app/api/sync/vincular-produtos/route.ts','utf8');assert.match(s,/export \{ POST \} from '\.\.\/anuncios\/job\/route'/);assert.doesNotMatch(s,/\.update\(|\.eq\('sku'/);
});
test('criação e fiscal abandonaram seleção do primeiro resultado',()=>{
  const create=fs.readFileSync('src/app/api/ml/anuncio/criar/route.ts','utf8');
  const preparation=fs.readFileSync('src/services/publication-preparation.ts','utf8');
  assert.match(create,/preparePublication/);assert.match(preparation,/resolveProductMlLinks/);assert.match(preparation,/publication_existing_or_inconclusive_link/);
  const fiscal=fs.readFileSync('src/app/api/ml/anuncio/testar-fiscal/route.ts','utf8');assert.match(fiscal,/resolveProductMlLinks/);assert.match(fiscal,/existing_listings_require_selection/);
  assert.doesNotMatch(create,/searchItemBySellerSku/);assert.doesNotMatch(preparation,/searchItemBySellerSku/);assert.doesNotMatch(fiscal,/searchItemBySellerSku/);
  assert.doesNotMatch(fs.readFileSync('src/services/mercadolibre.ts','utf8'),/searchItemBySellerSku/);
});
test('nenhum executor de sincronismo de catálogo foi criado',()=>{
  const s=fs.readFileSync('src/services/ml-listing-links.ts','utf8');assert.match(s,/\/public\/buybox\/sync\//);assert.doesNotMatch(s,/method:.*(?:POST|PUT|DELETE)/);
});
