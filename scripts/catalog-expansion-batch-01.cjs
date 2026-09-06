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
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:'RESPOSTA_HTTP_INCONCLUSIVA',httpStatus:r.status};}return{ok:r.ok,status:r.status,data};
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
   await checked(db.from('pricing_events').insert({event_type:'CATALOG_EXPANSION_LOGISTICS_CORRECTED',rule_id:BATCH,produto_id:p.id,pricing_source:'radar_launch',actor,reason:'Embalagem confirmada na oferta viva; produto ativo preservado',payload:{batchId:BATCH,previous,next:patch,source:'/v1/CrossDocking/Catalogo/'+o.dslite_fornecedor_id+'/'+o.dslite_produto_id,observedAt:row.liveOffer.at}}));
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
   const publicUrl=new URL(`/storage/v1/object/public/product-images/${object}`,process.env.NEXT_PUBLIC_SUPABASE_URL).href;
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
   const payload={batchId:BATCH,identity:identity.identity,conflict:'SEM_CONFLITO',logistics:'CONFIRMED',warrantyPolicyVersion:warranty.data.warranty.policyVersion,offerId:o.id,cost:Number(o.custo),stock:Number(o.estoque),catalogProductId:catalog.id,catalogFingerprint:crypto.createHash('sha256').update(JSON.stringify({name:catalog.name,attributes:catalog.attributes,description:catalog.short_description})).digest('hex'),images,draftHash:crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex'),draft,review,duplicateCoverage:{complete:true,at:duplicates.at,total:duplicates.total},sourceInspectionAt:inspection.at};
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
  const completed=await checked(db.from('pricing_events').select('id').eq('produto_id',candidate.productId).eq('event_type','CATALOG_EXPANSION_VALIDATED').contains('payload',{batchId:BATCH}).maybeSingle());
  if(completed){console.log({sku:candidate.sku,status:'JA_VALIDADO_SEM_NOVA_ESCRITA'});continue;}
  const simulation=await app('/api/pricing/simulate','POST',{productId:candidate.productId,categoryId:candidate.draft.categoriaId,listingType:candidate.draft.listingType,objective:'target'});
  if(!simulation.ok||!simulation.data.success){results.push({sku:candidate.sku,status:'BLOQUEADO_PRE_POST',response:simulation});save('execution.json',{results});continue;}
  const approval=await app('/api/pricing/approve','POST',{evaluationId:simulation.data.evaluationId,acknowledgeEstimates:true,reason:'Diretoria autorizou CATALOG_EXPANSION_BATCH_01; alvo canônico e tributo estimated registrado'});
  if(!approval.ok)throw Error('APROVACAO_'+JSON.stringify(approval.data));
  save('execution-checkpoint.json',{batchId:BATCH,sku:candidate.sku,preparationId:candidate.preparationId,approvalId:approval.data.approvalId,at:new Date().toISOString(),state:'ANTES_DA_ROTA_PUBLICACAO'});
  const response=await app('/api/ml/anuncio/criar','POST',{...candidate.draft,produtoId:candidate.productId,pricingMode:'canonical',pricingApprovalId:approval.data.approvalId,catalogExpansion:{batchId:BATCH,preparationId:candidate.preparationId}});
  const event=await checked(db.from('pricing_events').select('event_type,ml_item_id,payload').eq('produto_id',candidate.productId).eq('event_type','CATALOG_EXPANSION_VALIDATED').contains('payload',{batchId:BATCH}).maybeSingle());
  results.push({sku:candidate.sku,status:event?'PUBLICADO_VALIDADO':'BLOQUEADO_OU_INCONCLUSIVO',response,event});save('execution.json',{batchId:BATCH,at:new Date().toISOString(),results});
  console.log({sku:candidate.sku,http:response.status,status:results.at(-1).status,itemId:event?.ml_item_id,error:response.data.error});
  if(!event){const attempts=await checked(db.from('pricing_events').select('id').eq('produto_id',candidate.productId).eq('event_type','CREATE_REQUESTED').contains('payload',{batchId:BATCH}).limit(1));if(attempts.length)break;}
 }
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
 for(const p of preparation)memoryRow(p.sku,'PRE_POST',p.simulation.memory);
 for(const e of validated)memoryRow(inspection.rows.find(r=>r.product.id===e.produto_id).sku,'POS_PUBLICACAO',e.payload.memory,e.ml_item_id);
 csv('04_MEMORIA_ECONOMICA.csv',memories,['sku','fase','mlb','preco','cmv','oferta','fornecedor','tarifa','tarifa_origem','frete','frete_origem','tributo','tributo_status','aliquota','resultado','margem','faixa','piso','alvo','limite','modelo','timestamp']);
 csv('05_GARANTIAS_APLICADAS.csv',validated.map(e=>{const w=e.payload.warranty.resolution;return{sku:inspection.rows.find(r=>r.product.id===e.produto_id).sku,mlb:e.ml_item_id,origem:w.origin,warranty_source:w.warranty_source,warranty_type:w.warranty_type,warranty_duration:w.warranty_duration,warranty_unit:w.warranty_unit,fonte:w.source,evidencia_em:w.observedAt,politica:w.policyVersion};}),['sku','mlb','origem','warranty_source','warranty_type','warranty_duration','warranty_unit','fonte','evidencia_em','politica']);
 const write=(name,text)=>fs.writeFileSync(path.join(dir,name),text+'\n');
 write('00_RESUMO_EXECUTIVO.md',`# ${BATCH} — D0\n\nNovos publicados e validados: **${validated.length}**. Reativados: **0**. Já ativos: **${gates.filter(g=>g.estado==='JA_ANUNCIADO_ATIVO').length}**. Bloqueados/pendentes: **${blocked.length}**.\n\n${gates.map(g=>`- ${g.sku}: ${g.estado}${g.mlb?' — '+g.mlb:''}. ${g.motivo}`).join('\n')}\n\nSafety stops: ${stops.length}. As simulações não autorizam candidatos com conflito. Não houve correção remota nos dois anúncios previamente ativos.\n\n${published.map(p=>`Publicado ${p.sku}: faixa ${p.faixa}, piso ${p.piso*100}%, alvo ${p.alvo*100}%, margem remota ${(p.margem*100).toFixed(4)}%.`).join('\n')}\n\nA garantia padrão foi alterada por decisão expressa: fabricante → fornecedor → vendedor 30 dias. Nas ofertas publicadas, prevalece o prazo comprovado da fonte registrada.`);
 write('06_READBACK_ML.md',`# Conferência remota\n\n${validated.length} eventos PUBLICADO_VALIDADO. Evidência integral: audit-events.json.\n\n${validated.map(e=>`- ${e.ml_item_id}: status ${e.payload.readback.status}, preço ${e.payload.readback.price}, estoque ${e.payload.readback.available_quantity}, catálogo ${e.payload.readback.catalog_product_id}, margem ${(e.payload.memory.margin*100).toFixed(4)}%. Garantia, identidade e grupo conferidos pelo backend; sem divergência impeditiva.`).join('\n')}\n\n${stops.length?'Safety stop registrado; consultar eventos.':'Nenhum safety stop registrado.'}\n\nHTTP 400 do validador contendo exclusivamente avisos shipping.lost_me1_by_user e item.shipping.mandatory_free_shipping é aceito somente quando o payload já exige ME2 e frete grátis. Nenhum erro material foi dispensado.`);
 write('07_PENDENCIAS_REMANESCENTES.md',`# Pendências individuais\n\n${blocked.map(g=>`- **${g.sku} — ${g.estado}:** ${g.motivo}`).join('\n')}\n\nA pesquisa entregue foi reaproveitada. Não foram iniciadas novas cadências, pesquisas amplas ou próximos lotes. Correções no catálogo ML e confirmação do tratamento do IPI permanecem para validação específica.`);
 write('rollback.md','# Rollback\n\nCódigo: reverter os commits desta entrega por novos commits, mantendo histórico e eventos. O fallback anterior depende de classificação, portanto seu retorno exige decisão da Diretoria; não restaurar política antiga silenciosamente.\nNão apagar anúncios nem eventos para desfazer a operação. Anúncio com divergência crítica deve ser pausado e confirmado remotamente; bloqueio persistente permanece até revisão. As correções locais de embalagem têm baseline nos eventos CATALOG_EXPANSION_LOGISTICS_CORRECTED. Não foi necessária migration.');
 const files={};for(const name of fs.readdirSync(dir)){const full=path.join(dir,name);if(fs.statSync(full).isFile()&&name!=='manifest.json')files[name]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');}
 save('manifest.json',{batchId:BATCH,generatedAt:new Date().toISOString(),implementationCommits:cp.execFileSync('git',['log','-4','--format=%H'],{encoding:'utf8'}).trim().split('\n'),warrantyPolicy:'VORTEK-WARRANTY-2026-09-06-SELLER-30',economicModel:'VORTEK-CANON-1.0-ECON-2',counts:{evaluated:10,published:validated.length,reactivated:0,alreadyActive:gates.filter(g=>g.estado==='JA_ANUNCIADO_ATIVO').length,blockedOrPending:blocked.length,safetyStops:stops.length},files});
 console.log({report:dir,published:validated.length,pending:blocked.length});
}

