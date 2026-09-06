#!/usr/bin/env node
/** Lote pontual autorizado. Inspect: SELECT e GET; publicações usam exclusivamente as rotas canônicas do ERP. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const BATCH='CATALOG_EXPANSION_BATCH_01',dir=path.resolve('reports',BATCH);
const SKUS=['VTK018319','VTK017249','VTK017680','VTK017308','VTK002091','VTK019530','VTK017291','VTK018523','VTK017289','VTK018716'];
const db=createClient(process.env.SUPABASE_SERVICE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const checked=async p=>{const r=await p;if(r.error)throw Error(r.error.message);return r.data;};
const save=(name,data)=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n');};
async function inspect(){
 const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
 const supplier=await checked(db.from('integracoes').select('url,access_token').eq('tipo','dslite').single());
 const requests=[];
 async function ml(endpoint){try{const r=await fetch('https://api.mercadolibre.com'+endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const data=await r.json();requests.push({method:'GET',endpoint,status:r.status,at:new Date().toISOString()});return {ok:r.ok,status:r.status,data};}catch{return{ok:false,status:null,data:null};}}
 const me=await ml('/users/me');if(!me.ok)throw Error('CONTA_ML_INDISPONIVEL');
 const preferences=await ml('/users/'+me.data.id+'/shipping_preferences');
 const products=await checked(db.from('produtos').select('*').in('sku',SKUS));
 const suppliers=await checked(db.from('fornecedores').select('id,dslite_id,ativo'));
 save('account.json',{sellerId:me.data.id,tags:me.data.tags,preferences,suppliers});
 const rows=[];
 for(const sku of SKUS){
  const product=products.find(p=>p.sku===sku);if(!product){rows.push({sku,error:'SKU_AUSENTE'});continue;}
  const offers=await checked(db.from('produto_fornecedor_ofertas').select('*').eq('produto_id',product.id));
  const offer=offers.find(o=>o.id===product.oferta_preferencial_id);
  const listings=await checked(db.from('anuncios_ml').select('ml_item_id,status,pricing_group_id,produto_id').eq('produto_id',product.id));
  const searches=await Promise.all(['seller_sku','sku'].map(k=>ml('/users/'+me.data.id+'/items/search?'+k+'='+sku)));
  const ids=[...new Set([...searches.flatMap(r=>r.data?.results??[]),...listings.map(l=>l.ml_item_id),product.ml_item_id].filter(Boolean))];
  const items=await Promise.all(ids.map(id=>ml('/items/'+id)));
  let liveOffer=null;
  if(offer){const endpoint='/v1/CrossDocking/Catalogo/'+offer.dslite_fornecedor_id+'/'+offer.dslite_produto_id;
   try{const r=await fetch(supplier.url.replace(/\/+$/,'')+endpoint,{headers:{Token:supplier.access_token},signal:AbortSignal.timeout(20000)});liveOffer={status:r.status,at:new Date().toISOString(),data:await r.json()};requests.push({provider:'dslite',method:'GET',endpoint,status:r.status});}catch{liveOffer={status:null};}}
  const catalogSearch=await ml('/products/search?status=active&site_id=MLB&product_identifier='+product.gtin);
  const catalogs=await Promise.all((catalogSearch.data?.results??[]).slice(0,5).map(c=>ml('/products/'+c.id)));
  const prediction=await ml('/sites/MLB/domain_discovery/search?limit=3&q='+encodeURIComponent(offer?.nome||product.nome));
  const categoryIds=[...new Set([...(prediction.data??[]).map(p=>p.category_id),...catalogs.map(c=>c.data?.category_id)].filter(Boolean))];
  const categories=await Promise.all(categoryIds.map(async id=>({id,info:await ml('/categories/'+id),attributes:await ml('/categories/'+id+'/attributes'),saleTerms:await ml('/categories/'+id+'/sale_terms')})));
  rows.push({sku,product,offers,listings,searches,items,liveOffer,catalogSearch,catalogs,prediction,categories});
  save('inspection.json',{batchId:BATCH,at:new Date().toISOString(),rows,requests});
  console.log(JSON.stringify({sku,items:items.map(i=>({id:i.data?.id,status:i.data?.status})),supplierHttp:liveOffer?.status,catalogs:catalogs.map(c=>c.data?.id),categories:categoryIds}));
 }
}

module.exports={BATCH,SKUS,dir,db,checked,save};

async function appRuntime() {
 const base=process.env.BATCH_API_URL || 'https://app.vortek.shop';
 if (!['https://app.vortek.shop','http://localhost:3000'].includes(base)) throw Error('APP_DESTINO_NAO_AUTORIZADO');
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.BATCH_LOGIN_EMAIL,senha:process.env.BATCH_LOGIN_PASSWORD}),signal:AbortSignal.timeout(20000)});
 const user=await login.json();if(!login.ok||user.user?.cargo!=='admin')throw Error('LOGIN_ADMIN_INDISPONIVEL');
 let cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 async function app(endpoint,method='GET',body) {
  const r=await fetch(base+endpoint,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(300000)});
  const newCookies=r.headers.getSetCookie();if(newCookies.length)cookie=newCookies.map(x=>x.split(';')[0]).join('; ');
  const data=await r.json();return{ok:r.ok,status:r.status,data};
 }
 return{app,actor:user.user.id};
}
async function prepare() {
 const {app,actor}=await appRuntime();
 const inspection=JSON.parse(fs.readFileSync(path.join(dir,'inspection.json'))),reviews=JSON.parse(fs.readFileSync(path.join(dir,'review.json'))),duplicates=JSON.parse(fs.readFileSync(path.join(dir,'duplicate-coverage.json')));
 if(!duplicates.complete)throw Error('DUPLICIDADE_INCONCLUSIVA');
 const {identityFacts,supplierIdentityFacts}=require('../src/lib/ml/opportunity-identity.ts');
 const {assessIdentity}=require('../src/lib/ml/opportunity-conflicts.ts');
 const results=[];
 for(const review of reviews){
  if(review.status!=='APTO_PREPARACAO')continue;
  const row=inspection.rows.find(x=>x.sku===review.sku),p=row.product,o=row.offers.find(x=>x.id===p.oferta_preferencial_id),v=row.liveOffer.data.produtos.find(x=>String(x.produtoid)===String(o.dslite_produto_id)),catalog=row.catalogs[0].data;
  if(duplicates.matches.some(x=>x.catalog_product_id===catalog.id))throw Error('ANUNCIO_EXISTENTE_'+review.sku);
  const previous=await checked(db.from('produtos').select('altura,largura,profundidade,peso_bruto,updated_at').eq('id',p.id).single());
  const patch={altura:v.altura_embalagem,largura:v.largura_embalagem,profundidade:v.profundidade_embalagem,peso_bruto:v.peso_embalagem};
  if(Object.keys(patch).some(k=>Number(previous[k])!==Number(patch[k]))){
   await checked(db.from('pricing_events').insert({event_type:'CATALOG_EXPANSION_LOGISTICS_CORRECTED',produto_id:p.id,pricing_source:'radar_launch',actor,reason:'Embalagem confirmada na oferta viva; produto ativo preservado',payload:{batchId:BATCH,previous,next:patch,source:'/v1/CrossDocking/Catalogo/'+o.dslite_fornecedor_id+'/'+o.dslite_produto_id,observedAt:row.liveOffer.at}}));
   await checked(db.from('produtos').update(patch).eq('id',p.id).eq('updated_at',previous.updated_at));
  }
  const warrantyInput={evidence:[{origin:'GARANTIA_FORNECEDOR',productId:p.id,gtin:p.gtin,offerId:o.id,duration:Number(v.tempo_garantia),unit:'dias',source:`DSLite /v1/CrossDocking/Catalogo/${o.dslite_fornecedor_id}/${o.dslite_produto_id}:tempo_garantia; inspection.json`,observedAt:row.liveOffer.at}]};
  const warranty=await app('/api/produtos/'+p.id,'PATCH',{reason:'Diretoria: garantia específica da oferta; pesquisa de fabricante sem prazo aplicável comprovado',warrantyEvidence:warrantyInput});
  if(!warranty.ok)throw Error('GARANTIA_'+JSON.stringify(warranty.data));
  const images=[];
  const imageEvidence=[];
  for(const original of o.imagens.slice(0,3)){
   const url=original.replace('://evolusom.com.br/','://www.evolusom.com.br/');
   const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw Error('IMAGEM_INDISPONIVEL');
   const bytes=Buffer.from(await r.arrayBuffer()),meta=await require('sharp')(bytes).metadata();
   if(Math.min(meta.width||0,meta.height||0)<250||Math.max(meta.width||0,meta.height||0)<=500)throw Error('IMAGEM_DIMENSAO_INSUFICIENTE');
   const hash=crypto.createHash('sha256').update(bytes).digest('hex'),object=`catalog-expansion/${BATCH}/${p.sku}/${hash}.${meta.format==='jpeg'?'jpg':meta.format}`;
   const upload=await db.storage.from('product-images').upload(object,bytes,{contentType:r.headers.get('content-type'),upsert:false});
   if(upload.error && !['409','Duplicate'].includes(String(upload.error.statusCode)) && !/already exists/i.test(upload.error.message))throw Error(upload.error.message);
   const publicUrl=db.storage.from('product-images').getPublicUrl(object).data.publicUrl;
   const remote=await fetch(publicUrl,{method:'HEAD',signal:AbortSignal.timeout(10000)});if(!remote.ok)throw Error('IMAGEM_PUBLICA_INDISPONIVEL');
   images.push(publicUrl);imageEvidence.push({original,url:publicUrl,hash,width:meta.width,height:meta.height});
  }
  const attributes=catalog.attributes.filter(a=>!['PRODUCT_TYPE','AWG_SIZE','CABLE_DIAMETER'].includes(a.id)).map(a=>({id:a.id,...(a.value_id?{value_id:a.value_id}:{}),value_name:a.value_name}));
  attributes.push({id:'GTIN',value_name:p.gtin});
  const draft={categoriaId:review.categoryId,listingType:'gold_special',description:review.description,attributes,familyName:review.title};
  const identity=assessIdentity({local:supplierIdentityFacts(o,identityFacts(attributes,{title:review.title})),remote:identityFacts(attributes,{title:review.title}),source:'Diretoria + oferta viva + catálogo vivo'});
  if(identity.identity!=='IDENTIDADE_COHERENTE')throw Error('IDENTIDADE_'+JSON.stringify(identity));
  const simulation=await app('/api/pricing/simulate','POST',{productId:p.id,categoryId:review.categoryId,listingType:'gold_special',objective:'target'});
  const record={sku:p.sku,productId:p.id,draft,simulation:simulation.data,status:simulation.ok&&simulation.data.success?'PREPARADO':'ECONOMIA_INCONCLUSIVA',warranty:warranty.data.warranty,imageEvidence,identity};
  if(simulation.ok&&simulation.data.success){
   const id=crypto.randomUUID();
   const payload={batchId:BATCH,identity:identity.identity,conflict:'SEM_CONFLITO',logistics:'CONFIRMED',warrantyPolicyVersion:warranty.data.warranty.policyVersion,offerId:o.id,cost:Number(o.custo),stock:Number(o.estoque),catalogProductId:catalog.id,images,draftHash:crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex'),draft,review,duplicateCoverage:{complete:true,at:duplicates.at,total:duplicates.total},sourceInspectionAt:inspection.at};
   await checked(db.from('pricing_events').insert({id,event_type:'CATALOG_EXPANSION_PREPARED',produto_id:p.id,pricing_source:'radar_launch',actor,reason:'Preparação individual revisada pela ordem da Diretoria',rule_id:warranty.data.warranty.policyVersion,payload}));
   record.preparationId=id;
  }
  results.push(record);save('preparation.json',{batchId:BATCH,at:new Date().toISOString(),results});console.log({sku:p.sku,status:record.status,price:simulation.data.memory?.price,margin:simulation.data.memory?.margin});
 }
}
async function execute() {
 const {app}=await appRuntime();
 const prepared=JSON.parse(fs.readFileSync(path.join(dir,'preparation.json'))).results.filter(r=>r.status==='PREPARADO').sort((a,b)=>b.simulation.memory.result-a.simulation.memory.result||a.sku.localeCompare(b.sku));
 const results=[];
 for(const candidate of prepared){
  const simulation=await app('/api/pricing/simulate','POST',{productId:candidate.productId,categoryId:candidate.draft.categoriaId,listingType:candidate.draft.listingType,objective:'target'});
  if(!simulation.ok||!simulation.data.success){results.push({sku:candidate.sku,status:'BLOQUEADO_PRE_POST',response:simulation});save('execution.json',{results});continue;}
  const approval=await app('/api/pricing/approve','POST',{evaluationId:simulation.data.evaluationId,acknowledgeEstimates:true,reason:'Diretoria autorizou CATALOG_EXPANSION_BATCH_01; alvo canônico e tributo estimated registrado'});
  if(!approval.ok)throw Error('APROVACAO_'+JSON.stringify(approval.data));
  save('execution-checkpoint.json',{batchId:BATCH,sku:candidate.sku,preparationId:candidate.preparationId,approvalId:approval.data.approvalId,at:new Date().toISOString(),state:'ANTES_DA_ROTA_PUBLICACAO'});
  const response=await app('/api/ml/anuncio/criar','POST',{...candidate.draft,produtoId:candidate.productId,pricingMode:'canonical',pricingApprovalId:approval.data.approvalId,catalogExpansion:{batchId:BATCH,preparationId:candidate.preparationId}});
  const event=await checked(db.from('pricing_events').select('event_type,ml_item_id,payload').eq('produto_id',candidate.productId).eq('event_type','CATALOG_EXPANSION_VALIDATED').contains('payload',{batchId:BATCH}).maybeSingle());
  results.push({sku:candidate.sku,status:event?'PUBLICADO_VALIDADO':'BLOQUEADO_OU_INCONCLUSIVO',response,event});save('execution.json',{batchId:BATCH,at:new Date().toISOString(),results});
  console.log({sku:candidate.sku,http:response.status,status:results.at(-1).status,itemId:event?.ml_item_id,error:response.data.error});
  if(!event)break;
 }
}

if(require.main===module){const action={inspect,prepare,execute}[process.argv[2]];if(!action)throw Error("Use inspect, prepare ou execute");action().catch(e=>{console.error(e.message);process.exitCode=1;});}
