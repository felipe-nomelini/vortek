/** Reprocessamento determinístico somente com o universo/evidências existentes. Nenhuma chamada ML. */
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const XLSX=require('xlsx');
const {evaluateEconomics,calculateSuggestedPrice,calculateExactMarginPrice,calculateBreakEvenPrice,priceBand,money}=require('../src/services/pricing.ts');
const {estimateTaxForRbt12}=require('../src/services/pricing-tax.ts');
const {resolvePreferredOfferForProduct}=require('../src/lib/preferred-offer.ts');
const {assessOpportunityConflicts,radarClassification,radarPriority}=require('../src/lib/ml/opportunity-conflicts.ts');
const {identityFacts,supplierIdentityFacts}=require('../src/lib/ml/opportunity-identity.ts');
const root=path.resolve(__dirname,'../reports/oportunidades-ml-2026-09-05');const dest=path.resolve(process.env.M2M_REPORT_DIR ?? path.join(__dirname,'../reports/m2m-pricing-radar-2026-09-05'));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const base=read('base.json'),candidates=read('candidatos-base.json'),revision=read('revisao-precos.json'),oldFinal=read('resultado-final.json'),account=read('conta-ml.json'),identityReview=read('revisao-identidade.json');
const asOf=process.env.M2M_AS_OF||revision.at;
const reviewed=new Map(revision.results.map(r=>[r.sku,r]));const old=new Map(oldFinal.rows.map(r=>[r.sku,r]));const activeSuppliers=new Set(base.suppliers.filter(s=>s.ativo===true).map(s=>s.dslite_id));
// base.orders contém somente a janela recente: não reconstruir meses ausentes como zero.
const tax={rate:estimateTaxForRbt12(base.tax.rbt12),status:'estimated',referenceMonth:base.tax.referenceMonth,source:'RBT12_AUDITADO',rbt12:base.tax.rbt12,observedAt:base.at,evidence:'oportunidades-ml-2026-09-05/base.json:tax',missingMonths:[]};
const amount=(value,source,evidence,observedAt)=>({amount:Number.isFinite(value)?value:null,source,observedAt:observedAt??null,evidence});
const remoteById=new Map(account.remote.map(item=>[item.id,item]));
const rows=[],payload=[];let rescued=0;
for(const candidate of candidates){
 const p=candidate.product,r=reviewed.get(p.sku),before=old.get(p.sku);let market=null;try{market=read(`mercado/${p.sku}.json`);}catch(e){if(e.code!=='ENOENT')throw e;}
 const offers=candidate.offers.map(o=>({...o,ativo:o.ativo===true&&activeSuppliers.has(o.dslite_fornecedor_id)}));const offer=resolvePreferredOfferForProduct(offers,p.oferta_preferencial_id,p.fornecedor_preferencial_manual===true);
 const catalog=r?.catalog??market?.catalog;const catalogData=catalog?.data??catalog;
 const remoteFacts=identityFacts(catalogData?.attributes??[],{title:catalogData?.name??catalogData?.title,source:`mercado/${p.sku}.json`});const localFacts=supplierIdentityFacts(offer??p,remoteFacts);
 const identity={local:localFacts,remote:remoteFacts,source:catalogData?`mercado/${p.sku}.json`:null};
 const evidenceReview=identityReview.coerentes[p.sku]??identityReview.pendentes[p.sku]??null;
 // Texto de revisão permanece como evidência; não preenche atributos ausentes automaticamente.
 const competitive=Number(before?.preco_concorrente||r?.reference?.price||market?.reference?.price)||null;
 const quotes=r?.quotes??[];const observed=quotes.find(q=>q.price===competitive)??quotes.at(-1)??market?.suggested??null;
 let feeDetails=observed?.fees?.data?.sale_fee_details;const feeRate=typeof feeDetails?.percentage_fee==='number'?feeDetails.percentage_fee/100:null;const fixedFee=typeof feeDetails?.fixed_fee==='number'?feeDetails.fixed_fee:null;
 const shipping=observed?.ship?.data?.coverage?.all_country?.list_cost??observed?.shipping;
 const economic=(price)=>{
  const exact=quotes.find(q=>q.price===price);
  const fee=exact?.fees?.data?.sale_fee_amount??(feeRate!==null&&fixedFee!==null?money(price*feeRate+fixedFee):null);
  const freight=exact?.ship?.data?.coverage?.all_country?.list_cost??shipping;
  return evaluateEconomics({price,cost:offer?.custo??null,offerId:offer?.id??null,supplierId:offer?.dslite_fornecedor_id??null,costObservedAt:offer?.last_sync_at??null,
    fee:amount(fee,exact?'ml_observed':'fallback',exact?.fees?.endpoint??`revisao-precos.json:${p.sku}:projecao_tarifa`,exact?.fees?.at??observed?.fees?.at),
    shipping:amount(freight,exact?'ml_observed':'fallback',exact?.ship?.endpoint??`revisao-precos.json:${p.sku}:frete_requer_recotacao`,exact?.ship?.at??observed?.ship?.at),
    variableCosts:amount(null,'unknown',null),tax,evaluatedAt:asOf});
 };
 let target=null,floor=null,breakEven=null;
 if(offer&&feeRate!==null&&fixedFee!==null&&Number.isFinite(shipping)&&tax.rate!==null){
  const params={cost:offer.custo,shipping,mlFee:feeRate,fixedFee,taxRate:tax.rate};
  target=economic(calculateSuggestedPrice(params).suggestedPrice);breakEven=economic(calculateBreakEvenPrice(params));
  const floors=[];for(const band of require('../src/services/pricing-policy.ts').PRICING_POLICY.bands){const price=calculateExactMarginPrice({...params,margin:band.floor});if(priceBand(price).id===band.id)floors.push(price);}
  if(floors.length)floor=economic(Math.min(...floors));
 }
 const competitiveMemory=competitive?economic(competitive):null;
 const matches=new Map((candidate.linked??[]).map(l=>[l.ml_item_id,l]));for(const item of account.remote){const sku=item.seller_custom_field??item.attributes?.find(a=>a.id==='SELLER_SKU')?.value_name;if(sku===p.sku||item.id===p.ml_item_id||(catalogData?.id&&item.catalog_product_id===catalogData.id))matches.set(item.id,{ml_item_id:item.id,status:item.status});}
 const listings=[...matches.values()].map(l=>{const live=remoteById.get(l.ml_item_id);return{itemId:l.ml_item_id,status:live?.status??l.status,pricingGroupId:`item:${l.ml_item_id}`,synchronized:false,source:live?'conta-ml.json':'base.json',observedAt:live?account.at:base.at};});
 const assessment=assessOpportunityConflicts({identity,listings,listingSearchComplete:account.expected===account.scanned,economy:competitiveMemory??target,buyBox:!!competitive,eligibleOffer:!!offer&&p.ativo===true});
 const demand=(candidate.sales90??0)>0?'HISTORICO_PROPRIO':before?.demanda?.includes('RANKING')?'RANKING_ML':before?.demanda?.includes('INDIRETO')?'SINAL_INDIRETO':'SEM_EVIDENCIA_DE_DEMANDA';
 const stock=offer?.estoque??0;const classification=radarClassification(assessment,demand,stock,false);const priority=radarPriority({assessment,demand,contribution:competitiveMemory?.result??target?.result??null,stock,publicationComplete:false,competitivePrice:competitive});
 const restored=!!r&&r.classification==='FORA_DO_PISO_COMPETITIVO'&&competitiveMemory?.margin>=competitiveMemory?.band?.floor&&competitiveMemory.margin<.10;if(restored)rescued++;
 rows.push({sku:p.sku,produto:p.nome,fornecedor:base.suppliers.find(s=>s.dslite_id===offer?.dslite_fornecedor_id)?.nome??null,custo:offer?.custo??null,estoque:stock,revisado_65:!!r,anterior:r?.classification??before?.viavel_comercialmente??null,fila:classification.queue,etapa:classification.stage,identidade:assessment.identity,conflito:assessment.state,economia:assessment.economy,demanda: demand,preco_competitivo:competitive,preco_piso:floor?.price??null,preco_alvo:target?.price??null,break_even:breakEven?.price??null,margem_competitiva_pct:competitiveMemory?.margin==null?null:competitiveMemory.margin*100,contribuicao:competitiveMemory?.result??null,tributo_pct:tax.rate*100,tributo_status:tax.status,recuperado_piso_10:restored,motivos:assessment.reasons.join('; '),avisos:(assessment.warnings??[]).join('; '),revisao_identidade_previa:evidenceReview,recomendacao:classification.recommendation,fonte:identity.source,avaliado_em:asOf});
 payload.push({produto_id:p.id,candidate_key:`product:${p.id}`,sku:p.sku,catalog_product_id:catalogData?.id??before?.catalogo_ml??null,pricing_group_id:listings[0]?.pricingGroupId??null,...classification,conflict_state:assessment.state,assessment,evidence:{product:p.nome,supplier:offer?.fornecedor_nome??rows.at(-1).fornecedor,cost:offer?.custo??null,identity,identityReview:evidenceReview,competitivePrice:competitive,demand,listingType:market?.listingType??'gold_special',source:'oportunidades-ml-2026-09-05',asOf},priority,input_fingerprint:crypto.createHash('sha256').update(JSON.stringify({p,offer,assessment})).digest('hex'),stock,demand_rank:priority.demandRank,contribution:competitiveMemory?.result??null,memories:{competitive:competitiveMemory,target,floor,break_even:breakEven},product:p,offer});
}
const queueOrder=['ALTA_PRIORIDADE','PRONTOS_PARA_ANALISE','REATIVACOES','EXPLORATORIOS','PENDENCIAS_IDENTIDADE','REVISAR','INCONCLUSIVOS','CONFLITOS','ECONOMICAMENTE_INVIAVEIS','JA_ANUNCIADOS'];
const demandOrder=['HISTORICO_PROPRIO','RANKING_ML','SINAL_INDIRETO','SEM_EVIDENCIA_DE_DEMANDA'];
rows.sort((a,b)=>queueOrder.indexOf(a.fila)-queueOrder.indexOf(b.fila)||demandOrder.indexOf(a.demanda)-demandOrder.indexOf(b.demanda)||(b.contribuicao??-Infinity)-(a.contribuicao??-Infinity)||b.estoque-a.estoque||a.sku.localeCompare(b.sku));
fs.mkdirSync(dest,{recursive:true});const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Universo');XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows.filter(r=>r.revisado_65)),'65 revisados');XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows.filter(r=>r.fila==='REATIVACOES')),'Reativacoes');XLSX.writeFile(workbook,path.join(dest,'06_REPROCESSAMENTO_OPORTUNIDADES.xlsx'));
fs.writeFileSync(path.join(dest,'06_REPROCESSAMENTO_OPORTUNIDADES.csv'),XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows)));
fs.writeFileSync(path.join(dest,'06_memorias.json'),JSON.stringify(payload));
const counts=rows.reduce((a,r)=>(a[r.fila]=(a[r.fila]??0)+1,a),Object.fromEntries(queueOrder.map(q=>[q,0])));const summary={asOf,universe:rows.length,reviewed:rows.filter(r=>r.revisado_65).length,recoveredBelow10:rescued,queues:counts,tax,mlRequests:0,remoteMutations:0,scope:'Reclassificação das evidências existentes; aprovação exige cotação viva e validação de pendências'};
fs.writeFileSync(path.join(dest,'06_impacto.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