async function reconcile() {
 const {app,actor}=await appRuntime();
 const {catalogExpansionReadbackIssues,catalogExpansionKey}=require('../src/lib/ml/catalog-expansion.ts');
 const {assessIdentity}=require('../src/lib/ml/opportunity-conflicts.ts');
 const {identityFacts}=require('../src/lib/ml/opportunity-identity.ts');
 const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
 async function ml(endpoint){const r=await fetch('https://api.mercadolibre.com'+endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('READBACK_HTTP_'+r.status);return r.json();}
 const rows=await checked(db.from('pricing_events').select('*').eq('event_type','CREATED_REMOTE').contains('payload',{batchId:BATCH}));
 for(const row of rows){
  const existing=await checked(db.from('pricing_events').select('id').eq('event_type','CATALOG_EXPANSION_VALIDATED').eq('ml_item_id',row.ml_item_id).maybeSingle());if(existing)continue;
  const prepared=await checked(db.from('pricing_events').select('*').eq('event_type','CATALOG_EXPANSION_PAYLOAD_VALIDATED').eq('produto_id',row.produto_id).contains('payload',{batchId:BATCH}).order('created_at',{ascending:false}).limit(1).single());
  const expected=prepared.payload.payload,item=await ml('/items/'+row.ml_item_id);
  const simulation=await app('/api/pricing/simulate','POST',{productId:row.produto_id,itemId:row.ml_item_id,price:Number(item.price)});
  const memory=simulation.data.memory,issues=catalogExpansionReadbackIssues({price:expected.price,quantity:expected.available_quantity,categoryId:expected.category_id,catalogProductId:expected.catalog_product_id},item,memory);
  const identity=assessIdentity({local:identityFacts(expected.attributes,{title:expected.title||expected.family_name}),remote:identityFacts(item.attributes,{title:item.title||item.family_name}),source:'readback_reconciliation'});
  if(identity.identity!=='IDENTIDADE_COHERENTE')issues.push('IDENTIDADE_NAO_CONFIRMADA');
  if(!expected.sale_terms.every(e=>item.sale_terms.some(a=>a.id===e.id&&(e.value_id?String(a.value_id)===String(e.value_id):a.value_name===e.value_name))))issues.push('GARANTIA_NAO_CONFIRMADA');
  if(!item.pictures?.length||(item.item_relations??[]).length)issues.push('IMAGENS_OU_VINCULO_INCONCLUSIVO');
  const sku=expected.seller_custom_field;const duplicates=await Promise.all(['seller_sku','sku'].map(k=>ml('/users/'+item.seller_id+'/items/search?'+k+'='+encodeURIComponent(sku))));
  const ids=[...new Set(duplicates.flatMap(r=>r.results??[]))];if(ids.length!==1||ids[0]!==item.id)issues.push('DUPLICIDADE_OU_INDICE_INCONCLUSIVO');
  save('reconciliation-'+sku+'.json',{at:new Date().toISOString(),item,identity,simulation,issues,duplicates});
  if(issues.length)throw Error('RECONCILIACAO_PENDENTE_'+issues.join('|'));
  const link=await checked(db.from('anuncios_ml').select('produto_id,pricing_group_id').eq('ml_item_id',item.id).single());if(link.produto_id!==row.produto_id||link.pricing_group_id!=='item:'+item.id)throw Error('VINCULO_LOCAL_INCONCLUSIVO');
  await checked(db.from('pricing_events').insert({event_type:'CATALOG_EXPANSION_VALIDATED',produto_id:row.produto_id,ml_item_id:item.id,pricing_group_id:link.pricing_group_id,evaluation_id:simulation.data.evaluationId,pricing_source:'radar_launch',actor,reason:'PUBLICADO_VALIDADO',new_price:item.price,rule_id:memory.policyVersion,dedupe_key:'validated:'+catalogExpansionKey(row.produto_id),payload:{batchId:BATCH,cohort:BATCH,preparationId:prepared.payload.preparationId,approvalId:row.payload.approvalId,warranty:row.payload.warranty,memory,baseline:{startAt:row.created_at,price:item.price,margin:memory.margin,stock:item.available_quantity,sales:item.sold_quantity,visits:null},readback:item,reconciliation:{reason:'Conferência concluída após falha de persistência do cenário; sem repetir POST',at:new Date().toISOString(),identity,duplicateIds:ids}}}));
  await checked(db.from('radar_oportunidades').update({stage:'PUBLICADO_EXPERIMENTO',queue:'JA_ANUNCIADOS',processed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('produto_id',row.produto_id));
  console.log({sku,mlb:item.id,status:'PUBLICADO_VALIDADO',price:item.price,margin:memory.margin,repeatedPost:false});
 }
}
