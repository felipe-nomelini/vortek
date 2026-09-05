/** Reclassifica os 65 auditados sem substituir memórias econômicas ou reativar anúncios. */
const fs=require('node:fs'),crypto=require('node:crypto');require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');const {assessOpportunityConflicts,radarClassification,radarPriority}=require('../src/lib/ml/opportunity-conflicts.ts');const {IDENTITY_RULE_VERSION}=require('../src/lib/ml/identity-normalization.ts');
const input=JSON.parse(fs.readFileSync('reports/RADAR_LAUNCH_2026_09_COHORT_01/baseline_live.json','utf8'));const apply=process.argv.includes('--apply');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function checked(p){const r=await p;if(r.error)throw Error(r.error.message);return r.data;}
(async()=>{
 const rows=await checked(db.from('radar_oportunidades').select('*').in('sku',input.results.map(r=>r.sku)));const ids=rows.map(r=>r.evaluation_id).filter(Boolean);const memories=await checked(db.from('current_pricing_evaluations').select('id,memory').in('id',ids));const byId=new Map(memories.map(m=>[m.id,m.memory]));
 const updates=rows.map(row=>{const fresh=input.results.find(r=>r.sku===row.sku);const old=byId.get(row.evaluation_id);const memory=old&&Number(old.cost)===Number(fresh.offer?.custo)?old:null;
  const assessment=assessOpportunityConflicts({identity:fresh.identity,listings:row.assessment.listings,listingSearchComplete:row.assessment.listing!=='VINCULO_INCONCLUSIVO',economy:memory,buyBox:!!row.evidence.competitivePrice,eligibleOffer:fresh.product.ativo&&!!fresh.offer&&fresh.offer.estoque>0});
  const stock=Number(fresh.offer?.estoque??0),demand=row.priority.demand,complete=false;
  const classification=radarClassification(assessment,demand,stock,complete);
  if(['VALIDADO','PUBLICADO_EXPERIMENTO','REJEITADO'].includes(row.stage))classification.stage='REVISAR';
  return {...row,...classification,assessment,conflict_state:assessment.state,evidence:{...row.evidence,identity:fresh.identity,identityObservedAt:fresh.observedAt},priority:radarPriority({assessment,demand,contribution:memory?.result??null,stock,publicationComplete:complete,competitivePrice:row.evidence.competitivePrice}),stock,input_fingerprint:hash({previous:row.input_fingerprint,identityRuleVersion:IDENTITY_RULE_VERSION,identity:fresh.identity})};
 });
 const summary={rows:updates.length,states:updates.reduce((a,r)=>(a[r.conflict_state]=(a[r.conflict_state]??0)+1,a),{}),mlMutations:0};
 if(!apply){console.log(JSON.stringify({mode:'preview',...summary}));return;}
 const dedupe='identity-reclassification:'+IDENTITY_RULE_VERSION+':'+hash(input.results.map(r=>({sku:r.sku,identity:r.identity})));
 let job=await checked(db.from('jobs').select('id,status').eq('dedupe_key',dedupe).maybeSingle());if(job?.status==='completo'){console.log(JSON.stringify({status:'already_applied',jobId:job.id,...summary}));return;}
 if(!job)job=await checked(db.from('jobs').insert({tipo:'sync_ml_radar',status:'pendente',dedupe_key:dedupe,log:[]}).select('id').single());
 const owner=crypto.randomUUID();const locked=await checked(db.rpc('acquire_sync_domain_lock',{p_domain:'radar:ml',p_owner_task:'identity_reclassification',p_owner_token:owner,p_owner_job_id:job.id,p_ttl_seconds:300,p_metadata:{identityRuleVersion:IDENTITY_RULE_VERSION}}));if(!locked)throw Error('RADAR_LOCK_BUSY');
 try{for(let offset=0;offset<updates.length;offset+=50){const batch=updates.slice(offset,offset+50);await checked(db.rpc('save_radar_batch',{p_job_id:job.id,p_owner_token:owner,p_rows:batch,p_checkpoint:{startedAt:input.at,processed:offset+batch.length,complete:offset+batch.length===updates.length,identityRuleVersion:IDENTITY_RULE_VERSION}}));}console.log(JSON.stringify({status:'applied',jobId:job.id,...summary}));}
 finally{await checked(db.rpc('release_sync_domain_lock',{p_domain:'radar:ml',p_owner_token:owner,p_force:false}));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
