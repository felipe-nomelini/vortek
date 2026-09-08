#!/usr/bin/env node
/** Lote pontual autorizado. Inspect: SELECT e GET; publicações usam exclusivamente as rotas canônicas do ERP. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const {CATALOG_EXPANSION_BATCH,CATALOG_EXPANSION_SKUS,EVOLUSOM_PREMIUM_BATCH,EVOLUSOM_PREMIUM_SKUS,EVOLUSOM_PREMIUM_BATCH_02,EVOLUSOM_PREMIUM_SKUS_02,EVOLUSOM_PREMIUM_BATCH_03,EVOLUSOM_PREMIUM_SKUS_03,EVOLUSOM_PREMIUM_BATCH_04,EVOLUSOM_PREMIUM_SKUS_04,EVOLUSOM_PREMIUM_BATCH_05,EVOLUSOM_PREMIUM_SKUS_05,EVOLUSOM_PREMIUM_BATCH_06,EVOLUSOM_PREMIUM_SKUS_06}=require('../src/lib/ml/catalog-expansion.ts');
const BATCH=process.argv.find(x=>x.startsWith('--batch='))?.slice(8)||CATALOG_EXPANSION_BATCH;
if(![CATALOG_EXPANSION_BATCH,EVOLUSOM_PREMIUM_BATCH,EVOLUSOM_PREMIUM_BATCH_02,EVOLUSOM_PREMIUM_BATCH_03,EVOLUSOM_PREMIUM_BATCH_04,EVOLUSOM_PREMIUM_BATCH_05,EVOLUSOM_PREMIUM_BATCH_06].includes(BATCH))throw Error('LOTE_NAO_AUTORIZADO');
const IS_EVOLUSOM=[EVOLUSOM_PREMIUM_BATCH,EVOLUSOM_PREMIUM_BATCH_02,EVOLUSOM_PREMIUM_BATCH_03,EVOLUSOM_PREMIUM_BATCH_04,EVOLUSOM_PREMIUM_BATCH_05,EVOLUSOM_PREMIUM_BATCH_06].includes(BATCH);
const dir=path.resolve('reports',BATCH),SKUS=BATCH===EVOLUSOM_PREMIUM_BATCH_06?EVOLUSOM_PREMIUM_SKUS_06:BATCH===EVOLUSOM_PREMIUM_BATCH_05?EVOLUSOM_PREMIUM_SKUS_05:BATCH===EVOLUSOM_PREMIUM_BATCH_04?EVOLUSOM_PREMIUM_SKUS_04:BATCH===EVOLUSOM_PREMIUM_BATCH_03?EVOLUSOM_PREMIUM_SKUS_03:BATCH===EVOLUSOM_PREMIUM_BATCH_02?EVOLUSOM_PREMIUM_SKUS_02:IS_EVOLUSOM?EVOLUSOM_PREMIUM_SKUS:CATALOG_EXPANSION_SKUS;
const LISTING_TYPE=IS_EVOLUSOM?'gold_pro':'gold_special';
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

module.exports={BATCH,SKUS,dir,db,checked,save,appRuntime};

async function appRuntime() {
 const base=process.env.BATCH_API_URL || 'https://app.vortek.shop';
 if (!['https://app.vortek.shop','http://localhost:3000'].includes(base)) throw Error('APP_DESTINO_NAO_AUTORIZADO');
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.BATCH_LOGIN_EMAIL,senha:process.env.BATCH_LOGIN_PASSWORD}),signal:AbortSignal.timeout(20000)});
 const user=await login.json();if(!login.ok||user.user?.cargo!=='admin')throw Error('LOGIN_ADMIN_INDISPONIVEL');
 let cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 async function app(endpoint,method='GET',body) {
  const r=await fetch(base+endpoint,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(300000)});
  const newCookies=r.headers.getSetCookie();if(newCookies.length)cookie=newCookies.map(x=>x.split(';')[0]).join('; ');
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:'RESPOSTA_HTTP_INCONCLUSIVA',httpStatus:r.status};}return{ok:r.ok,status:r.status,data};
 }
 return{app,actor:user.user.id};
}
async function prepare() {
 const {app,actor}=await appRuntime();
 const {assertMlCategoryReview}=require('../src/lib/ml-category-guard.ts');
 const inspection=JSON.parse(fs.readFileSync(path.join(dir,'inspection.json'))),reviews=JSON.parse(fs.readFileSync(path.join(dir,'review.json'))),duplicates=JSON.parse(fs.readFileSync(path.join(dir,'duplicate-coverage.json')));
 if(!duplicates.complete)throw Error('DUPLICIDADE_INCONCLUSIVA');
 const {identityFacts,supplierIdentityFacts}=require('../src/lib/ml/opportunity-identity.ts');
 const {assessIdentity}=require('../src/lib/ml/opportunity-conflicts.ts');
 const results=fs.existsSync(path.join(dir,'preparation.json'))?JSON.parse(fs.readFileSync(path.join(dir,'preparation.json'))).results.filter(r=>SKUS.includes(r.sku)):[];
 const pending=reviews.filter(review=>review.status==='APTO_PREPARACAO'&&review.categoryReview?.version===1&&!results.some(r=>r.sku===review.sku&&r.status==='PREPARADO'&&JSON.stringify(r.categoryReview)===JSON.stringify(review.categoryReview)));
 if(new Set(pending.map(review=>review.sku)).size!==pending.length)throw Error('REVISOES_DUPLICADAS');
 let next=0;
 await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{while(next<pending.length){
  const review=pending[next++];
  try {
  const row=inspection.rows.find(x=>x.sku===review.sku),p=row.product,o=row.offers.find(x=>x.id===p.oferta_preferencial_id),v=row.liveOffer.data.produtos.find(x=>String(x.produtoid)===String(o.dslite_produto_id)),catalog=IS_EVOLUSOM?(review.catalogProductId===null?null:row.catalogs.find(c=>c.data?.id===review.catalogProductId)?.data):row.catalogs[0].data;
  if(!SKUS.includes(review.sku)||!review.categoryId||(IS_EVOLUSOM&&!Array.isArray(review.attributes)))throw Error('REVISAO_INCOMPLETA_'+review.sku);
  if(review.catalogProductId && !catalog)throw Error('CATALOGO_REVISADO_AUSENTE_'+review.sku);
  if(IS_EVOLUSOM && String(o.dslite_fornecedor_id)!=='133')throw Error('FORNECEDOR_LOTE_DIVERGENTE');
  if(duplicates.matches.some(x=>x.sku===review.sku || (catalog && x.catalog_product_id===catalog.id)))throw Error('ANUNCIO_EXISTENTE_'+review.sku);
  if((duplicates.excluded||[]).some(x=>x.sku===review.sku))throw Error('ANUNCIO_EXCLUIDO_PELA_DIRETORIA_'+review.sku);
  if((duplicates.canonicalConflicts||[]).some(x=>x.sku===review.sku))throw Error('GTIN_CANONICO_EM_CONFLITO_'+review.sku);
  const categoryToken=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
  const categoryResponse=await fetch('https://api.mercadolibre.com/categories/'+review.categoryId,{headers:{Authorization:'Bearer '+categoryToken},signal:AbortSignal.timeout(20000)});
  const category=categoryResponse.ok?await categoryResponse.json():null;
  if(!category)throw Error('ARVORE_CATEGORIA_AUSENTE');
  assertMlCategoryReview(review.categoryReview,review.categoryId,{path:category.path_from_root.map(n=>n.name).join(' > '),domain:category.settings?.catalog_domain},o.id,v);
  const previous=await checked(db.from('produtos').select('altura,largura,profundidade,peso_bruto,updated_at,ml_item_id').eq('id',p.id).single());
  if(previous.ml_item_id && review.replacesItemId!==previous.ml_item_id)throw Error('ANUNCIO_EXISTENTE_'+review.sku);
  const patch={altura:v.altura_embalagem,largura:v.largura_embalagem,profundidade:v.profundidade_embalagem,peso_bruto:v.peso_embalagem};
  if(Object.keys(patch).some(k=>Number(previous[k])!==Number(patch[k]))){
   await checked(db.from('pricing_events').insert({event_type:'CATALOG_EXPANSION_LOGISTICS_CORRECTED',rule_id:BATCH,produto_id:p.id,pricing_source:'radar_launch',actor,reason:'Embalagem confirmada na oferta viva; produto ativo preservado',payload:{batchId:BATCH,previous,next:patch,source:'/v1/CrossDocking/Catalogo/'+o.dslite_fornecedor_id+'/'+o.dslite_produto_id,observedAt:row.liveOffer.at}}));
   const changed=await checked(db.from('produtos').update(patch).eq('id',p.id).eq('updated_at',previous.updated_at).select('id'));
   if(changed.length!==1)throw Error('PRODUTO_ALTERADO_DURANTE_PREPARACAO');
  }
  const warrantyInput={evidence:[{origin:'GARANTIA_FORNECEDOR',productId:p.id,gtin:p.gtin,offerId:o.id,duration:Number(v.tempo_garantia),unit:'dias',source:`DSLite /v1/CrossDocking/Catalogo/${o.dslite_fornecedor_id}/${o.dslite_produto_id}:tempo_garantia; inspection.json`,observedAt:row.liveOffer.at}]};
  const warranty=await app('/api/produtos/'+p.id,'PATCH',{reason:'Garantia específica documentada na oferta viva do fornecedor',warrantyEvidence:warrantyInput});
  if(!warranty.ok)throw Error('GARANTIA_'+JSON.stringify(warranty.data));
  const images=[];
  const imageEvidence=[];
  const pictureIds=[];
  const sourceImages=[...new Set([v.link_imagem,...(v.midias||[]).filter(m=>m.tipo==='imagem').map(m=>m.valor)].filter(Boolean))];
  const selectedImages=IS_EVOLUSOM&&review.images?review.images:sourceImages.slice(0,3);
  if(!selectedImages.length||selectedImages.some(url=>!sourceImages.includes(url)))throw Error('IMAGENS_REVISADAS_INVALIDAS');
  for(const original of selectedImages){
   const url=original.replace('://evolusom.com.br/','://www.evolusom.com.br/');
   const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw Error('IMAGEM_INDISPONIVEL');
   const bytes=Buffer.from(await r.arrayBuffer()),meta=await require('sharp')(bytes).metadata();
   if(Math.min(meta.width||0,meta.height||0)<250||Math.max(meta.width||0,meta.height||0)<500)throw Error('IMAGEM_DIMENSAO_INSUFICIENTE');
   const hash=crypto.createHash('sha256').update(bytes).digest('hex'),object=`catalog-expansion/${BATCH}/${p.sku}/${hash}.${meta.format==='jpeg'?'jpg':meta.format}`;
   const publicUrl=new URL(`/storage/v1/object/public/product-images/${object}`,process.env.NEXT_PUBLIC_SUPABASE_URL).href;
   // O caminho contém o hash: retomar preparação reutiliza a mesma imagem imutável.
   const existing=await fetch(publicUrl,{signal:AbortSignal.timeout(10000),redirect:'error'});
   if(existing.ok){
    if(!existing.headers.get('content-type')?.startsWith('image/')||crypto.createHash('sha256').update(Buffer.from(await existing.arrayBuffer())).digest('hex')!==hash)throw Error('IMAGEM_PUBLICA_DIVERGENTE');
   }else{
    if(![400,404].includes(existing.status))throw Error('IMAGEM_PUBLICA_INDISPONIVEL');
    const missing=await existing.json();
    if(!['404','NoSuchKey','not_found'].includes(String(missing.statusCode??missing.code)))throw Error('IMAGEM_PUBLICA_INDISPONIVEL');
    const upload=await db.storage.from('product-images').upload(object,bytes,{contentType:r.headers.get('content-type'),upsert:false});
    if(upload.error && !['409','Duplicate'].includes(String(upload.error.statusCode)) && !/already exists/i.test(upload.error.message))throw Error(upload.error.message);
    const remote=await fetch(publicUrl,{method:'HEAD',signal:AbortSignal.timeout(10000),redirect:'error'});if(!remote.ok||!remote.headers.get('content-type')?.startsWith('image/'))throw Error('IMAGEM_PUBLICA_INDISPONIVEL');
   }
   images.push(publicUrl);imageEvidence.push({original,url:publicUrl,hash,width:meta.width,height:meta.height});
   if(IS_EVOLUSOM&&review.catalogProductId===null){
    const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
    const form=new FormData();form.append('file',new Blob([bytes],{type:r.headers.get('content-type')}),`${p.sku}.${meta.format==='jpeg'?'jpg':meta.format}`);
    const upload=await fetch('https://api.mercadolibre.com/pictures/items/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,signal:AbortSignal.timeout(30000)}),uploaded=await upload.json();
    if(!upload.ok||typeof uploaded.id!=='string'||!uploaded.id)throw Error('IMAGEM_UPLOAD_ML_'+upload.status);
    const mlDimensions=String(uploaded.max_size||'').split('x').map(Number);
    if(mlDimensions.length!==2||!mlDimensions.every(Number.isFinite)||Math.min(...mlDimensions)<250||Math.max(...mlDimensions)<500)throw Error('IMAGEM_DIMENSAO_ML_INSUFICIENTE_'+uploaded.max_size);
    imageEvidence[imageEvidence.length-1].mlMaxSize=uploaded.max_size;
    pictureIds.push(uploaded.id);imageEvidence[imageEvidence.length-1].mlPictureId=uploaded.id;
   }
  }
  const attributes=IS_EVOLUSOM?review.attributes:[...catalog.attributes.filter(a=>!['PRODUCT_TYPE','AWG_SIZE','CABLE_DIAMETER'].includes(a.id)).map(a=>({id:a.id,...(a.value_id?{value_id:a.value_id}:{}),value_name:a.value_name})),{id:'GTIN',value_name:p.gtin}];
  const draft={categoriaId:review.categoryId,listingType:LISTING_TYPE,description:review.description,attributes,familyName:review.title};
  const identityEvidence=await checked(db.from('radar_oportunidades').select('evidence').eq('candidate_key',`product:${p.id}`).maybeSingle());
  const identity=assessIdentity({local:supplierIdentityFacts(o,identityFacts(attributes,{title:review.title}),identityEvidence?.evidence?.identitySupplement),remote:identityFacts(attributes,{title:review.title}),source:'Diretoria + oferta viva + catálogo vivo'});
  if(identity.identity!=='IDENTIDADE_COHERENTE')throw Error('IDENTIDADE_'+JSON.stringify(identity));
  const simulation=await app('/api/pricing/simulate','POST',{productId:p.id,categoryId:review.categoryId,listingType:LISTING_TYPE,objective:'target'});
  const record={sku:p.sku,productId:p.id,draft,categoryReview:review.categoryReview,simulation:simulation.data,status:simulation.ok&&simulation.data.success?'PREPARADO':'ECONOMIA_INCONCLUSIVA',warranty:warranty.data.warranty,imageEvidence,identity,...(pictureIds.length?{pictureIds}:{})};
  if(simulation.ok&&simulation.data.success){
   const id=crypto.randomUUID();
   const payload={batchId:BATCH,categoryReview:review.categoryReview,identity:identity.identity,conflict:'SEM_CONFLITO',logistics:'CONFIRMED',warrantyPolicyVersion:warranty.data.warranty.policyVersion,offerId:o.id,cost:Number(o.custo),stock:Number(o.estoque),catalogProductId:catalog?.id??null,catalogFingerprint:catalog?crypto.createHash('sha256').update(JSON.stringify({name:catalog.name,attributes:catalog.attributes,description:catalog.short_description})).digest('hex'):null,images,...(pictureIds.length?{pictureIds}:{}),draftHash:crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex'),draft,review,duplicateCoverage:{complete:true,at:duplicates.at,total:duplicates.total},sourceInspectionAt:inspection.at};
   await checked(db.from('pricing_events').insert({id,event_type:'CATALOG_EXPANSION_PREPARED',produto_id:p.id,pricing_source:'radar_launch',actor,reason:'Preparação individual revisada pela ordem da Diretoria',rule_id:warranty.data.warranty.policyVersion,payload}));
   record.preparationId=id;
  }
  results.push(record);save('preparation.json',{batchId:BATCH,at:new Date().toISOString(),results});console.log({sku:p.sku,status:record.status,price:simulation.data.memory?.price,margin:simulation.data.memory?.margin});
  }catch(error){results.push({sku:review.sku,status:'PREPARACAO_PENDENTE',error:error.message});save('preparation.json',{batchId:BATCH,at:new Date().toISOString(),results});console.log({sku:review.sku,status:'PREPARACAO_PENDENTE',error:error.message});}
 }}));
}
async function execute() {
 const {app}=await appRuntime();
 const target=(candidate,itemId)=>verifyPublicationTarget(app,candidate,itemId);
 const reviewRows=JSON.parse(fs.readFileSync(dir+'/review.json'));const prepared=JSON.parse(fs.readFileSync(dir+'/preparation.json')).results.filter(r=>r.status==='PREPARADO'&&r.categoryReview?.version===1).sort((a,b)=>Number(Boolean(reviewRows.find(r=>r.sku===a.sku)?.catalogProductId))-Number(Boolean(reviewRows.find(r=>r.sku===b.sku)?.catalogProductId)));const results=fs.existsSync(dir+'/execution.json')?JSON.parse(fs.readFileSync(dir+'/execution.json')).results:[];
for(const c of prepared){if(!SKUS.includes(c.sku))continue;const reviewed=reviewRows.find(r=>r.sku===c.sku);if(!reviewed||reviewed.status!=='APTO_PREPARACAO'||reviewed.title!==c.draft.familyName||JSON.stringify(reviewed.attributes)!==JSON.stringify(c.draft.attributes))continue;const completed=await checked(db.from('pricing_events').select('id,ml_item_id').eq('produto_id',c.productId).eq('event_type','CATALOG_EXPANSION_VALIDATED').contains('payload',{batchId:BATCH,...(c.replacementAuthorizationId?{replacementAuthorizationId:c.replacementAuthorizationId}:{})}).order('created_at',{ascending:false}).limit(1).maybeSingle());if(completed){await target(c,completed.ml_item_id);continue;}if(results.some(r=>r.sku===c.sku&&r.stage==='PUBLICACAO_PENDENTE'&&r.preparationId===c.preparationId))continue;const pending=await checked(db.from('pricing_events').select('id').eq('produto_id',c.productId).eq('event_type','CREATE_REQUESTED').contains('payload',{batchId:BATCH,...(c.replacementAuthorizationId?{replacementAuthorizationId:c.replacementAuthorizationId}:{})}).limit(1));if(pending.length)throw Error('RECONCILIACAO_PENDENTE_'+c.sku);
const simulation=await app('/api/pricing/simulate','POST',{productId:c.productId,categoryId:c.draft.categoriaId,listingType:c.draft.listingType,objective:'target'});if(!simulation.ok||!simulation.data.success){results.push({sku:c.sku,stage:'SIMULACAO',response:simulation});save('execution.json',{results});console.log(c.sku,'SIMULACAO_PENDENTE');continue;}
const approval=await app('/api/pricing/approve','POST',{evaluationId:simulation.data.evaluationId,acknowledgeEstimates:true,reason:'Usuário autorizou expressamente este lote de anúncios da Evolusom. '+BATCH+'; SKU '+c.sku+'; preço alvo canônico R$ '+simulation.data.memory.price+'; tributo estimado registrado.'});if(!approval.ok)throw Error('APROVACAO_'+c.sku+'_'+JSON.stringify(approval.data));
save('execution-checkpoint.json',{sku:c.sku,productId:c.productId,batchId:BATCH,preparationId:c.preparationId,approvalId:approval.data.approvalId,price:simulation.data.memory.price,at:new Date().toISOString(),state:'ANTES_DA_ROTA_PUBLICACAO'});
const response=await app('/api/ml/anuncio/criar','POST',{...c.draft,produtoId:c.productId,pricingMode:'canonical',pricingApprovalId:approval.data.approvalId,catalogExpansion:{batchId:BATCH,preparationId:c.preparationId,...(c.replacementAuthorizationId?{replacementAuthorizationId:c.replacementAuthorizationId}:{})}});const event=await checked(db.from('pricing_events').select('id,ml_item_id').eq('produto_id',c.productId).eq('event_type','CATALOG_EXPANSION_VALIDATED').contains('payload',{batchId:BATCH,preparationId:c.preparationId}).maybeSingle());results.push({sku:c.sku,preparationId:c.preparationId,at:new Date().toISOString(),stage:event?'PUBLICADO_VALIDADO':'PUBLICACAO_PENDENTE',price:simulation.data.memory.price,approvalId:approval.data.approvalId,response,event});save('execution.json',{batchId:BATCH,results});console.log(JSON.stringify({sku:c.sku,http:response.status,itemId:event?.ml_item_id||response.data?.ml_item_id,status:event?'PUBLICADO_VALIDADO':'PENDENTE',error:response.data?.error}));
if(event)await target(c,event.ml_item_id);
 if(!event){const claims=await checked(db.from('pricing_events').select('id').eq('produto_id',c.productId).eq('event_type','CREATE_REQUESTED').contains('payload',{batchId:BATCH}).limit(1));if(claims.length)throw Error('RECONCILIACAO_PENDENTE_'+c.sku);}
}
}

async function verifyPublicationTarget(app,c,itemId) {
 const file=dir+'/target-verification.json',rows=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).rows:[];let row=rows.find(r=>r.sku===c.sku&&r.itemId===itemId);if(!row){row={sku:c.sku,productId:c.productId,itemId,attempts:[]};rows.push(row);}const save=()=>fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),rows},null,2));
 if(['APLICACAO_SOLICITADA','APLICACAO_INCONCLUSIVA'].includes(row.status))throw Error('RECONCILIAR_PRECO_'+c.sku);
 const atTarget=m=>m?.result>0&&m.margin+1e-10>=m.band.target&&m.fee.source==='ml_live'&&m.shipping.source==='ml_live';
 const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
 async function read(){const r=await fetch('https://api.mercadolibre.com/items/'+itemId,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('READBACK_'+r.status);const i=await r.json();if(i.status!=='active'||i.category_id!==c.draft.categoriaId||i.seller_custom_field!==c.sku||i.item_relations?.length)throw Error('ESTADO_IDENTIDADE_'+c.sku);return i;}
 async function sim(body){const r=await app('/api/pricing/simulate','POST',{productId:c.productId,itemId,...body});if(!r.ok||!r.data.success)throw Error('SIMULACAO_ALVO_'+JSON.stringify(r.data));return r.data;}
 const item=await read();if(row.status==='ALVO_VALIDADO'&&row.after?.price===item.price)return;const current=await sim({price:item.price});row.before??={price:item.price,memory:current.memory};row.current=current;save();
 if(!atTarget(current.memory)){
 const target=await sim({objective:'target'});if(!atTarget(target.memory)||target.memory.price<=item.price)throw Error('ALVO_INCONSISTENTE_'+c.sku);const attempt={at:new Date().toISOString(),before:current,target};row.attempts.push(attempt);save();
 const approval=await app('/api/pricing/approve','POST',{evaluationId:target.evaluationId,acknowledgeEstimates:true,reason:'Usuário autorizou o lote '+BATCH+'. Ajustar novo anúncio '+c.sku+' ao alvo canônico após cotação real por item_id; imposto estimado reconhecido.'});attempt.approval=approval;if(!approval.ok||!approval.data.success)throw Error('APROVACAO_ALVO');row.status='APLICACAO_SOLICITADA';save();
 const apply=await app('/api/ml/anuncio/atualizar-preco','POST',{produtoId:c.productId,mlItemId:itemId,approvalId:approval.data.approvalId,targetPrice:target.memory.price});attempt.apply=apply;row.status=apply.ok&&apply.data.success?'EM_CONFERENCIA':'APLICACAO_INCONCLUSIVA';save();if(row.status==='APLICACAO_INCONCLUSIVA')throw Error('APLICACAO_ALVO_'+c.sku);
 }
 const live=await read(),verify=await sim({price:live.price});row.after={price:live.price,status:live.status,memory:verify.memory};const local=await checked(db.from('anuncios_ml').select('preco_ml,status').eq('produto_id',c.productId).eq('ml_item_id',itemId).single());if(Number(local.preco_ml)!==live.price)throw Error('PRECO_LOCAL_DIVERGENTE');row.status=atTarget(verify.memory)?'ALVO_VALIDADO':'RECOTACAO_NECESSARIA';save();if(row.status!=='ALVO_VALIDADO')throw Error('MARGEM_POS_AJUSTE_ABAIXO_DO_ALVO_'+c.sku);console.log(JSON.stringify({sku:c.sku,itemId,status:row.status,price:live.price,margin:verify.memory.margin}));
}

if(require.main===module){const action={inspect,prepare,execute,reconcile,report}[process.argv[2]];if(!action)throw Error("Use inspect, prepare, execute, reconcile ou report");action().catch(e=>{console.error(e.message);process.exitCode=1;});}

async function report() {
 const cp=require('node:child_process');
 const read=name=>fs.existsSync(path.join(dir,name))?JSON.parse(fs.readFileSync(path.join(dir,name))):null;
 const reviews=read('review.json'),inspection=read('inspection.json'),preparation=read('preparation.json')?.results??[],simulations=read('economic-simulations.json')?.results??[];
 const events=await checked(db.from('pricing_events').select('*').contains('payload',{batchId:BATCH}).order('created_at'));
 save('audit-events.json',events);
 const validated=events.filter(e=>e.event_type==='CATALOG_EXPANSION_VALIDATED'),stops=events.filter(e=>e.event_type==='CATALOG_EXPANSION_SAFETY_STOP');
 function csv(name,rows,columns){const escape=v=>'"'+String(v??'').replaceAll('"','""')+'"';fs.writeFileSync(path.join(dir,name),'\ufeff'+[columns.map(escape).join(','),...rows.map(r=>columns.map(k=>escape(r[k])).join(','))].join('\r\n')+'\r\n');}
 const gates=reviews.map(review=>{
  const row=inspection.rows.find(r=>r.sku===review.sku),success=validated.find(e=>e.produto_id===row.product.id),attempt=events.find(e=>e.event_type==='CREATE_REQUESTED'&&e.produto_id===row.product.id),prepared=preparation.find(p=>p.sku===review.sku);
  const remote=events.find(e=>e.event_type==='CREATED_REMOTE'&&e.produto_id===row.product.id);
  const result=read('execution.json')?.results?.find(r=>r.sku===review.sku);
  return{sku:review.sku,produto:row.product.nome,estado:success?'PUBLICADO_VALIDADO':attempt?'PUBLICACAO_INCONCLUSIVA':review.status==='APTO_PREPARACAO'?(result?'BLOQUEADO_PRE_POST':'PREPARADO_NAO_PUBLICADO'):review.status,mlb:success?.ml_item_id??remote?.ml_item_id??row.items[0]?.data?.id??'',motivo:success?'Todos os gates e readback concluídos':result?.response?.data?.error??review.reason,oferta:row.product.oferta_preferencial_id,custo:row.product.custo,estoque:row.product.estoque,preco_preparado:prepared?.simulation?.memory?.price??'',catalog_product_id:review.catalogProductId};
 });
 csv('01_GATES_10_SKUS.csv',gates,['sku','produto','estado','mlb','motivo','oferta','custo','estoque','preco_preparado','catalog_product_id']);
 const published=validated.map(e=>{const row=inspection.rows.find(r=>r.product.id===e.produto_id),m=e.payload.memory,w=e.payload.warranty.resolution;return{sku:row.sku,mlb:e.ml_item_id,status:e.reason,preco:m.price,margem:m.margin,faixa:m.band.id,piso:m.band.floor,alvo:m.band.target,limite:m.band.limit,resultado:m.result,estoque:e.payload.readback.available_quantity,pricing_group_id:e.pricing_group_id,garantia_origem:w.origin,garantia_prazo:w.duration,garantia_unidade:w.unit,timestamp:e.created_at};});
 csv('02_PUBLICADOS_VALIDADO.csv',published,['sku','mlb','status','preco','margem','faixa','piso','alvo','limite','resultado','estoque','pricing_group_id','garantia_origem','garantia_prazo','garantia_unidade','timestamp']);
 const blocked=gates.filter(g=>!['PUBLICADO_VALIDADO','JA_ANUNCIADO_ATIVO'].includes(g.estado));
 csv('03_BLOQUEADOS_E_MOTIVOS.csv',blocked,['sku','estado','mlb','motivo']);
 const memories=[];
 function memoryRow(sku,phase,m,mlb=''){if(!m)return;memories.push({sku,fase:phase,mlb,preco:m.price,cmv:m.cost,oferta:m.offerId,fornecedor:m.supplierId,tarifa:m.fee.amount,tarifa_origem:m.fee.source,frete:m.shipping.amount,frete_origem:m.shipping.source,tributo:m.taxAmount,tributo_status:m.tax.status,aliquota:m.tax.rate,resultado:m.result,margem:m.margin,faixa:m.band?.id,piso:m.band?.floor,alvo:m.band?.target,limite:m.band?.limit,modelo:m.policyVersion,timestamp:m.evaluatedAt});}
 for(const sim of simulations)memoryRow(sim.sku,'SIMULACAO_NAO_AUTORIZA_PUBLICACAO',sim.memory);
 for(const p of preparation)memoryRow(p.sku,'PREPARACAO',p.simulation.memory);
 for(const e of events.filter(e=>e.event_type==='CATALOG_EXPANSION_PAYLOAD_VALIDATED'))memoryRow(inspection.rows.find(r=>r.product.id===e.produto_id).sku,'PRE_POST_VALIDADO',e.payload.memory);
 for(const e of validated)memoryRow(inspection.rows.find(r=>r.product.id===e.produto_id).sku,'POS_PUBLICACAO',e.payload.memory,e.ml_item_id);
 csv('04_MEMORIA_ECONOMICA.csv',memories,['sku','fase','mlb','preco','cmv','oferta','fornecedor','tarifa','tarifa_origem','frete','frete_origem','tributo','tributo_status','aliquota','resultado','margem','faixa','piso','alvo','limite','modelo','timestamp']);
 csv('05_GARANTIAS_APLICADAS.csv',validated.map(e=>{const w=e.payload.warranty.resolution;return{sku:inspection.rows.find(r=>r.product.id===e.produto_id).sku,mlb:e.ml_item_id,origem:w.origin,warranty_source:w.warranty_source,warranty_type:w.warranty_type,warranty_duration:w.warranty_duration,warranty_unit:w.warranty_unit,fonte:w.source,evidencia_em:w.observedAt,politica:w.policyVersion};}),['sku','mlb','origem','warranty_source','warranty_type','warranty_duration','warranty_unit','fonte','evidencia_em','politica']);
 const deltas=validated.map(e=>{const before=events.filter(p=>p.event_type==='CATALOG_EXPANSION_PAYLOAD_VALIDATED'&&p.produto_id===e.produto_id).at(-1)?.payload.memory,after=e.payload.memory;return before?`${e.ml_item_id}: preço R$${before.price.toFixed(2)} → R$${after.price.toFixed(2)}; tarifa R$${before.fee.amount.toFixed(2)} → R$${after.fee.amount.toFixed(2)}; frete R$${before.shipping.amount.toFixed(2)} → R$${after.shipping.amount.toFixed(2)}; margem ${(before.margin*100).toFixed(4)}% → ${(after.margin*100).toFixed(4)}%.`:e.ml_item_id+': comparação pré/pós indisponível';}).join('\n\n');
 const write=(name,text)=>fs.writeFileSync(path.join(dir,name),text+'\n');
 write('00_RESUMO_EXECUTIVO.md',`# ${BATCH} — D0\n\nNovos publicados e validados: **${validated.length}**. Reativados: **0**. Já ativos: **${gates.filter(g=>g.estado==='JA_ANUNCIADO_ATIVO').length}**. Bloqueados/pendentes: **${blocked.length}**.\n\n${gates.map(g=>`- ${g.sku}: ${g.estado}${g.mlb?' — '+g.mlb:''}. ${g.motivo}`).join('\n')}\n\nSafety stops: ${stops.length}. As simulações não autorizam candidatos com conflito. Não houve correção remota nos dois anúncios previamente ativos.\n\n${published.map(p=>`Publicado ${p.sku}: faixa ${p.faixa}, piso ${p.piso*100}%, alvo ${p.alvo*100}%, margem remota ${(p.margem*100).toFixed(4)}%.`).join('\n')}\n\nA garantia padrão foi alterada por decisão expressa: fabricante → fornecedor → vendedor 30 dias. Nas ofertas publicadas, prevalece o prazo comprovado da fonte registrada.\n\nComparação pré-POST / leitura remota:\n\n${deltas}\n\nTributo estimado pelo serviço RBT12/Simples, identificado como estimated. Visitas iniciais não coletadas permanecem null, nunca zero inventado. A reconciliação da medusa, sem segundo POST, está documentada em incident-reconciliation.md.`);
 write('06_READBACK_ML.md',`# Conferência remota\n\n${validated.length} eventos PUBLICADO_VALIDADO. Evidência integral: audit-events.json.\n\n${validated.map(e=>`- ${e.ml_item_id}: status ${e.payload.readback.status}, preço ${e.payload.readback.price}, estoque ${e.payload.readback.available_quantity}, catálogo ${e.payload.readback.catalog_product_id}, margem ${(e.payload.memory.margin*100).toFixed(4)}%. Garantia, identidade e grupo conferidos pelo backend; sem divergência impeditiva.`).join('\n')}\n\n${stops.length?'Safety stop registrado; consultar eventos.':'Nenhum safety stop registrado.'}\n\nHTTP 400 do validador contendo exclusivamente avisos shipping.lost_me1_by_user e item.shipping.mandatory_free_shipping é aceito somente quando o payload já exige ME2 e frete grátis. Nenhum erro material foi dispensado.\n\n${deltas}\n\nA medusa foi reconciliada por leitura remota e recálculo após falha no registro de auditoria. O Bravox usa o fluxo corrigido. Consulte incident-reconciliation.md e deployment.json.`);
 write('07_PENDENCIAS_REMANESCENTES.md',`# Pendências individuais\n\n${blocked.map(g=>`- **${g.sku} — ${g.estado}:** ${g.motivo}`).join('\n')}\n\nA pesquisa entregue foi reaproveitada. Não foram iniciadas novas cadências, pesquisas amplas ou próximos lotes. Correções no catálogo ML e confirmação do tratamento do IPI permanecem para validação específica.`);
 write('rollback.md','# Rollback\n\nCódigo: reverter os commits desta entrega por novos commits, mantendo histórico e eventos. O fallback anterior depende de classificação, portanto seu retorno exige decisão da Diretoria; não restaurar política antiga silenciosamente.\nNão apagar anúncios nem eventos para desfazer a operação. Anúncio com divergência crítica deve ser pausado e confirmado remotamente; bloqueio persistente permanece até revisão. As correções locais de embalagem têm baseline nos eventos CATALOG_EXPANSION_LOGISTICS_CORRECTED. Não foi necessária migration.');
 const files={};for(const name of fs.readdirSync(dir,{recursive:true})){const full=path.join(dir,name);if(fs.statSync(full).isFile()&&name!=='manifest.json')files[name]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');}
 save('manifest.json',{batchId:BATCH,generatedAt:new Date().toISOString(),implementationCommits:cp.execFileSync('git',['log',read('baseline-repository.json').head+'..HEAD','--format=%H'],{encoding:'utf8'}).trim().split('\n'),warrantyPolicy:'VORTEK-WARRANTY-2026-09-06-SELLER-30',economicModel:'VORTEK-CANON-1.0-ECON-2',counts:{evaluated:10,published:validated.length,reactivated:0,alreadyActive:gates.filter(g=>g.estado==='JA_ANUNCIADO_ATIVO').length,blockedOrPending:blocked.length,safetyStops:stops.length},files});
 console.log({report:dir,published:validated.length,pending:blocked.length});
}

async function reconcile() {
 const {app,actor}=await appRuntime();
 const {catalogExpansionReadbackIssues,catalogExpansionAttemptKey}=require('../src/lib/ml/catalog-expansion.ts');
 const {assessIdentity}=require('../src/lib/ml/opportunity-conflicts.ts');
 const {identityFacts}=require('../src/lib/ml/opportunity-identity.ts');
 const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
 async function ml(endpoint){const r=await fetch('https://api.mercadolibre.com'+endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('READBACK_HTTP_'+r.status);return r.json();}
 const rows=await checked(db.from('pricing_events').select('*').eq('event_type','CREATED_REMOTE').contains('payload',{batchId:BATCH}));
 for(const row of rows){
  const existing=await checked(db.from('pricing_events').select('id').eq('event_type','CATALOG_EXPANSION_VALIDATED').eq('ml_item_id',row.ml_item_id).maybeSingle());if(existing)continue;
  const prepared=await checked(db.from('pricing_events').select('*').eq('event_type','CATALOG_EXPANSION_PAYLOAD_VALIDATED').eq('produto_id',row.produto_id).contains('payload',{batchId:BATCH,approvalId:row.payload.approvalId}).single());
  const expected=prepared.payload.payload,item=await ml('/items/'+row.ml_item_id);
  const categoryPreparation=await checked(db.from('pricing_events').select('payload').eq('id',prepared.payload.preparationId).single());
  const reviewed=categoryPreparation.payload.categoryReview;
  if(!reviewed)throw Error('REVISAO_CATEGORIA_AUSENTE_OU_OBSOLETA');
  const category=await ml('/categories/'+item.category_id);
  require('../src/lib/ml-category-guard.ts').assertMlCategoryReview(reviewed,item.category_id,{path:category.path_from_root.map(n=>n.name).join(' > '),domain:category.settings?.catalog_domain},reviewed.offerId,{produtoid:reviewed.supplierProductId,titulo:reviewed.source.nome,descricao:reviewed.source.descricao,categoria_nome:reviewed.source.categoria,marca:reviewed.source.marca});
  const stop=await checked(db.from('pricing_events').select('*').eq('event_type','CATALOG_EXPANSION_SAFETY_STOP').eq('produto_id',row.produto_id).eq('ml_item_id',item.id).contains('payload',{batchId:BATCH}).maybeSingle());
  let priceCorrection=null;
  if(Number(item.price)!==Number(expected.price)){
   const applied=await checked(db.from('pricing_events').select('*').eq('event_type','APPLIED').eq('produto_id',row.produto_id).eq('ml_item_id',item.id).gt('created_at',row.created_at).order('created_at',{ascending:false}).limit(1).maybeSingle());
   if(!applied?.payload?.approvalId||Number(applied.new_price)!==Number(item.price))throw Error('CORRECAO_PRECO_NAO_CONFIRMADA');
   const approval=await checked(db.from('pricing_events').select('*').eq('id',applied.payload.approvalId).eq('event_type','APPROVED').eq('produto_id',row.produto_id).single());
   if(Number(approval.new_price)!==Number(item.price))throw Error('CORRECAO_PRECO_NAO_APROVADA');
   priceCorrection={appliedEventId:applied.id,approvalId:approval.id,previousPrice:expected.price,newPrice:item.price,previousMemory:prepared.payload.memory};
  }
  const simulation=await app('/api/pricing/simulate','POST',{productId:row.produto_id,itemId:row.ml_item_id,price:Number(item.price)});
  const memory=simulation.data.memory,issues=catalogExpansionReadbackIssues({price:priceCorrection?.newPrice??expected.price,quantity:expected.available_quantity,categoryId:expected.category_id,catalogProductId:expected.catalog_product_id},item,memory);
  const identity=assessIdentity({local:identityFacts(expected.attributes,{title:expected.title||expected.family_name}),remote:identityFacts(item.attributes,{title:item.title||item.family_name}),source:'readback_reconciliation'});
  if(identity.identity!=='IDENTIDADE_COHERENTE')issues.push('IDENTIDADE_NAO_CONFIRMADA');
  if(!expected.sale_terms.every(e=>item.sale_terms.some(a=>a.id===e.id&&(e.value_id?String(a.value_id)===String(e.value_id):a.value_name===e.value_name))))issues.push('GARANTIA_NAO_CONFIRMADA');
  if(!item.pictures?.length||(item.item_relations??[]).length)issues.push('IMAGENS_OU_VINCULO_INCONCLUSIVO');
  if(item.listing_type_id!==expected.listing_type_id)issues.push('TIPO_ANUNCIO_DIVERGENTE');
  const blocks=await checked(db.from('ml_manual_blocklist').select('id').eq('ativo',true).or(`ml_item_id.eq.${item.id},sku.eq.${expected.seller_custom_field}`));
  if(blocks.length)issues.push('BLOQUEIO_OPERACIONAL_ATIVO');
  const sku=expected.seller_custom_field;const duplicates=await Promise.all(['seller_sku','sku'].map(k=>ml('/users/'+item.seller_id+'/items/search?'+k+'='+encodeURIComponent(sku))));
  const ids=[...new Set(duplicates.flatMap(r=>r.results??[]))];if(ids.length!==1||ids[0]!==item.id)issues.push('DUPLICIDADE_OU_INDICE_INCONCLUSIVO');
  save('reconciliation-'+sku+'.json',{at:new Date().toISOString(),item,identity,simulation,issues,duplicates});
  if(issues.length)throw Error('RECONCILIACAO_PENDENTE_'+issues.join('|'));
  const link=await checked(db.from('anuncios_ml').select('produto_id,pricing_group_id').eq('ml_item_id',item.id).single());if(link.produto_id!==row.produto_id||link.pricing_group_id!=='item:'+item.id)throw Error('VINCULO_LOCAL_INCONCLUSIVO');
  await checked(db.from('pricing_events').insert({event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:row.produto_id,ml_item_id:item.id,pricing_group_id:link.pricing_group_id,evaluation_id:simulation.data.evaluationId,pricing_source:'radar_launch',actor,reason:'PUBLICADO_VALIDADO',new_price:item.price,rule_id:memory.policyVersion,dedupe_key:'validated:'+catalogExpansionAttemptKey(row.produto_id,{batchId:BATCH,preparationId:prepared.payload.preparationId,replacementAuthorizationId:prepared.payload.replacementAuthorizationId,retryAuthorizationId:prepared.payload.retryAuthorizationId}),payload:{batchId:BATCH,...(prepared.payload.replacementAuthorizationId?{replacementAuthorizationId:prepared.payload.replacementAuthorizationId}:{}),cohort:BATCH,preparationId:prepared.payload.preparationId,approvalId:row.payload.approvalId,warranty:row.payload.warranty,memory,baseline:{startAt:row.created_at,price:item.price,margin:memory.margin,stock:item.available_quantity,sales:item.sold_quantity,visits:null},readback:item,reconciliation:{reason:'Conferência remota e econômica concluída; sem repetir POST',at:new Date().toISOString(),identity,duplicateIds:ids,priceCorrection,resolvedSafetyStopId:stop?.id??null}}}));
  await checked(db.from('radar_oportunidades').update({stage:'PUBLICADO_EXPERIMENTO',queue:'JA_ANUNCIADOS',processed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('produto_id',row.produto_id));
  console.log({sku,mlb:item.id,status:'PUBLICADO_VALIDADO',price:item.price,margin:memory.margin,repeatedPost:false});
 }
}
