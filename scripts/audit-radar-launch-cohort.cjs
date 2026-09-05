/** Gate de leitura da coorte autorizada. Não publica, pausa, altera preço ou confirma estimativas. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),XLSX=require('xlsx');
require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const {identityFacts,supplierIdentityFacts}=require('../src/lib/ml/opportunity-identity.ts');
const {assessIdentity,assessOpportunityConflicts}=require('../src/lib/ml/opportunity-conflicts.ts');
const {IDENTITY_RULE_VERSION}=require('../src/lib/ml/identity-normalization.ts');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const folder=path.resolve('reports/RADAR_LAUNCH_2026_09_COHORT_01');fs.mkdirSync(folder,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
async function checked(p){const r=await p;if(r.error)throw Error(r.error.message);return r.data;}
(async()=>{
 const supplements=read(path.join(folder,'identity_supplements.json'));
 const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
 let calls=0;const requests=[];
 const fetchMLResult=async endpoint=>{calls++;const at=new Date().toISOString();try{const r=await fetch('https://api.mercadolibre.com'+endpoint,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});const data=await r.json();requests.push({endpoint,at,status:r.status});return {ok:r.ok,status:r.status,data:r.ok?data:null,error:r.ok?null:{code:data.error??'ML_ERROR'}};}catch(e){requests.push({endpoint,at,status:null,error:e.name});return{ok:false,status:null,data:null,error:{code:e.name}};}};
 const filename=path.resolve('src/services/pricing-context.ts'),mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:id=>id==='./integration'?{fetchMLResult}:require(id.startsWith('.')?path.resolve(path.dirname(filename),id):id),URLSearchParams,Date,Intl,Map,Set});
 const pricing=mod.exports;
 const workbook=XLSX.readFile('reports/m2m-pricing-radar-2026-09-05/06_REPROCESSAMENTO_OPORTUNIDADES.xlsx');const reviewed=XLSX.utils.sheet_to_json(workbook.Sheets['65 revisados']);
 const previous=read('reports/m2m-identity-correction-2026-09-05/06_memorias.json');const runtime=await pricing.loadPricingRuntime(db);const results=[];
 for(let offset=0;offset<reviewed.length;offset+=4){
  const batch=await Promise.all(reviewed.slice(offset,offset+4).map(async row=>{
   const prior=previous.find(r=>r.sku===row.sku);const resolved=await pricing.resolvePricingProduct(db,prior.produto_id);
   const catalog=prior.catalog_product_id?await fetchMLResult('/products/'+encodeURIComponent(prior.catalog_product_id)):null;
   const remote=catalog?.ok?identityFacts(catalog.data.attributes??[],{title:catalog.data.name,source:'/products/'+prior.catalog_product_id}):{};
   const identity={local:supplierIdentityFacts(resolved.offer??resolved.product,remote,supplements[row.sku]),remote,source:catalog?.ok?'/products/'+prior.catalog_product_id:null};
   const assessment=assessIdentity(identity);const blocked=[];
   if(assessment.identity!=='IDENTIDADE_COHERENTE')blocked.push(...assessment.reasons);
   if(!resolved.offer||!resolved.product.ativo||Number(resolved.offer.estoque)<=0)blocked.push('OFERTA_ESTOQUE_INDISPONIVEL');
   if(!catalog?.ok)blocked.push('PUBLICACAO_BLOQUEADA_FONTE_ML_INCONCLUSIVA');
   let quote=null,quoteFailure=null;
   if(!blocked.length){
    const market=read(`reports/oportunidades-ml-2026-09-05/mercado/${row.sku}.json`);
    const endpoint=market.reference?.feeResponse?.endpoint;
    const category=endpoint?new URL('https://api.mercadolibre.com'+endpoint).searchParams.get('category_id'):null;
    const liveCategory=category?await fetchMLResult('/categories/'+category):null;
    const context=liveCategory?.ok?await pricing.resolveNewListingQuoteContext(resolved.product,category,market.listingType):null;
    if(context){const evaluation=await pricing.evaluateProductPricing(db,{productId:prior.produto_id,price:Number(row.preco_competitivo),context,objective:'target',runtime,requireLive:true});quote=evaluation.memory;quoteFailure=evaluation.failure;}
    else quoteFailure='CONTEXTO_LOGISTICO_ML_INCONCLUSIVO';
    if(!quote||quote.result===null)blocked.push('PUBLICACAO_BLOQUEADA_FONTE_ML_INCONCLUSIVA');
    else if(quote.margin<quote.band.floor)blocked.push('ECONOMIA_ABAIXO_DO_PISO');
    // A aprovação individual, com reconhecimento das estimativas, é uma etapa posterior ao gate de leitura.
   }
   return {sku:row.sku,produto_id:prior.produto_id,product:resolved.product,offer:resolved.offer,identity,assessment,catalog:catalog?.data??null,quote,quoteFailure,blocked,priorIdentity:row.identidade,priorConflict:row.conflito,observedAt:new Date().toISOString()};
  }));results.push(...batch);console.log(JSON.stringify({evaluated:results.length,total:reviewed.length,mlCalls:calls}));
 }
 fs.writeFileSync(path.join(folder,'baseline_live.json'),JSON.stringify({cohort:'RADAR_LAUNCH_2026_09_COHORT_01',identityRuleVersion:IDENTITY_RULE_VERSION,at:new Date().toISOString(),mlMutations:0,calls,requests,results},null,2));
 console.log(JSON.stringify({evaluated:results.length,identities:results.reduce((a,r)=>(a[r.assessment.identity]=(a[r.assessment.identity]??0)+1,a),{}),eligibleForFinalGate:results.filter(r=>!r.blocked.length).map(r=>r.sku),quoted:results.filter(r=>r.quote||r.quoteFailure).map(r=>({sku:r.sku,margin:r.quote?.margin,failure:r.quoteFailure,blocked:r.blocked}))}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
