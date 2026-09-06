#!/usr/bin/env node
/** Reprocessamento pontual da migração: GET ML e INSERT de memórias. Nunca altera anúncios, preços, produtos ou ofertas. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const dir=path.resolve('reports/canon-comercial-v1-2026-09-05');
const db=createClient(process.env.SUPABASE_SERVICE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
(async()=>{
 const apply=process.argv.includes('--apply');
 const audit=JSON.parse(fs.readFileSync(path.join(dir,'audit-existing.json'),'utf8'));
 const auth=await db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single();if(auth.error||!auth.data?.access_token)throw Error('TOKEN_ML_INDISPONIVEL');
 const calls=[];
 const fetchMLResult=async endpoint=>{
  try {const r=await fetch('https://api.mercadolibre.com'+endpoint,{method:'GET',headers:{Authorization:`Bearer ${auth.data.access_token}`},signal:AbortSignal.timeout(20000)});const data=await r.json();calls.push({method:'GET',endpoint,status:r.status,at:new Date().toISOString()});return {ok:r.ok,status:r.status,data:r.ok?data:null};}
  catch(e){calls.push({method:'GET',endpoint,status:null,error:e.name,at:new Date().toISOString()});return {ok:false,status:null,data:null};}
 };
 const filename=path.resolve('src/services/pricing-context.ts'),mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:id=>id==='./integration'?{fetchMLResult}:require(id.startsWith('.')?path.resolve(path.dirname(filename),id):id),URLSearchParams,Date,Intl,Map,Set});
 const {loadPricingRuntime,evaluateProductPricing,persistPricingEvaluation}=mod.exports;
 const runtime=await loadPricingRuntime(db);
 if(!runtime.policy.version.startsWith('VORTEK-CANON-1.0-ECON-2'))throw Error('MIGRACAO_ECONOMICA_NAO_APLICADA');
 const subjects=audit.rows.filter(r=>r.productId),rows=[];
 const seen=new Set();
 for(let offset=0;offset<subjects.length;offset+=4){
  rows.push(...await Promise.all(subjects.slice(offset,offset+4).map(async row=>{
   const key=row.productId+':'+row.itemId;if(seen.has(key))return {itemId:row.itemId,status:'JA_PROCESSADO'};seen.add(key);
   try {
    const evaluation=await evaluateProductPricing(db,{productId:row.productId,itemId:row.itemId,runtime,requireLive:true});
    if(!evaluation.memory)throw Error(evaluation.failure??'ECONOMIA_INCONCLUSIVA');
    const evaluationId=apply?await persistPricingEvaluation(db,{...evaluation,memory:evaluation.memory,scenario:'current',itemId:row.itemId,groupId:row.pricingGroupId}):null;
    return {itemId:row.itemId,productId:row.productId,sku:row.sku,evaluationId,memory:evaluation.memory};
   }catch(e){return {itemId:row.itemId,productId:row.productId,sku:row.sku,error:e.message};}
  })));
  if(rows.length%100===0||rows.length===subjects.length){
   fs.writeFileSync(path.join(dir,'economic-reprocessing.json'),JSON.stringify({at:new Date().toISOString(),apply,mlMutations:0,expected:subjects.length,evaluated:rows.length,rows},null,2));
   console.log(JSON.stringify({evaluated:rows.length,total:subjects.length,errors:rows.filter(r=>r.error).length}));
  }
 }
 fs.writeFileSync(path.join(dir,'economic-requests.json'),JSON.stringify(calls,null,2));
 console.log(JSON.stringify({done:true,apply,total:rows.length,persisted:rows.filter(r=>r.evaluationId).length,inconclusive:rows.filter(r=>r.memory?.result===null).length,errors:rows.filter(r=>r.error).length,mlMutations:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
