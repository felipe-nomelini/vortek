/** Reclassifica os 65 auditados sem substituir memórias econômicas ou reativar anúncios. */
const fs=require('node:fs'),crypto=require('node:crypto');require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');const {assessOpportunityConflicts,radarClassification,radarPriority}=require('../src/lib/ml/opportunity-conflicts.ts');const {IDENTITY_RULE_VERSION}=require('../src/lib/ml/identity-normalization.ts');const {identityFacts,supplierIdentityFacts}=require('../src/lib/ml/opportunity-identity.ts');
const input=JSON.parse(fs.readFileSync('reports/RADAR_LAUNCH_2026_09_COHORT_01/baseline_live.json','utf8'));const apply=process.argv.includes('--apply');
const supplements=JSON.parse(fs.readFileSync('reports/RADAR_LAUNCH_2026_09_COHORT_01/identity_supplements.json','utf8'));
const account=JSON.parse(fs.readFileSync('reports/RADAR_LAUNCH_2026_09_COHORT_01/account_live.json','utf8'));
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function checked(p){const r=await p;if(r.error)throw Error(r.error.message);return r.data;}
(async()=>{
 const startedAt=new Date().toISOString();
 const rows=await checked(db.from('radar_oportunidades').select('*').in('sku',input.results.map(r=>r.sku)));const ids=rows.map(r=>r.evaluation_id).filter(Boolean);const memories=await checked(db.from('current_pricing_evaluations').select('id,memory').in('id',ids));const byId=new Map(memories.map(m=>[m.id,m.memory]));
 const updates=rows.map(row=>{const fresh=input.results.find(r=>r.sku===row.sku);const old=byId.get(row.evaluation_id);const memory=old&&Number(old.cost)===Number(fresh.offer?.custo)?old:null;
  const remote=identityFacts(fresh.catalog?.attributes??[],{title:fresh.catalog?.name,source:fresh.identity.source});
  const identity={...fresh.identity,remote,local:supplierIdentityFacts(fresh.offer??fresh.product,remote,supplements[row.sku])};
  const matches=account.items.filter(item=>item.seller_custom_field===row.sku||item.attributes?.some(a=>a.id==='SELLER_SKU'&&a.value_name===row.sku)||item.id===fresh.product.ml_item_id||(fresh.catalog?.id&&item.catalog_product_id===fresh.catalog.id)||(fresh.offer?.gtin&&item.attributes?.some(a=>a.id==='GTIN'&&a.value_name===fresh.offer.gtin)));
  const listings=matches.map(item=>({itemId:item.id,status:item.status,pricingGroupId:row.assessment.listings.find(l=>l.itemId===item.id)?.pricingGroupId??`item:${item.id}`,synchronized:row.assessment.listings.find(l=>l.itemId===item.id)?.synchronized??false,source:'ML_ACCOUNT_LIVE',observedAt:account.at}));
  const assessment=assessOpportunityConflicts({identity,listings,listingSearchComplete:account.complete===true,economy:memory,buyBox:!!row.evidence.competitivePrice,eligibleOffer:fresh.product.ativo&&!!fresh.offer&&fresh.offer.estoque>0});
  const stock=Number(fresh.offer?.estoque??0),demand=row.priority.demand,complete=!!fresh.product.ncm&&Array.isArray(fresh.product.imagens)&&fresh.product.imagens.length>0&&assessment.identity==='IDENTIDADE_COHERENTE';
  const classification=radarClassification(assessment,demand,stock,complete);
  if(['VALIDADO','PUBLICADO_EXPERIMENTO','REJEITADO'].includes(row.stage))classification.stage='REVISAR';
  return {...row,...classification,assessment,conflict_state:assessment.state,evidence:{...row.evidence,identity,identitySupplement:supplements[row.sku]??row.evidence.identitySupplement,identityObservedAt:fresh.observedAt},priority:radarPriority({assessment,demand,contribution:memory?.result??null,stock,publicationComplete:complete,competitivePrice:row.evidence.competitivePrice}),stock,input_fingerprint:hash({identityRuleVersion:IDENTITY_RULE_VERSION,identity,supplement:supplements[row.sku],accountObservedAt:account.at})};
 });
 const summary={rows:updates.length,states:updates.reduce((a,r)=>(a[r.conflict_state]=(a[r.conflict_state]??0)+1,a),{}),mlMutations:0};
 fs.writeFileSync('reports/m2m-identity-correction-2026-09-05/reclassification_preview.json',JSON.stringify(updates,null,2));
 if(apply&&!fs.existsSync('reports/m2m-identity-correction-2026-09-05/reclassification_baseline.json'))fs.writeFileSync('reports/m2m-identity-correction-2026-09-05/reclassification_baseline.json',JSON.stringify(rows,null,2));
 if(!apply){console.log(JSON.stringify({mode:'preview',...summary}));return;}
 const dedupe='identity-reclassification:'+IDENTITY_RULE_VERSION+':'+hash({inputs:input.results.map(r=>({sku:r.sku,identity:r.identity})),supplements,accountAt:account.at});
 let job=await checked(db.from('jobs').select('id,status').eq('dedupe_key',dedupe).maybeSingle());if(job?.status==='completo'){console.log(JSON.stringify({status:'already_applied',jobId:job.id,...summary}));return;}
 if(!job)job=await checked(db.from('jobs').insert({tipo:'sync_ml_radar',status:'pendente',dedupe_key:dedupe,log:[]}).select('id').single());
 const owner=crypto.randomUUID();const locked=await checked(db.rpc('acquire_sync_domain_lock',{p_domain:'radar:ml',p_owner_task:'identity_reclassification',p_owner_token:owner,p_owner_job_id:job.id,p_ttl_seconds:300,p_metadata:{identityRuleVersion:IDENTITY_RULE_VERSION}}));if(!locked)throw Error('RADAR_LOCK_BUSY');
 try{const current=await checked(db.from('radar_oportunidades').select('id,updated_at').in('id',rows.map(r=>r.id)));if(current.some(r=>r.updated_at!==rows.find(old=>old.id===r.id)?.updated_at))throw Error('RADAR_BASELINE_CHANGED');for(let offset=0;offset<updates.length;offset+=50){const batch=updates.slice(offset,offset+50);await checked(db.rpc('save_radar_batch',{p_job_id:job.id,p_owner_token:owner,p_rows:batch,p_checkpoint:{startedAt,processed:offset+batch.length,complete:offset+batch.length===updates.length,identityRuleVersion:IDENTITY_RULE_VERSION}}));}console.log(JSON.stringify({status:'applied',jobId:job.id,...summary}));}
 finally{await checked(db.rpc('release_sync_domain_lock',{p_domain:'radar:ml',p_owner_token:owner,p_force:false}));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
