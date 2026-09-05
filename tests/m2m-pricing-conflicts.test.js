const test = require('node:test');
const assert = require('node:assert/strict');
const { priceBand, evaluateEconomics, calculateSuggestedPrice, solveQuotedPrice, commercialDiagnosis } = require('../src/services/pricing.ts');
const { buildPricingTaxContext } = require('../src/services/pricing-tax.ts');
const { assessOpportunityConflicts, radarClassification } = require('../src/lib/ml/opportunity-conflicts.ts');
const at = '2026-09-05T15:00:00Z';
const amount = (value, source = 'ml_live') => ({ amount: value, source, observedAt: at, evidence: 'test-evidence' });
const input = (overrides = {}) => ({ price: 100, cost: 60, offerId: 'offer', supplierId: 'supplier', costObservedAt: at, fee: amount(15), shipping: amount(10), variableCosts: amount(0, 'confirmed'), tax: { rate: .05, status: 'confirmed', referenceMonth: '2026-09', source: 'test', observedAt: at, evidence: 'tax-confirmation', rbt12: null, missingMonths: [] }, evaluatedAt: at, ...overrides });
const identity = { local: { gtin: '7890000000001', brand: 'Acme', model: 'A1', quantity: 1, packaging: 'unidade' }, remote: { gtin: '7890000000001', brand: 'Acme', model: 'A1', quantity: 1, packaging: 'unidade' }, source: 'supplier+ml' };
const conflict = (overrides={}) => assessOpportunityConflicts({ identity, listings: [], listingSearchComplete: true, economy: evaluateEconomics(input()), eligibleOffer: true, ...overrides });

