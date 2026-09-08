const test=require('node:test'),assert=require('node:assert/strict');
const {compareIdentityBrands,findModelEvidence}=require('../src/lib/ml/identity-normalization.ts');
const {identityFacts,supplierIdentityFacts,presentationFacts}=require('../src/lib/ml/opportunity-identity.ts');
const {assessIdentity,assessOpportunityConflicts}=require('../src/lib/ml/opportunity-conflicts.ts');
const {assessMlListingIdentity,shouldPauseMlListingForIdentityConflicts}=require('../src/lib/ml-listing-identity.ts');
const {evaluateEconomics}=require('../src/services/pricing.ts');
const a=(id,value_name)=>({id,value_name});
test('equivalências documentadas funcionam no Radar e na leitura posterior, sem renomear cadastro',()=>{
 for(const [left,right] of [['LESON','Le Son'],['C3 TECH','C3Tech'],['ROADSTAR BRASIL','Roadstar'],['MULTILASER','Multi'],['SOHOPLUS - FURUKAWA','Furukawa'],['FURUKAWA SOHOPLUS','Furukawa']]){
  const e={local:{brand:left,model:'A1'},remote:{brand:right,model:'A1'},source:'supplier+ml'};
  assert.equal(assessIdentity(e).identity,'IDENTIDADE_COHERENTE');
  const readback=assessMlListingIdentity({attributes:[a('BRAND',right)]},{brand:left});assert.equal(readback.blockingConflicts.length,0);assert.equal(readback.canonicalBrand,null);
 }
 assert.equal(compareIdentityBrands('Acme','Outra').matches,false);
});
test('NWT/Storm exige declaração da oferta; relação desconhecida não é conflito confirmado',()=>{
 const brandEvidence='Marca: NWT (Storm Tech) Modelo: CBHM0028';
 assert.equal(compareIdentityBrands('NWT','Storm',brandEvidence).matches,true);
 assert.equal(compareIdentityBrands('NWT','Storm').matches,false);
 assert.equal(shouldPauseMlListingForIdentityConflicts({status:'active'},assessMlListingIdentity({attributes:[a('BRAND','Storm')]},{brand:'NWT'}).blockingConflicts),false);
 assert.equal(assessIdentity({local:{brand:'NWT',model:'X1'},remote:{brand:'Storm',model:'X1'},source:'supplier+ml'}).identity,'IDENTIDADE_INCONCLUSIVA');
 assert.equal(assessMlListingIdentity({attributes:[a('BRAND','Storm')]},{brand:'NWT',brandEvidence}).blockingConflicts.length,0);
});
test('modelos normalizam separadores e preservam sufixos, tamanho do código e variantes',()=>{
 for(const [r,t] of [['CP 130','Cooler CP-130 Rainbow'],['VSF 112','Attack VSF112'],['100-G','Antena 100/g'],['CX50 BK','Bravox CX50BK'],['GEEBRS-6','Giannini GEEBRS/6']]) assert.ok(findModelEvidence(r,t),r);
 for(const t of ['Cooler CP-1300','Cooler CP-130A','Cooler CP-130/A'])assert.equal(findModelEvidence('CP130',t),null,t);
 assert.equal(supplierIdentityFacts({nome:'Relê Soft RE-10',marca:'SOFT'},{brand:'Soft',model:'Soft'}).model,null);
});
test('composição de kit é extraída da descrição e do título ML, com origem',()=>{
 const remote=identityFacts([a('BRAND','Evus'),a('MODEL','FK-12P')],{title:'Cooler Evus FK-12P Kit com 4',source:'catalog'});
 const local=supplierIdentityFacts({id:'offer',nome:'Kit Cooler Fan Evus FK-12P',marca:'EVUS',descricao:'Kit de Coolers, composto por 4 unidades com controle.'},remote);
 assert.equal(local.quantity,4);assert.equal(remote.quantity,4);assert.ok(local.provenance.presentation.excerpt.includes('4 unidades'));
 assert.equal(assessIdentity({local,remote,source:'supplier+ml'}).identity,'IDENTIDADE_COHERENTE');
 assert.equal(assessIdentity({local,remote:{...remote,quantity:3},source:'supplier+ml'}).identity,'IDENTIDADE_DIVERGENTE');
});
test('par trançado e quatro pares de condutores não são kits de cabos',()=>{
 assert.equal(presentationFacts('Proeletronic Cat-5e Par Trançado Utp Cftv').packaging,null);
 assert.equal(presentationFacts('Cabo Proeletronic CFTV 4 Pares Azul 305m').quantity,null);
 assert.equal(presentationFacts('Kit 2 Cabos de Rede CAT6 4 Pares').quantity,2);
 assert.equal(presentationFacts('Par de Cabos de Rede CAT6').quantity,2);
 assert.equal(presentationFacts('Alto Falante Bravox Revo6 Par').quantity,2);
});
test('quantidade de caixas de som confirma par mesmo sem contagem no título do catálogo',()=>{
 const local=supplierIdentityFacts({marca:'Hurricane',nome:'Alto Falante TRIAK 5 Par'}, {brand:'Hurricane',model:'TRIAK 5'});
 const remote=identityFacts([a('BRAND','Hurricane'),a('MODEL','TRIAK 5'),a('SPEAKERS_NUMBER','2')],{title:'Alto Falante Hurricane Triak 5'});
 assert.equal(assessIdentity({local,remote,source:'supplier+catalog'}).identity,'IDENTIDADE_COHERENTE');
 assert.equal(assessIdentity({local,remote:{...remote,quantity:1},source:'supplier+catalog'}).identity,'IDENTIDADE_DIVERGENTE');
 assert.equal(remote.provenance.presentation.excerpt,'SPEAKERS_NUMBER: 2');
});
test('um kit não vira quatro kits; seis cordas não viram seis jogos; conjunto mecânico não é kit',()=>{
 const facts=identityFacts([a('SALE_FORMAT','Unidade'),a('UNITS_PER_PACK','1')],{title:'Kit cooler com 4'});
 assert.equal(facts.quantity,4);assert.equal(facts.saleUnits,1);assert.equal(facts.packaging,'kit');
 assert.equal(presentationFacts('Jogo de cordas','Para baixo de seis cordas').quantity,null);
 assert.equal(presentationFacts('Relê RE-10','Liga em conjunto com alarme').packaging,null);
 assert.equal(presentationFacts('Câmera','Possui um conjunto mecânico').packaging,null);
 assert.equal(presentationFacts('Kit duas vias 6 polegadas').quantity,null);
 assert.equal(presentationFacts('Kit 2 vias 6 polegadas').quantity,null);
});
test('ausência remota não é contradição; kit sem composição ainda exige validação',()=>{
 const basic={local:{brand:'Evus',model:'A1'},remote:{brand:'Evus',model:'A1'},source:'source'};
 const r=assessIdentity(basic);assert.equal(r.identity,'IDENTIDADE_COHERENTE');assert.ok(r.warnings.includes('APRESENTACAO_NAO_EXPLICITA'));
 assert.equal(assessIdentity({...basic,local:{...basic.local,packaging:'kit'}}).identity,'IDENTIDADE_INCONCLUSIVA');
 for(const field of ['brand','model','variation'])assert.equal(assessIdentity({...basic,local:{...basic.local,[field]:'A'},remote:{...basic.remote,[field]:'B'}}).identity,'IDENTIDADE_DIVERGENTE');
 assert.equal(assessIdentity({...basic,local:{...basic.local,critical:{VOLTAGE:'127V'}},remote:{...basic.remote,critical:{VOLTAGE:'220V'}}}).identity,'IDENTIDADE_DIVERGENTE');
});
test('estimativas econômicas são avisos, sem inventar confirmação ou conflito de identidade',()=>{
 const at='2026-09-05T15:00:00Z',amount=n=>({amount:n,source:'ml_live',observedAt:at,evidence:'ML'});
 const memory=evaluateEconomics({price:100,cost:50,offerId:'o',supplierId:'s',costObservedAt:at,fee:amount(15),shipping:amount(10),variableCosts:{amount:null,source:'unknown',observedAt:null,evidence:null},tax:{rate:.05,status:'estimated',referenceMonth:'2026-09',observedAt:at,source:'RBT12',rbt12:1,missingMonths:[]},evaluatedAt:at});
 const assessment=assessOpportunityConflicts({identity:{local:{brand:'Evus',model:'A1'},remote:{brand:'Evus',model:'A1'},source:'source'},listings:[],listingSearchComplete:true,economy:memory,eligibleOffer:true});
 assert.equal(assessment.state,'SEM_CONFLITO');assert.ok(assessment.warnings.includes('TRIBUTO_ESTIMADO'));assert.equal(assessment.warnings.includes('CUSTOS_VARIAVEIS_NAO_INFORMADOS'),false);assert.equal(memory.status,'estimated');assert.equal('variableCosts' in memory,false);
});
test('complemento técnico auditado distingue seis pinos de quatro e fica vinculado à oferta/GTIN',()=>{
 const product={id:'o',gtin:'789',marca:'EVUS',nome:'Kit FK-12P',descricao:'Composto por 4 unidades'};
 const remote=identityFacts([a('BRAND','EVUS'),a('MODEL','FK-12P'),a('PINS_NUMBER','4')],{title:'Kit FK-12P com 4'});
 const supplement={offerId:'o',gtin:'789',source:'supplier-page',observedAt:'2026-09-05T20:00:00Z',facts:{critical:{PINS_NUMBER:'6'}}};
 const local=supplierIdentityFacts(product,remote,supplement);
 const result=assessIdentity({local,remote,source:'supplier+ml'});
 assert.equal(result.identity,'IDENTIDADE_DIVERGENTE');assert.ok(result.reasons.includes('DIVERGENCIA_ATRIBUTO_PINS_NUMBER'));
 assert.equal(supplierIdentityFacts({...product,id:'another'},remote,supplement).critical,undefined);
 assert.equal(supplierIdentityFacts({...product,gtin:'different'},remote,supplement).critical,undefined);
 const pending=assessIdentity({local:{...local,critical:{},pendingReasons:['ESCOPO_POTENCIA_RMS_NAO_COMPROVADO']},remote,source:'supplier+ml'});
 assert.equal(pending.identity,'IDENTIDADE_INCONCLUSIVA');
});

