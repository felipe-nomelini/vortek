/** Importa somente o reprocessamento local; não cria/edita anúncio nem envia mensagens. */
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');require('dotenv').config({path:'.env.local',quiet:true});const {createClient}=require('@supabase/supabase-js');
const apply=process.argv.includes('--apply');const source=path.resolve(__dirname,'../reports/m2m-pricing-radar-2026-09-05/06_memorias.json');const rows=JSON.parse(fs.readFileSync(source,'utf8'));const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
if(!apply){console.log(JSON.stringify({mode:'preview',rows:rows.length,evaluations:rows.reduce((n,r)=>n+Object.values(r.memories).filter(Boolean).length,0),sourceHash:hash(rows),mlMutations:0}));process.exit(0);}
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function checked(p){const r=await p;if(r.error)throw new Error(r.error.message);return r.data;}
(async()=>{
 const dedupe=`m2m-radar-import:${hash(rows)}`;let job=await checked(db.from('jobs').select('id,status,log').eq('dedupe_key',dedupe).maybeSingle());
 if(job?.status==='completo'){console.log(JSON.stringify({status:'already_imported',jobId:job.id,rows:rows.length}));return;}
 if(!job)job=await checked(db.from('jobs').insert({tipo:'sync_ml_radar',status:'pendente',dedupe_key:dedupe,log:[]}).select('id,status,log').single());
 const owner=`m2m-import:${crypto.randomUUID()}`;const locked=await checked(db.rpc('acquire_sync_domain_lock',{p_domain:'radar:ml',p_owner_task:'m2m_import',p_owner_token:owner,p_owner_job_id:job.id,p_ttl_seconds:300,p_metadata:{sourceHash:hash(rows)}}));if(!locked)throw new Error('RADAR_LOCK_BUSY');
 try{
  const logs=Array.isArray(job.log)?job.log:[];const previous=[...logs].reverse().find(x=>x.event==='radar_checkpoint')?.payload;let processed=Number(previous?.processed??0);const startedAt=new Date().toISOString();
  for(let offset=processed;offset<rows.length;offset+=50){
   const slice=rows.slice(offset,offset+50);const entries=[];
   for(const row of slice)for(const [scenario,memory] of Object.entries(row.memories)){
    if(!memory)continue;entries.push({produto_id:row.produto_id,ml_item_id:null,pricing_group_id:row.pricing_group_id,scenario,fingerprint:hash({source:'m2m_reprocess',product:row.produto_id,scenario,memory}),policy_version:memory.policyVersion,product_version:row.product.updated_at,offer_id:row.offer?.id??null,offer_version:row.offer?.updated_at??row.offer?.last_sync_at??null,memory,price:memory.price,result:memory.result,margin:memory.margin,status:memory.status,evaluated_at:memory.evaluatedAt,valid_until:new Date(Date.parse(memory.evaluatedAt)+86400000).toISOString(),job_id:job.id});
   }
   const existing=entries.length?await checked(db.from('pricing_evaluations').select('id,fingerprint').in('fingerprint',entries.map(e=>e.fingerprint))):[];
   const byHash=new Map(existing.map(e=>[e.fingerprint,e.id]));const missing=entries.filter(e=>!byHash.has(e.fingerprint));
   if(missing.length)for(const e of await checked(db.from('pricing_evaluations').insert(missing).select('id,fingerprint')))byHash.set(e.fingerprint,e.id);
   const batch=slice.map(row=>{
    const ids={};for(const [scenario,memory] of Object.entries(row.memories))if(memory)ids[scenario]=byHash.get(hash({source:'m2m_reprocess',product:row.produto_id,scenario,memory}));
    const {memories,product,offer,...candidate}=row;return {...candidate,evaluation_id:ids.competitive??ids.target??null,target_evaluation_id:ids.target??null,floor_evaluation_id:ids.floor??null,break_even_evaluation_id:ids.break_even??null};
   });
   processed+=batch.length;await checked(db.rpc('save_radar_batch',{p_job_id:job.id,p_owner_token:owner,p_rows:batch,p_checkpoint:{startedAt,processed,complete:processed===rows.length,lastId:null,sourceHash:hash(rows)}}));
  }
  console.log(JSON.stringify({status:'imported',jobId:job.id,rows:processed,sourceHash:hash(rows),mlMutations:0}));
 }finally{await checked(db.rpc('release_sync_domain_lock',{p_domain:'radar:ml',p_owner_token:owner,p_force:false}));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
