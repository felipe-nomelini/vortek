#!/usr/bin/env node
/** Auditoria pontual. Banco somente SELECT; Mercado Livre somente GET. Sem renovação de token ou escrita remota. */
const fs=require('node:fs'),path=require('node:path');
require('dotenv').config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const {resolvePreferredOfferForProduct}=require('../src/lib/preferred-offer.ts');
const {loadProductWarranty}=require('../src/services/product-warranty.ts');
const {warrantySaleTerms}=require('../src/lib/ml-sale-terms.ts');
const dir=path.resolve('reports/canon-comercial-v1-2026-09-05');fs.mkdirSync(dir,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
const db=createClient(process.env.SUPABASE_SERVICE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const checked=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data;};
async function all(table,columns){const rows=[];for(let n=0;;n+=1000){const batch=await checked(db.from(table).select(columns).order('id').range(n,n+999));rows.push(...batch);if(batch.length<1000)return rows;}}
const requests=[],failures=[];
(async()=>{
 const token=(await checked(db.from('integracoes').select('access_token').eq('tipo','mercadolivre').single())).access_token;
 async function ml(endpoint){const at=new Date().toISOString();try{const r=await fetch('https://api.mercadolibre.com'+endpoint,{method:'GET',headers:{Authorization:`Bearer ${token}`,'show-all-prices':'true'},signal:AbortSignal.timeout(20000)});const data=await r.json();requests.push({endpoint:endpoint.replace(/scroll_id=[^&]+/,'scroll_id=[cursor]'),method:'GET',status:r.status,at});if(!r.ok)failures.push({endpoint:requests.at(-1).endpoint,status:r.status});return {ok:r.ok,status:r.status,data:r.ok?data:null};}catch(e){failures.push({endpoint,status:null,error:e.name});return {ok:false,status:null,data:null};}}
 const me=await ml('/users/me');if(!me.ok)throw Error('Conta ML indisponível');
 const ids=new Set(),searchCoverage=[];
 for(const status of ['active','paused']){
  let scroll=null,total=null,complete=false;const found=new Set();
  for(let page=0;page<1000;page++){
   const result=await ml(`/users/${me.data.id}/items/search?search_type=scan&limit=100&status=${status}${scroll?'&scroll_id='+encodeURIComponent(scroll):''}`);
   if(!result.ok)break;total??=result.data?.paging?.total??null;
   const batch=result.data?.results??[];if(!batch.length){complete=true;break;}
   const before=found.size;for(const id of batch){ids.add(id);found.add(id);}if(found.size===before)break;
   scroll=result.data.scroll_id??scroll;if(!scroll){complete=total===found.size;break;}
  }
  searchCoverage.push({status,total,found:found.size,complete});
 }
 save('audit-search.json',{at:new Date().toISOString(),searchCoverage,ids:[...ids]});
 const [products,offers,suppliers,listings]=await Promise.all([
  all('produtos','id,sku,nome,gtin,marca,descricao,ativo,oferta_preferencial_id,fornecedor_preferencial_manual,ml_item_id'),
  all('produto_fornecedor_ofertas','id,produto_id,custo,estoque,ativo,dslite_fornecedor_id,descricao,updated_at'),
  all('fornecedores','id,dslite_id,ativo'),all('anuncios_ml','id,ml_item_id,produto_id,pricing_group_id,status')]);
 const active=new Set(suppliers.filter(s=>s.ativo===true).map(s=>String(s.dslite_id)));
 const productById=new Map(products.map(p=>[p.id,p])),byItem=new Map(listings.map(l=>[l.ml_item_id,l]));
 const bySku=new Map(products.map(p=>[p.sku,p]));const byDirect=new Map(products.filter(p=>p.ml_item_id).map(p=>[p.ml_item_id,p]));
 const offerByProduct=new Map();for(const o of offers){const rows=offerByProduct.get(o.produto_id)||[];rows.push({...o,ativo:o.ativo===true&&active.has(String(o.dslite_fornecedor_id))});offerByProduct.set(o.produto_id,rows);}
 const schemaCache=new Map(),warrantyCache=new Map(),rows=[];
 const list=[...ids];
 for(let offset=0;offset<list.length;offset+=4){
  const batch=await Promise.all(list.slice(offset,offset+4).map(async id=>{
   const [remote,prices]=await Promise.all([ml('/items/'+id),ml('/items/'+id+'/prices')]);
   if(!remote.ok)return {itemId:id,status:'INCONCLUSIVO',reason:'ITEM_ML_INDISPONIVEL',pricesRead:prices.ok};
   const item=remote.data,link=byItem.get(id),p=productById.get(link?.produto_id)||byDirect.get(id)||bySku.get(item.seller_custom_field);
   let resolved={status:'pending',reason:'VINCULO_LOCAL_INCONCLUSIVO'},warranty=null;
   if(p){
    if(!warrantyCache.has(p.id)){
     const offer=resolvePreferredOfferForProduct(offerByProduct.get(p.id)||[],p.oferta_preferencial_id,p.fornecedor_preferencial_manual===true);
     warrantyCache.set(p.id,loadProductWarranty(db,p,offer));
    }
    warranty=await warrantyCache.get(p.id);resolved=warranty.resolution;
   }
   if(!schemaCache.has(item.category_id))schemaCache.set(item.category_id,ml(`/categories/${item.category_id}/sale_terms`));
   const schema=await schemaCache.get(item.category_id);
   let expected=null,pending=resolved.status==='pending'?resolved.reason:null;
   if(resolved.status==='resolved')try{if(!schema.ok)throw Error('CONTRATO_CATEGORIA_INDISPONIVEL');expected=warrantySaleTerms(resolved,schema.data);}catch(e){pending=e.message;}
   const observed=(item.sale_terms||[]).filter(t=>['WARRANTY_TYPE','WARRANTY_TIME'].includes(t.id));
   const matches=expected&&expected.every(e=>observed.some(o=>o.id===e.id&&(e.value_id?String(o.value_id)===e.value_id:o.value_name===e.value_name)));
   const tiers=prices.ok?[...(prices.data.prices||[]).filter(p=>Number(p.conditions?.min_purchase_unit)>1||(p.conditions?.context_restrictions||[]).includes('user_type_business')),...(prices.data.price_per_quantity||[])]:null;
   return {itemId:id,sku:p?.sku??null,productId:p?.id??null,title:item.title,status:item.status,categoryId:item.category_id,pricingGroupId:link?.pricing_group_id??null,catalogListing:item.catalog_listing,price:item.price,warranty:{observed,resolved,expected,evidence:warranty?.evidence??[],pending,action:pending?'VALIDAR_EVIDENCIA':matches?'MANTER':'CORRIGIR_APOS_AUTORIZACAO',unsupportedTwelveMonths:observed.some(t=>t.id==='WARRANTY_TIME'&&t.value_name==='12 meses')&&resolved.status==='pending'},quantityPricing:{read:prices.ok,tiers,action:!prices.ok?'INCONCLUSIVO':tiers.length?'REMOVER_APOS_AUTORIZACAO':'SEM_DESCONTO_OBSERVADO'},pricing:{action:'SEM_ALTERACAO',source:'AUTORIA_NAO_INFERIDA_DO_PRECO'},at:new Date().toISOString()};
  }));rows.push(...batch);
  if(rows.length%100===0||rows.length===list.length){save('audit-existing.json',{at:new Date().toISOString(),mlMutations:0,dbMutations:0,searchCoverage,expected:list.length,evaluated:rows.length,rows,failures});console.log(JSON.stringify({evaluated:rows.length,total:list.length,failures:failures.length}));}
 }
 save('audit-requests.json',requests);
 const counts={};for(const row of rows){const k=row.warranty?.action??'INCONCLUSIVO';counts[k]=(counts[k]??0)+1;}
 save('audit-summary.json',{at:new Date().toISOString(),mlMutations:0,dbMutations:0,searchCoverage,expected:list.length,evaluated:rows.length,warranty:counts,quantityPricing:rows.filter(r=>r.quantityPricing?.tiers?.length).length,failedRequests:failures.length});
 console.log('READ_ONLY_AUDIT_FINISHED');
})().catch(e=>{save('audit-error.json',{at:new Date().toISOString(),error:e.message,requests,failures});console.error(e.message);process.exitCode=1});