test('compatibilidade de catálogo usa composição da descrição sem confundir kit vendido como unidade',()=>{
 const {catalogLocalCriticalMismatches}=require('../src/lib/ml-catalog-compatibility.ts');
 const local={nome:'Kit Cooler FK-12P',descricao:'Composto por 4 unidades'};
 const catalog={name:'Cooler FK-12P Kit com 4',attributes:[a('SALE_FORMAT','Unidade'),a('UNITS_PER_PACK','1')]};
 assert.deepEqual(catalogLocalCriticalMismatches(local,catalog),[]);
 assert.ok(catalogLocalCriticalMismatches(local,{...catalog,name:'Cooler FK-12P Kit com 3'}).length);
 assert.deepEqual(catalogLocalCriticalMismatches({nome:'Cooler FK-12P'},{name:'Cooler FK-12P com 4 unidades'}),[]);
});

test('descritores do modelo não bloqueiam código comprovado; cores e sufixos continuam materiais',()=>{
 for(const [brand,model,title] of [['Roadstar','RS606BR - Universal','Central Roadstar RS606BR'],['Roadstar','RS304BR BLACK','Sensor RS304BR Preto Brilhante'],['Intelbras','Mouse MSI 50','Mouse Intelbras MSI50 Preto'],['Truly','Truly T882','Calculadora de Mesa Truly T882']]) {
  const remote=identityFacts([a('BRAND',brand),a('MODEL',model)]);
  const local=supplierIdentityFacts({marca:brand,nome:title},remote);
  assert.equal(assessIdentity({local,remote,source:'supplier+ml'}).identity,'IDENTIDADE_COHERENTE',model);
 }
 const genericColor=assessIdentity({local:{brand:'M',model:'X1',variation:'preto'},remote:{brand:'M',model:'X1',variation:'Preta'},source:'source'});
 assert.equal(genericColor.identity,'IDENTIDADE_COHERENTE');
 const remote=identityFacts([a('BRAND','Roadstar'),a('MODEL','RS304BR BLACK')]);
 assert.equal(assessIdentity({local:supplierIdentityFacts({marca:'Roadstar',nome:'RS304BR Prata'},remote),remote,source:'supplier+ml'}).identity,'IDENTIDADE_DIVERGENTE');
 assert.equal(assessIdentity({local:supplierIdentityFacts({marca:'Roadstar',nome:'RS304BR'},remote),remote,source:'supplier+ml'}).identity,'IDENTIDADE_INCONCLUSIVA');
 assert.equal(findModelEvidence('PC108','Calculadora PC108-PK'),null);
});
test('quantidade da embalagem DSLite complementa o título abreviado somente na mesma oferta e GTIN',()=>{
 const offer={id:'offer',gtin:'789',marca:'Grid',nome:'Calota Grid 123CP-PTA'},remote=identityFacts([a('BRAND','Grid'),a('MODEL','123CP-PTA'),a('GTIN','789')],{title:'Calota Grid 123CP-PTA Kit 4 Unidades'});
 const supplement={offerId:'offer',gtin:'789',source:'DSLite /v1/CrossDocking/Catalogo/133/123:embalagem_quantidade',observedAt:'2026-09-07T06:00:00Z',facts:{quantity:4,packaging:'kit',provenance:{presentation:{source:'DSLite:embalagem_quantidade',excerpt:'4'}}}};
 assert.equal(assessIdentity({local:supplierIdentityFacts(offer,remote),remote,source:'supplier'}).identity,'IDENTIDADE_INCONCLUSIVA');
 assert.equal(assessIdentity({local:supplierIdentityFacts(offer,remote,supplement),remote,source:'supplier'}).identity,'IDENTIDADE_COHERENTE');
 assert.equal(assessIdentity({local:supplierIdentityFacts(offer,remote,{...supplement,facts:{...supplement.facts,quantity:2}}),remote,source:'supplier'}).identity,'IDENTIDADE_DIVERGENTE');
 assert.equal(supplierIdentityFacts({...offer,gtin:'different'},remote,supplement).quantity,null);
});

test('kit de montagem não transforma o produto principal em kit comercial',()=>{
 assert.equal(presentationFacts('Access Point EAP115','Acompanha kit de montagem').packaging,null);
 assert.equal(presentationFacts('Suporte para monitor','Kit de parafusos incluso').packaging,null);
 assert.equal(presentationFacts('Access Point EAP115','Acompanha kit com 4 peças para montagem').quantity,null);
 assert.equal(presentationFacts('Kit de montagem com 4 peças').quantity,4);
 assert.equal(presentationFacts('Roteador HX220 (1-pack)','Disponível também em pacote com 2 unidades').quantity,1);
 assert.equal(presentationFacts('Roteador HX220 (1-pack)').packaging,'unidade');
 assert.equal(presentationFacts('Roteador Deco HC220-G5 2 Pack').quantity,2);
 assert.equal(presentationFacts('Tubo 60 Pilhas AAA - 15 Packs Com 4 Unidades').quantity,60);
 assert.equal(presentationFacts('Pilha AAA Elgin blister grande com 10x2','Cartelão 10 blisters com 2 unidades').quantity,20);
});
