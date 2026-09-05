#!/usr/bin/env node
/** Operação limitada à coorte expressamente autorizada; sem fórmula econômica própria. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { identityFacts, supplierIdentityFacts } = require('../src/lib/ml/opportunity-identity.ts');
const { assessIdentity, assessOpportunityConflicts } = require('../src/lib/ml/opportunity-conflicts.ts');
const COHORT = 'RADAR_LAUNCH_2026_09_COHORT_01';
const DIR = path.resolve('reports', COHORT, 'execution');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (name, data) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, name), JSON.stringify(data, null, 2)+'\n'); };
const now = () => new Date().toISOString();
async function checked(p) { const r = await p; if (r.error) throw Error(r.error.message); return r.data; }
function loadPricing(fetchMLResult) {
 const filename=path.resolve('src/services/pricing-context.ts'),mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:id=>id==='./integration'?{fetchMLResult}:require(id.startsWith('.')?path.resolve(path.dirname(filename),id):id),URLSearchParams,Date,Intl,Map,Set});
 return mod.exports;
}
async function runtime() {
 require('dotenv').config({path:'.env.local',quiet:true});
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
 const account=await assertAllowedMercadoLivreToken(token,'radar_launch');
 const requests=[];
 async function ml(endpoint,method='GET',body) {
  const start=now();const response=await fetch('https://api.mercadolibre.com'+endpoint,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>null);requests.push({endpoint,method,status:response.status,at:start});
  return {ok:response.ok,status:response.status,data,error:response.ok?null:data};
 }
 const pricing=loadPricing(endpoint=>ml(endpoint));
 return {db,ml,pricing,account,requests};
}
async function prepare() {
 const rt=await runtime();const {db,ml,pricing}=rt;
 const input=read('reports/m2m-identity-correction-2026-09-05/reclassification_applied.json');
 const candidates=input.filter(r=>r.conflict_state==='SEM_CONFLITO').sort((a,b)=>(a.assessment.economy!=='VIAVEL_NO_ALVO')-(b.assessment.economy!=='VIAVEL_NO_ALVO')||(b.contribution??0)-(a.contribution??0)||a.demand_rank-b.demand_rank||b.stock-a.stock);
 const outputs=[];
 for(const row of candidates) {
  const resolved=await pricing.resolvePricingProduct(db,row.produto_id);
  const catalogResponse=await ml('/products/'+row.catalog_product_id);
  const prediction=await ml('/sites/MLB/domain_discovery/search?limit=3&q='+encodeURIComponent(resolved.offer.nome));
  const catalog=catalogResponse.data;
  const matching=prediction.ok&&prediction.data.find(p=>p.domain_id===catalog?.domain_id);
  if(!catalogResponse.ok||!matching){outputs.push({sku:row.sku,error:'CATEGORIA_CATALOGO_REQUER_VALIDACAO',catalog,prediction,product:resolved.product,offer:resolved.offer});continue;}
  const categoryId=matching.category_id;
  const responses=await Promise.all([ml('/categories/'+categoryId),ml('/categories/'+categoryId+'/attributes'),ml('/categories/'+categoryId+'/sale_terms')]);
  if(responses.some(r=>!r.ok)){outputs.push({sku:row.sku,error:'FONTE_ML_INDISPONIVEL',responses});continue;}
  const [category,attributes,saleTerms]=responses.map(r=>r.data);
  const identity={local:supplierIdentityFacts(resolved.offer,identityFacts(catalog.attributes,{title:catalog.name}),row.evidence.identitySupplement),remote:identityFacts(catalog.attributes,{title:catalog.name}),source:'/products/'+catalog.id};
  outputs.push({sku:row.sku,prediction:prediction.data,product:resolved.product,offer:resolved.offer,radar:row,catalog,category,attributes,saleTerms,identity,assessment:assessIdentity(identity),observedAt:now()});
  console.log(JSON.stringify({prepared:outputs.length,total:candidates.length,sku:row.sku,identity:outputs.at(-1).assessment?.identity}));
 }
 save('preparation.json',{cohort:COHORT,at:now(),authorization:{maximum:10,warranty:'12 meses pelo fabricante',source:'Diretoria: confirmação explícita nesta conversa',publish:true},requests:rt.requests,candidates:outputs});
}

async function supplierLive(db, offer) {
 const integration=await checked(db.from('integracoes').select('url,access_token').eq('tipo','dslite').single());
 const url=integration.url.replace(/\/+$/,'')+'/v1/CrossDocking/Catalogo/'+offer.dslite_fornecedor_id+'/'+offer.dslite_produto_id;
 const response=await fetch(url,{headers:{Token:integration.access_token},signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 const product=data.produtos?.find(p=>String(p.produtoid)===String(offer.dslite_produto_id));
 if(!response.ok||!product)throw Error('OFERTA_VIVA_INDISPONIVEL');
 return {url,observedAt:now(),product};
}
function assertSupplier(c, live) {
 const p=live.product;
 const cost=Number(p.preco_promocional)>0?Number(p.preco_promocional):Number(p.preco_crossdocking);
 if(p.status_fornecedor!=='A'||p.status_empresa!=='A'||!c.product.ativo||!c.offer.ativo||!(Number(p.estoque)>0))throw Error('OFERTA_INATIVA_OU_SEM_ESTOQUE');
 if(String(p.ean11).replace(/^0+/,'')!==String(c.offer.gtin).replace(/^0+/,''))throw Error('GTIN_FORNECEDOR_ALTERADO');
 if(Math.abs(cost-Number(c.offer.custo))>=.01)throw Error('CUSTO_FORNECEDOR_ALTERADO');
 if(Number(p.qtde_minima)>2)throw Error('QUANTIDADE_MINIMA_FORNECEDOR');
}
async function images(db,c) {
 const sharp=require('sharp');const output=[];
 for(const original of (c.offer.imagens||c.product.imagens||[]).slice(0,3)) {
  const url=new URL(original);if(url.hostname==='evolusom.com.br')url.hostname='www.evolusom.com.br';
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw Error('IMAGEM_ORIGEM_INVALIDA');
  const bytes=Buffer.from(await r.arrayBuffer()),meta=await sharp(bytes).metadata();
  if(Math.min(meta.width||0,meta.height||0)<250||Math.max(meta.width||0,meta.height||0)<=500)throw Error('IMAGEM_DIMENSOES_INSUFICIENTES');
  const object=`radar-launch/${COHORT}/${c.sku}/${crypto.createHash('sha256').update(bytes).digest('hex')}.${meta.format==='jpeg'?'jpg':meta.format}`;
  const upload=await db.storage.from('product-images').upload(object,bytes,{contentType:r.headers.get('content-type'),upsert:false});
  if(upload.error&&!/already exists|duplicate/i.test(upload.error.message))throw Error(upload.error.message);
  const publicUrl=db.storage.from('product-images').getPublicUrl(object).data.publicUrl;
  const check=await fetch(publicUrl,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(check.status!==200||!check.headers.get('content-type')?.startsWith('image/'))throw Error('IMAGEM_PUBLICA_INVALIDA');
  output.push({original,resolved:r.url,url:publicUrl,width:meta.width,height:meta.height,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 if(!output.length)throw Error('SEM_IMAGEM');return output;
}
function buildPayload(c,selection,price,pictures,quantity) {
 const attrs=new Map(c.catalog.attributes.filter(a=>c.attributes.some(s=>s.id===a.id)).map(a=>[a.id,{id:a.id,...(a.value_id?{value_id:a.value_id}:{}),...(a.value_name?{value_name:a.value_name}:{}),...(a.values?.length>1?{values:a.values.map(v=>({id:v.id,name:v.name}))}:{})}]));
 for(const [id,value] of Object.entries(selection.extra||{}))attrs.set(id,{id,...value});
 attrs.set('GTIN',{id:'GTIN',value_name:c.offer.gtin});attrs.set('SELLER_SKU',{id:'SELLER_SKU',value_name:c.sku});attrs.set('ITEM_CONDITION',{id:'ITEM_CONDITION',value_id:'2230284',value_name:'Novo'});
 for(const a of c.attributes)if(!attrs.has(a.id)&&!a.tags?.hidden&&!a.tags?.fixed){
  if(a.tags?.required||a.tags?.catalog_listing_required)throw Error('ATRIBUTO_OBRIGATORIO_AUSENTE:'+a.id);
  if(!a.tags?.conditional_required)attrs.set(a.id,{id:a.id,value_id:'-1',value_name:null});
 }
 return {family_name:selection.title,category_id:c.category.id,catalog_product_id:c.catalog.id,catalog_listing:true,price,currency_id:'BRL',available_quantity:quantity,buying_mode:'buy_it_now',listing_type_id:'gold_special',condition:'new',pictures:pictures.map(p=>({source:p.url})),attributes:[...attrs.values()],seller_custom_field:c.sku,sale_terms:[{id:'WARRANTY_TYPE',value_id:'2230279',value_name:'Garantia de fábrica'},{id:'WARRANTY_TIME',value_name:'12 meses'}],shipping:{mode:'me2',local_pick_up:false,free_shipping:true}};
}
async function build() {
 const rt=await runtime(),{db,ml,pricing}=rt;const prep=read(path.join(DIR,'preparation.json'));const selection=read(path.join(DIR,'selection.json'));const approved=[];const excluded=[];
 for(const [sku,config] of Object.entries(selection.candidates)) {
  try {
   const c=prep.candidates.find(c=>c.sku===sku);if(c.error||c.assessment.identity!=='IDENTIDADE_COHERENTE')throw Error(c.error||'IDENTIDADE_INCONCLUSIVA');
   const resolved=await pricing.resolvePricingProduct(db,c.product.id);c.product=resolved.product;c.offer=resolved.offer;
   const supplier=await supplierLive(db,c.offer);assertSupplier(c,supplier);
   const pictureProof=await images(db,c);
   const context=await pricing.resolveNewListingQuoteContext(c.product,c.category.id,'gold_special');if(!context)throw Error('CONTEXTO_FRETE_INCONCLUSIVO');
   const d=supplier.product;context.dimensions=[d.altura_embalagem,d.largura_embalagem,d.profundidade_embalagem].map(v=>Math.ceil(Number(v))).join('x')+','+Math.ceil(Number(d.peso_embalagem)*1000);
   const quote=await pricing.evaluateProductPricing(db,{productId:c.product.id,price:c.radar.evidence.competitivePrice,context,objective:'target',requireLive:true});
   if(!quote.memory||quote.memory.margin<quote.memory.band.floor)throw Error('ECONOMIA_INCONCLUSIVA_OU_ABAIXO_PISO');
   const quantity=Math.min(2,Number(c.offer.estoque),Number(d.estoque));
   const payload=buildPayload(c,config,quote.memory.price,pictureProof,quantity);
   const description=[config.title,'',...config.facts.map(f=>'• '+f),'','DIMENSÕES DA EMBALAGEM',`${d.profundidade_embalagem} × ${d.largura_embalagem} × ${d.altura_embalagem} cm; peso bruto ${d.peso_embalagem} kg.`,'','Garantia de fábrica: 12 meses.','SKU: '+sku].join('\n');
   const conditional=await ml('/categories/'+c.category.id+'/attributes/conditional','POST',payload);
   if(!conditional.ok)throw Error('VALIDACAO_CONDICIONAL_INDISPONIVEL');
   const missing=(conditional.data.required_attributes||[]).filter(a=>!payload.attributes.some(p=>p.id===a.id&&p.value_id!=='-1'));
   if(missing.length)throw Error('ATRIBUTOS_CONDICIONAIS:'+missing.map(a=>a.id).join(','));
   const validated=await ml('/items/validate','POST',payload);
   save(sku+'-preflight.json',{c,supplier,pictureProof,context,memory:quote.memory,payload,description,conditional,validated,at:now()});
   if(!payloadValidated(validated,payload)){excluded.push({sku,reason:'PAYLOAD_INVALIDO',details:validated});continue;}
   approved.push({sku,productId:c.product.id,price:payload.price,quantity});console.log(JSON.stringify({sku,status:'PAYLOAD_VALIDADO',price:payload.price,quantity}));
  }catch(e){excluded.push({sku,reason:e.message});console.log(JSON.stringify({sku,status:'PENDENTE',reason:e.message}));}
 }
 save('gate_results.json',{cohort:COHORT,at:now(),approved,excluded,requests:rt.requests});
}

function payloadValidated(response,payload) {
 const causes=response.data?.cause??[];
 if(causes.some(c=>c.type!=='warning'))return false;
 if(response.ok)return true;
 return response.status===400&&response.data?.error==='validation_error'&&causes.length>0&&payload.shipping?.mode==='me2'&&payload.shipping?.free_shipping===true&&causes.every(c=>['shipping.lost_me1_by_user','item.shipping.mandatory_free_shipping'].includes(c.code));
}
function readbackChecks(payload,item,sellerId) {
 const remote=identityFacts(item.attributes??[],{title:item.title??item.family_name});
 const identity=assessIdentity({local:identityFacts(payload.attributes,{title:payload.family_name}),remote,source:'payload_vs_remote'});
 const get=(attrs,id)=>attrs.find(a=>a.id===id)?.value_name;
 const normalizeGtin=v=>String(v??'').replace(/\D/g,'').replace(/^0+/,'');
 const attributesConfirmed=payload.attributes.filter(a=>a.value_id!=='-1'&&!['BRAND','MODEL','GTIN','SELLER_SKU'].includes(a.id)).every(a=>{const r=item.attributes?.find(r=>r.id===a.id);if(!r)return false;if(a.values?.length>1){const key=v=>v.id?'id:'+v.id:'name:'+String(v.name??'').trim().toLowerCase();return JSON.stringify(a.values.map(key).sort())===JSON.stringify((r.values??[]).map(key).sort());}if(a.value_id&&r.value_id)return a.value_id===r.value_id;return String(a.value_name??'').trim().toLowerCase()===String(r.value_name??'').trim().toLowerCase();});
 const checks={attributesConfirmed,seller:String(item.seller_id)===String(sellerId),sku:(item.seller_custom_field||get(item.attributes,'SELLER_SKU'))===payload.seller_custom_field,gtin:normalizeGtin(get(item.attributes,'GTIN'))===normalizeGtin(get(payload.attributes,'GTIN')),price:Number(item.price)===payload.price,stock:Number(item.available_quantity)===payload.available_quantity,category:item.category_id===payload.category_id,catalog:item.catalog_product_id===payload.catalog_product_id&&item.catalog_listing===true,identity:identity.identity==='IDENTIDADE_COHERENTE',condition:item.condition==='new',modality:item.listing_type_id===payload.listing_type_id,shipping:item.shipping?.mode==='me2',noUnexpectedPair:!(item.item_relations??[]).length};
 return {checks,identity,ok:Object.values(checks).every(Boolean)};
}
function assertCohortSize(rows) { if(rows.length>10||new Set(rows.map(r=>r.sku)).size!==rows.length)throw Error('COHORT_LIMIT_OR_DUPLICATE'); }
async function freshDuplicates(rt,c,inventory) {
 const local=await checked(rt.db.from('anuncios_ml').select('ml_item_id,status,produto_id').or(`produto_id.eq.${c.product.id},sku.eq.${c.sku}`));
 const product=await checked(rt.db.from('produtos').select('ml_item_id,ml_status').eq('id',c.product.id).single());
 const ids=new Set(local.map(r=>r.ml_item_id).filter(Boolean));if(product.ml_item_id)ids.add(product.ml_item_id);
 const attr=(i,id)=>i.attributes?.find(a=>a.id===id)?.value_name;
 const normalized=v=>String(v??'').replace(/^0+/,'');
 for(const i of inventory.items)if(i.seller_custom_field===c.sku||attr(i,'SELLER_SKU')===c.sku||i.catalog_product_id===c.catalog.id||(attr(i,'GTIN')&&normalized(attr(i,'GTIN'))===normalized(c.offer.gtin)))ids.add(i.id);
 for(const [key,value] of [['seller_sku',c.sku],['q',c.catalog.name]]) {
  const r=await rt.ml(`/users/${rt.account.userId}/items/search?limit=100&${key}=${encodeURIComponent(value)}`);
  if(!r.ok||Number(r.data.paging?.total)>100)throw Error('BUSCA_VINCULO_INCONCLUSIVA');
  for(const id of r.data.results??[])ids.add(id);
 }
 const matches=[];
 for(const id of ids){const r=await rt.ml('/items/'+id);if(!r.ok)throw Error('VINCULO_INCONCLUSIVO');const i=r.data;if(i.seller_custom_field===c.sku||attr(i,'SELLER_SKU')===c.sku||i.catalog_product_id===c.catalog.id||(attr(i,'GTIN')&&normalized(attr(i,'GTIN'))===normalized(c.offer.gtin)))matches.push(i);}
 return matches;
}
function catalogDescriptionMatches(catalog, response) {
 const expected=catalog.short_description?.content??'';
 return response.ok ? (response.data?.plain_text??'')===expected : response.status===404;
}
async function publish() {
 const rt=await runtime(),{db,ml,pricing}=rt;
 const closed=await checked(db.from('pricing_events').select('job_id').eq('dedupe_key',`${COHORT}:closed`).maybeSingle());if(closed){console.log(JSON.stringify({status:'COHORT_ALREADY_FINISHED',jobId:closed.job_id}));return;}
 // Reclassificação de warnings documentados não refaz as cotações; haverá recotação antes do POST.
 const rows=Object.keys(read(path.join(DIR,'selection.json')).candidates).filter(sku=>fs.existsSync(path.join(DIR,sku+'-preflight.json'))).map(sku=>({sku,...read(path.join(DIR,sku+'-preflight.json'))})).filter(r=>payloadValidated(r.validated,r.payload));
 assertCohortSize(rows);
 const inventory=read(path.join(DIR,'account_before_publish.json'));
 if(!inventory.complete||inventory.read!==inventory.expected||Date.now()-Date.parse(inventory.at)>15*60000)throw Error('ATUALIZAR_FOTOGRAFIA_CONTA');
 let job=await checked(db.from('jobs').select('id,status,log').eq('dedupe_key',COHORT).maybeSingle());
 if(job?.status==='completo'){const done=await checked(db.from('pricing_events').select('id').eq('job_id',job.id).eq('event_type','RADAR_LAUNCH_VALIDATED'));if(done.length===rows.length){console.log(JSON.stringify({status:'COHORT_ALREADY_FINISHED',jobId:job.id}));return;}}
 if(!job)job=await checked(db.from('jobs').insert({tipo:'sync_ml_listings_publish',status:'rodando',dedupe_key:COHORT,total:rows.length,log:[]}).select('id').single());
 const stopped=await checked(db.from('pricing_events').select('id,produto_id').eq('event_type','COHORT_SAFETY_STOP').eq('job_id',job.id));const resolutions=await checked(db.from('pricing_events').select('payload').eq('event_type','COHORT_SAFETY_STOP_RESOLVED').eq('job_id',job.id));const resolvedStops=new Set(resolutions.flatMap(r=>r.payload.stopEvents??[]));if(stopped.some(s=>!resolvedStops.has(s.id))&&!process.argv.includes('--resume'))throw Error('COHORT_SAFETY_STOP_PENDING');
 const owner=crypto.randomUUID(),domain='anuncios:ml_push';
 if(!await checked(db.rpc('acquire_sync_domain_lock',{p_domain:domain,p_owner_task:'radar_launch',p_owner_token:owner,p_owner_job_id:job.id,p_ttl_seconds:3600,p_metadata:{cohort:COHORT}})))throw Error('PUBLICATION_LOCK_BUSY');
 await checked(db.from('jobs').update({status:'rodando',finished_at:null}).eq('id',job.id));
 const results=[];
 const event=async(c,type,key,payload={},itemId=null,evaluationId=null,price=null)=>checked(db.from('pricing_events').insert({event_type:type,produto_id:c.product.id,ml_item_id:itemId,pricing_group_id:itemId?'item:'+itemId:'product:'+c.product.id,evaluation_id:evaluationId,pricing_source:'radar_launch',actor:'Diretoria/Vortek:ordem-expressa-coorte-01',reason:type,rule_id:'M2M-PRC-01-v1',job_id:job.id,new_price:price,dedupe_key:`${COHORT}:${c.sku}:${key}`,payload:{cohort:COHORT,sku:c.sku,...payload}}).select('id').single());
 try {
  for(const row of rows) {
   const {sku,c}=row;let itemId=null,resumeId=null;
   try {
    const previous=await checked(db.from('pricing_events').select('*').eq('dedupe_key',`${COHORT}:${sku}:requested`).maybeSingle());
    if(previous){const remote=await freshDuplicates(rt,c,inventory);save(sku+'-reconciliation.json',{at:now(),previousRequest:previous.id,remote});const done=await checked(db.from('pricing_events').select('*').eq('dedupe_key',`${COHORT}:${sku}:validated`).maybeSingle());let reconciledQuantity=previous.payload.payload.available_quantity;
     if(done&&remote.length===1){const current=await pricing.resolvePricingProduct(db,c.product.id);const live=await supplierLive(db,current.offer);assertSupplier({...c,...current},live);const reservedRows=await checked(db.from('pedido_itens').select('quantidade,pedidos!inner(situacao)').eq('seller_sku',sku).in('pedidos.situacao',['aberto','pendente','faturado']));const safe=Math.max(0,Math.min(Number(current.offer.estoque),Number(live.product.estoque))-reservedRows.reduce((sum,r)=>sum+Number(r.quantidade),0));if(Number(remote[0].available_quantity)<=safe)reconciledQuantity=Number(remote[0].available_quantity);save(sku+'-stock-reconciliation.json',{at:now(),baseline:previous.payload.payload.available_quantity,current:remote[0].available_quantity,safe,source:'supplier_live_and_reservations'});}
     if(done&&remote.length===1&&remote[0].id===done.ml_item_id&&remote[0].status==='active'&&readbackChecks({...previous.payload.payload,price:done.new_price,available_quantity:reconciledQuantity},remote[0],rt.account.userId).ok){results.push({sku,itemId:done.ml_item_id,status:'PUBLICADO_VALIDADO',reconciled:true,price:done.new_price});continue;}const response=await checked(db.from('pricing_events').select('ml_item_id').eq('dedupe_key',`${COHORT}:${sku}:response`).maybeSingle());if(process.argv.includes('--resume')&&response?.ml_item_id&&remote.length===1&&remote[0].id===response.ml_item_id){resumeId=response.ml_item_id;}else throw Error('PUBLICACAO_JA_SOLICITADA_RECONCILIAR_SEM_NOVO_POST');}
    if(stopped.some(s=>!resolvedStops.has(s.id)&&s.produto_id!==c.product.id))throw Error('COHORT_SAFETY_STOP_PENDING_OTHER_ITEM');
    const resolved=await pricing.resolvePricingProduct(db,c.product.id);c.product=resolved.product;c.offer=resolved.offer;
    const supplier=await supplierLive(db,c.offer);assertSupplier(c,supplier);
    const catalog=await ml('/products/'+c.catalog.id);if(!catalog.ok||catalog.data.status!=='active')throw Error('CATALOGO_INDISPONIVEL');if((catalog.data.short_description?.content??'')!==(c.catalog.short_description?.content??''))throw Error('CONTEUDO_CATALOGO_ALTERADO_REVISAR');
    const identity={local:supplierIdentityFacts(c.offer,identityFacts(catalog.data.attributes,{title:catalog.data.name}),c.radar.evidence.identitySupplement),remote:identityFacts(catalog.data.attributes,{title:catalog.data.name}),source:'/products/'+c.catalog.id};
    const duplicates=await freshDuplicates(rt,c,inventory);
    if(duplicates.some(i=>i.id!==resumeId&&['active','paused','under_review','not_yet_active'].includes(i.status)))throw Error('ANUNCIO_EXISTENTE_OU_REATIVACAO');
    const reservations=await checked(db.from('pedido_itens').select('quantidade,pedidos!inner(situacao)').eq('seller_sku',sku).in('pedidos.situacao',['aberto','pendente','faturado']));
    const reserved=reservations.reduce((sum,r)=>sum+Number(r.quantidade),0);
    const quantity=Math.min(2,Number(c.offer.estoque)-reserved,Number(supplier.product.estoque)-reserved);if(quantity<=0)throw Error('ESTOQUE_RESERVADO');
    const context=await pricing.resolveNewListingQuoteContext(c.product,c.category.id,'gold_special');if(!context)throw Error('CONTEXTO_ML_INDISPONIVEL');
    const d=supplier.product;context.dimensions=[d.altura_embalagem,d.largura_embalagem,d.profundidade_embalagem].map(v=>Math.ceil(Number(v))).join('x')+','+Math.ceil(Number(d.peso_embalagem)*1000);
    const evaluation=await pricing.evaluateProductPricing(db,{productId:c.product.id,price:row.memory.price,context,objective:'target',requireLive:true});
    const memory=evaluation.memory;
    const assessment=assessOpportunityConflicts({identity,listings:[],listingSearchComplete:true,economy:memory,eligibleOffer:true});
    if(assessment.state!=='SEM_CONFLITO'||!['VIAVEL_NO_ALVO','VIAVEL_ACIMA_DO_PISO'].includes(assessment.economy))throw Error('GATE_FINAL:'+assessment.reasons.join(','));
    const correction=resumeId?await checked(db.from('pricing_events').select('id,payload').eq('dedupe_key',`${COHORT}:${sku}:safety-price-approved`).maybeSingle()):null;
    const payload=resumeId?{...previous.payload.payload,...(correction?{price:correction.payload.price}: {})}:{...row.payload,price:memory.price,available_quantity:quantity};
    if(resumeId&&quantity<payload.available_quantity)throw Error('ESTOQUE_INSUFICIENTE_NA_RETOMADA');
    const validated=await ml('/items/validate','POST',payload);if(!payloadValidated(validated,payload))throw Error('PAYLOAD_FINAL_INVALIDO');
    // Tarifa e frete vivos imediatamente antes do ato; nenhuma fórmula paralela.
    const finalEval=await pricing.evaluateProductPricing(db,{productId:c.product.id,price:payload.price,context,requireLive:true});
    if(!finalEval.memory||finalEval.memory.margin<finalEval.memory.band.floor||finalEval.memory.fee.source!=='ml_live'||finalEval.memory.shipping.source!=='ml_live')throw Error('RECOTACAO_FINAL_BLOQUEADA');
    const evaluationId=await pricing.persistPricingEvaluation(db,{...finalEval,memory:finalEval.memory,scenario:'target',jobId:job.id,groupId:'product:'+c.product.id});
    const approval=resumeId?{id:correction?.id??previous.payload.approvalId}:await event(c,'APPROVED','approval',{acknowledgeEstimates:true,authorization:'Ordem explícita: até 10; garantia fabricante 12 meses',memory:finalEval.memory},null,evaluationId,payload.price);
    save(sku+(resumeId?'-before-resume.json':'-before-post.json'),{at:now(),supplier,assessment,payload,description:row.description,memory:finalEval.memory,evaluationId,approvalId:approval.id,duplicates,quantity});
    if(!resumeId){const attempts=await checked(db.from('pricing_events').select('id').eq('job_id',job.id).eq('event_type','RADAR_LAUNCH_REQUESTED'));if(attempts.length>=10)throw Error('LIMITE_COORTE_ATINGIDO');}
    if(!resumeId)await event(c,'RADAR_LAUNCH_REQUESTED','requested',{payload,approvalId:approval.id,sourceHash:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')},null,evaluationId,payload.price);
    let post;
    try{post=resumeId?await ml('/items/'+resumeId):await ml('/items','POST',payload);}catch(e){save(sku+'-post-unknown.json',{at:now(),error:e.message});throw Error('POST_RESULTADO_INCONCLUSIVO_NAO_REPETIR');}
    save(sku+(resumeId?'-resume-read.json':'-post-response.json'),post);itemId=post.data?.id??null;
    if(!resumeId)await event(c,'RADAR_LAUNCH_RESPONSE','response',{status:post.status,response:post.data},itemId,evaluationId,payload.price);
    if(!post.ok||!itemId)throw Error('POST_FALHOU:'+post.status);
    let remote=await ml('/items/'+itemId+'?include_internal_attributes=true');if(!remote.ok)throw Error('READBACK_INDISPONIVEL');
    let verification=readbackChecks(payload,remote.data,rt.account.userId);save(sku+'-initial-readback.json',{remote,verification});
    if(!verification.ok)throw Error('READBACK_DIVERGENTE:'+Object.entries(verification.checks).filter(([,v])=>!v).map(([k])=>k).join(','));
    const existingDescription=await ml('/items/'+itemId+'/description');
    save(sku+'-catalog-description.json',{source:'ml_catalog',catalogId:catalog.data.id,response:existingDescription});
    if(!catalogDescriptionMatches(catalog.data,existingDescription))throw Error('DESCRICAO_CATALOGO_DIVERGENTE');
    // Upload de imagens é assíncrono no ML. Ler o estado documentado sem repetir criação.
    for(let attempt=0;attempt<12&&remote.data.sub_status?.includes('picture_download_pending');attempt++){
     const pictureErrors=await Promise.all(remote.data.pictures.map(p=>ml('/pictures/'+p.id+'/errors')));
     save(sku+'-picture-processing.json',{at:now(),attempt,pictureErrors});
     await new Promise(resolve=>setTimeout(resolve,5000));remote=await ml('/items/'+itemId+'?include_internal_attributes=true');if(!remote.ok)throw Error('READBACK_INDISPONIVEL');
    }
    if(remote.data.status==='paused'&&(!(remote.data.sub_status??[]).length||(resumeId&&(remote.data.sub_status??[]).every(s=>s==='paused_by_seller')))){const beforeActivation=await pricing.evaluateProductPricing(db,{productId:c.product.id,itemId,price:Number(remote.data.price),requireLive:true});if(!beforeActivation.memory||beforeActivation.memory.margin<beforeActivation.memory.band.floor)throw Error('ECONOMIA_REATIVACAO_INCONCLUSIVA');const activation=await ml('/items/'+itemId,'PUT',{status:'active'});save(sku+'-activation.json',activation);remote=await ml('/items/'+itemId+'?include_internal_attributes=true');}
    verification=readbackChecks(payload,remote.data,rt.account.userId);if(!remote.ok||!verification.ok||remote.data.status!=='active')throw Error('ANUNCIO_NAO_VALIDADO_ATIVO');
    const description=await ml('/items/'+itemId+'/description');if(!catalogDescriptionMatches(catalog.data,description))throw Error('DESCRICAO_CATALOGO_DIVERGENTE');
    const postEval=await pricing.evaluateProductPricing(db,{productId:c.product.id,itemId,price:Number(remote.data.price),requireLive:true});
    if(!postEval.memory||postEval.memory.result===null||postEval.memory.margin<postEval.memory.band.floor)throw Error('ECONOMIA_POS_PUBLICACAO_BLOQUEADA');
    const terms=remote.data.sale_terms??[];if(!terms.some(t=>t.id==='WARRANTY_TYPE'&&t.value_id==='2230279')||!terms.some(t=>t.id==='WARRANTY_TIME'&&t.value_name==='12 meses'))throw Error('GARANTIA_DIVERGENTE');
    // Reusa a transação existente de vínculo (nenhuma função de pricing legada).
    const {buildPersistenceSql}=require('./lib/ml-p0-phase6a');
    const {spawnSync}=require('node:child_process');
    const sql=buildPersistenceSql({product:c.product,item:remote.data});
    const persisted=spawnSync('ssh',['192.168.1.160','docker exec -i supabase-db psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
    save(sku+'-persistence.json',{status:persisted.status,output:persisted.stdout,error:persisted.stderr});if(persisted.status!==0)throw Error('PERSISTENCIA_FALHOU');
    await checked(db.from('anuncios_ml').update({pricing_group_id:'item:'+itemId,catalog_synchronized_pair:false,pricing_group_evidence:{at:now(),itemIds:[itemId],complete:true,proof:'NO_ITEM_RELATIONS'}}).eq('ml_item_id',itemId));
    await checked(db.from('produtos').update({imagens:row.pictureProof.map(p=>p.url)}).eq('id',c.product.id));
    const currentId=await pricing.persistPricingEvaluation(db,{...postEval,memory:postEval.memory,scenario:'current',itemId,groupId:'item:'+itemId,jobId:job.id});
    const traffic=await ml('/items/'+itemId+'/visits/time_window?last=1&unit=day');
    const startedAt=now(),observationUntil=new Date(Date.parse(startedAt)+30*86400000).toISOString();
    await event(c,'RADAR_LAUNCH_VALIDATED','validated',{startedAt,observationUntil,checkpoints:[7,15,30].map(day=>({day,dueAt:new Date(Date.parse(startedAt)+day*86400000).toISOString()})),approvalId:approval.id,identity:assessment,baseline:{price:payload.price,stock:quantity,visits:traffic.ok?traffic.data:null,sold:remote.data.sold_quantity,memory:postEval.memory,demand:c.radar.priority.demand,score:c.radar.priority},status:'PUBLICADO_VALIDADO'},itemId,currentId,payload.price);
    await checked(db.from('radar_oportunidades').update({stage:'PUBLICADO_EXPERIMENTO',queue:'REVISAR',pricing_group_id:'item:'+itemId,evaluation_id:currentId,evidence:{...c.radar.evidence,cohort:COHORT,mlItemId:itemId,publicationStatus:'PUBLICADO_VALIDADO'}}).eq('id',c.radar.id));
    if(resumeId)await event(c,'COHORT_SAFETY_STOP_RESOLVED','stop-resolved',{stopEvents:stopped.filter(s=>s.produto_id===c.product.id).map(s=>s.id),reason:'Causa diagnosticada e correção registrada nas evidências; estado, preço, conteúdo de catálogo e economia relidos e validados'},itemId,currentId,payload.price);
    if(resumeId)stopped.filter(s=>s.produto_id===c.product.id).forEach(s=>resolvedStops.add(s.id));
    save(sku+'-confirmed.json',{sku,itemId,startedAt,observationUntil,remote:remote.data,verification,description:description.data,memory:postEval.memory,approvalId:approval.id,evaluationId:currentId,status:'PUBLICADO_VALIDADO'});
    inventory.items.push(remote.data);results.push({sku,itemId,status:'PUBLICADO_VALIDADO',price:payload.price,margin:postEval.memory.margin});
    console.log(JSON.stringify(results.at(-1)));
   }catch(e){
    if(itemId){let pause;try{pause=await ml('/items/'+itemId,'PUT',{status:'paused'});}catch(err){pause={error:err.message};}const readback=await ml('/items/'+itemId).catch(err=>({error:err.message}));save(sku+'-safety-stop.json',{at:now(),itemId,reason:e.message,pause,readback});await event(c,'COHORT_SAFETY_STOP','safety-stop:'+crypto.randomUUID(),{error:e.message,pause,readback},itemId);}
    results.push({sku,itemId,status:itemId?'COHORT_SAFETY_STOP':'PENDENTE',reason:e.message});console.log(JSON.stringify(results.at(-1)));break;
   }
   save('execution_results.json',{cohort:COHORT,jobId:job.id,at:now(),results,requests:rt.requests});
  }
  save('execution_results.json',{cohort:COHORT,jobId:job.id,at:now(),results,requests:rt.requests});
  const complete=results.length===rows.length&&results.every(r=>r.status==='PUBLICADO_VALIDADO');
  await checked(db.from('jobs').update({status:complete?'completo':'erro',processados:results.filter(r=>r.itemId).length,progresso:complete?100:0,finished_at:complete?now():null,log:[...(job.log||[]),{event:'radar_launch_result',timestamp:now(),payload:{cohort:COHORT,results}}]}).eq('id',job.id));
 } finally { await checked(db.rpc('release_sync_domain_lock',{p_domain:domain,p_owner_token:owner,p_force:false})); }
}
if(require.main===module) (process.argv.includes('--publish')?publish():process.argv.includes('--build')?build():prepare()).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={COHORT,DIR,runtime,loadPricing,checked,save,read,buildPayload,assertSupplier,supplierLive,payloadValidated,readbackChecks,assertCohortSize,catalogDescriptionMatches};