test('fronteiras canônicas de preço final, inclusive centavos', () => {
  for (const [p,f,t,l] of [[200,.05,.07,.10],[200.01,.07,.10,.15],[1000,.07,.10,.15],[1000.01,.10,.15,.20]]) assert.deepEqual([priceBand(p).floor,priceBand(p).target,priceBand(p).limit],[f,t,l]);
  assert.equal(priceBand(0),null);assert.equal(priceBand(NaN),null);
});
test('tributo precisa de competência e evidência; confirmado vence estimativa', () => {
  const params={activityStartDate:'2026-03-23',referenceMonth:'2026-09',monthlyRevenue:[],observedAt:at};
  assert.equal(buildPricingTaxContext(params).status,'unavailable');
  const confirmed=buildPricingTaxContext({...params,confirmed:{month:'2026-09',rate:.02,evidence:'PGDAS-validado'}});
  assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.rate,.02);
  assert.equal(buildPricingTaxContext({...params,confirmed:{month:'2026-08',rate:.04,evidence:'PGDAS'}}).status,'unavailable');
});
test('RBT12 proporcionalizado e mês ausente não vira zero', () => {
  const p={activityStartDate:'2026-03-23',referenceMonth:'2026-05',monthlyRevenue:[{month:'2026-03',revenue:10000},{month:'2026-04',revenue:20000}],observedAt:at};
  assert.equal(buildPricingTaxContext(p).rbt12,180000);assert.equal(buildPricingTaxContext(p).rate,.04);
  assert.deepEqual(buildPricingTaxContext({...p,monthlyRevenue:p.monthlyRevenue.slice(1)}).missingMonths,['2026-03']);
});
test('economia canônica discrimina ausência, zero confirmado e estimativa', () => {
  assert.equal(evaluateEconomics(input()).result,10);
  assert.equal(evaluateEconomics(input({shipping:amount(null)})).result,null);
  assert.equal(evaluateEconomics(input({variableCosts:amount(null,'unknown')})).status,'estimated');
  assert.equal(evaluateEconomics(input({cost:0})).status,'inconclusive');
});
test('7,3% abaixo de 200 é viável no alvo, sem piso universal 10%', () => {
  const memory=evaluateEconomics(input({cost:62.7}));
  assert.equal(memory.result,7.3);assert.equal(conflict({economy:memory}).economy,'VIAVEL_NO_ALVO');
});
test('preço sugerido estabiliza e respeita alvo final com arredondamento fiscal', () => {
  for (const cost of [20,100,145,150,700,780,900,1600]) {
    const p=calculateSuggestedPrice({cost,shipping:10,mlFee:.15,taxRate:.082799});
    assert.ok(p.netProfit/p.suggestedPrice+1e-10>=priceBand(p.suggestedPrice).target);
  }
});
test('solver consulta o preço retornado e cruza faixas', async () => {
  const quotes=[];
  const quote=async price=>{quotes.push(price);return evaluateEconomics(input({price,cost:150,fee:amount(Math.round(price*15)/100),shipping:amount(10)}));};
  const result=await solveQuotedPrice({cost:150,taxRate:.05,initialPrice:150,objective:'target',quote});
  assert.equal(result.ok,true);assert.ok(quotes.includes(result.memory.price));assert.ok(result.memory.margin>=result.memory.band.target);
});
test('solver falha explicitamente quando fonte está indisponível', async () => {
  const result=await solveQuotedPrice({cost:100,taxRate:.05,initialPrice:150,objective:'target',quote:async price=>evaluateEconomics(input({price,shipping:amount(null)}))});
  assert.equal(result.ok,false);assert.equal(result.reason,'FRETE_INDISPONIVEL');
});
test('regressão D0: cotação viva desfaz falso prejuízo stale', () => {
  const stale=evaluateEconomics(input({shipping:{...amount(40,'local'),observedAt:'2026-08-01T00:00:00Z'}}));
  const live=evaluateEconomics(input());
  assert.equal(stale.result,-20);assert.equal(stale.status,'estimated');assert.equal(live.result,10);
  assert.ok(!live.diagnostics.includes('PREJUIZO_REAL'));
});
test('margem premium com venda é preservada; baixa funcional exige estratégia', () => {
  assert.equal(commercialDiagnosis(evaluateEconomics(input({cost:30})),{sales:1,visits:5,completeWindow:true}),'MARGEM_PREMIUM_VALIDADA_PELO_MERCADO');
  const low=evaluateEconomics(input({cost:67}));
  assert.equal(commercialDiagnosis(low,{sales:1,visits:5,completeWindow:true}),'MARGEM_BAIXA_SEM_EVIDENCIA_COMERCIAL');
  assert.equal(commercialDiagnosis(low,{sales:1,visits:5,completeWindow:true,strategy:{kind:'functional',author:'admin',reason:'giro',validUntil:'2026-10-01'}}),'MARGEM_BAIXA_ESTRATEGICAMENTE_FUNCIONAL');
});
test('marca/modelo contraditórios vencem GTIN igual', () => {
  for(const field of ['brand','model'])assert.equal(conflict({identity:{...identity,remote:{...identity.remote,[field]:'Outro'}}}).state,'CONFLITO_CONFIRMADO');
});
test('GTIN diferente só admite variação com evidência e atributos coerentes', () => {
  const e={...identity,remote:{...identity.remote,gtin:'7890000000002'}};
  assert.equal(conflict({identity:e}).identity,'IDENTIDADE_DIVERGENTE');
  assert.equal(conflict({identity:{...e,variationMatchEvidence:'fabricante:documento'}}).identity,'IDENTIDADE_COHERENTE');
});
test('kit e quantidade impedem automação, GTIN sozinho deixa pendência', () => {
  for(const change of [{quantity:2},{packaging:'kit'}])assert.ok(conflict({identity:{...identity,remote:{...identity.remote,...change}}}).reasons.includes('CONFLITO_EMBALAGEM_QUANTIDADE'));
  assert.equal(conflict({identity:{local:{gtin:'1'},remote:{gtin:'1'},source:'ML'}}).identity,'IDENTIDADE_INCONCLUSIVA');
});
test('ativo, reativação e vínculo incompleto têm filas distintas', () => {
  const listing={itemId:'MLB1',pricingGroupId:'G',synchronized:true,source:'ML',observedAt:at};
  assert.equal(conflict({listings:[{...listing,status:'active'}]}).listing,'JA_ANUNCIADO_ATIVO');
  const paused=conflict({listings:[{...listing,status:'paused'}]});
  assert.equal(radarClassification(paused,'RANKING_ML',1,false).queue,'REATIVACOES');
  assert.equal(conflict({listingSearchComplete:false}).listing,'VINCULO_INCONCLUSIVO');
});
test('ausência de demanda não cria conflito; Buy Box negativa bloqueia', () => {
  assert.equal(conflict().state,'SEM_CONFLITO');
  assert.equal(radarClassification(conflict(),'SEM_EVIDENCIA_DE_DEMANDA',5,false).queue,'EXPLORATORIOS');
  assert.equal(conflict({economy:evaluateEconomics(input({cost:90})),buyBox:true}).economy,'CONFLITO_ECONOMICO_DE_BUY_BOX');
});
