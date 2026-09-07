const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyListingLinks } = require('../src/lib/ml/listing-link.ts');
const { classifyCommercialConflicts } = require('../src/services/commercial-conflicts.ts');
const proof = reference => ({ source: 'mercado_livre', reference, collectedAt: '2026-09-07T00:00:00.000Z', condition: 'valid' });
function candidate(itemId='MLB1', extra={}) {
  return { itemId, variationId: '', catalog: false, sellerId: 1, productId: 'P1', status: 'active', identity: 'complete', relations: [], sync: { status: 'UNKNOWN', relations: [] }, evidence: proof(itemId), ...extra };
}
function classify(candidates=[], extra={}) {
  return classifyListingLinks({ sellerId:1, productId:'P1', candidates, complete:true, searchEvidence:[proof('search')], ...extra });
}
function pair() {
  return [candidate('MLB1', { relations:[{ itemId:'MLB2', variationId:'' }], sync:{ status:'SYNC', relations:['MLB2'], evidence:proof('sync1') } }),
    candidate('MLB2', { catalog:true, relations:[{ itemId:'MLB1', variationId:'' }], sync:{ status:'SYNC', relations:['MLB1'], evidence:proof('sync2') } })];
}
test('busca completa vazia é candidato novo, não autorização comercial', () => {
  const r=classify(); assert.equal(r.classification,'NOVO_ANUNCIO_CANDIDATO'); assert.equal(r.groups.length,0);
  const aggregate=classifyCommercialConflicts({listing_link:r.listing_link}); assert.notEqual(aggregate.status,'SEM_CONFLITO');
});
test('ativo e pausado possuem filas distintas; ativo vence pausado', () => {
  assert.equal(classify([candidate()]).classification,'JA_ANUNCIADO_ATIVO');
  assert.equal(classify([candidate('MLB1',{status:'paused'})]).classification,'REATIVACAO_CANDIDATA');
  assert.equal(classify([candidate(),candidate('MLB2',{status:'paused'})]).classification,'JA_ANUNCIADO_ATIVO');
});
for (const status of ['closed','under_review','inactive','deleted','']) test(`histórico ${status || 'desconhecido'} não autoriza recriação`,()=>assert.equal(classify([candidate('MLB1',{status})]).classification,'VINCULO_INCONCLUSIVO'));
for (const extra of [{complete:false},{searchEvidence:[]},{searchEvidence:[{...proof('search'),condition:'stale'}]}]) test('ausência não é prova quando a busca está incompleta',()=>assert.equal(classify([],extra).classification,'VINCULO_INCONCLUSIVO'));
for (const extra of [{sellerId:2},{productId:'P2'},{identity:'conflict'},{identity:'pending'},{evidence:{...proof('x'),condition:'stale'}}]) test('vendedor, propriedade e identidade são obrigatórios',()=>assert.equal(classify([candidate('MLB1',extra)]).classification,'VINCULO_INCONCLUSIVO'));
test('par comprovado é uma unidade e não conflito para manutenção',()=>{
  const r=classify(pair());assert.equal(r.groups.length,1);assert.equal(r.groups[0].synchronized,true);assert.equal(r.groups[0].anchorItemId,'MLB1');
  assert.equal(r.listing_link.status,'SEM_CONFLITO');assert.equal(r.classification,'JA_ANUNCIADO_ATIVO');assert.equal(r.groups[0].evidence.length,4);
});
test('ordem de chegada não altera composição',()=>assert.deepEqual(classify(pair()),classify(pair().reverse())));
test('membro espelho encerrado mantém o conjunto inconclusivo em qualquer ordem',()=>{
  const items=pair();items[1].status='closed';
  assert.equal(classify(items).classification,'VINCULO_INCONCLUSIVO');
  assert.deepEqual(classify(items),classify(items.reverse()));
});
test('anúncios independentes do mesmo produto não são fundidos',()=>{
  const r=classify([candidate(),candidate('MLB2',{catalog:true})]);assert.equal(r.groups.length,2);assert.ok(r.groups.every(g=>!g.synchronized));
});
test('UNSYNC bilateral comprovado separa grupos',()=>{
  const items=pair();items.forEach(i=>i.sync.status='UNSYNC');const r=classify(items);assert.equal(r.coverage,'complete');assert.equal(r.groups.length,2);
});
for(const mode of ['unknown','one_unsync','missing_proof','wrong_relation','wrong_type','extra_relation']) test(`relação insuficiente (${mode}) não é sincronismo`,()=>{
  const items=pair();if(mode==='unknown')items[0].sync.status='UNKNOWN';
  if(mode==='one_unsync')items[0].sync.status='UNSYNC';if(mode==='missing_proof')delete items[0].sync.evidence;
  if(mode==='wrong_relation')items[0].sync.relations=['MLB9'];if(mode==='wrong_type')items[1].catalog=false;
  if(mode==='extra_relation')items[0].relations.push({itemId:'MLB9',variationId:''});
  const r=classify(items);assert.equal(r.classification,'VINCULO_INCONCLUSIVO');assert.ok(r.groups.every(g=>!g.synchronized));
});
test('variação correspondente é preservada no grupo',()=>{
  const items=pair();items[0].variationId='V1';items[0].relations[0].variationId='V1';items[1].relations[0].variationId='V1';
  const r=classify(items);assert.equal(r.groups.length,1);assert.equal(r.groups[0].anchorVariationId,'V1');
  items[1].relations[0].variationId='V2';assert.equal(classify(items).classification,'VINCULO_INCONCLUSIVO');
});
