const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  classifySupplierDeactivationProducts,
  isActiveSupplierListingStatus,
  isSafeInactiveSupplierPause,
} = require('../src/lib/supplier-deactivation.ts');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const statusRoute = read('src/app/api/fornecedores/[id]/status/route.ts');
const publishWorker = read('src/app/api/sync/anuncios/publish/route.ts');
const supplierList = read('src/app/(app)/fornecedores/page.tsx');
const supplierDetail = read('src/app/(app)/fornecedores/[id]/page.tsx');

test('classifica fornecedor alternativo, estoque interno e ausência de fonte sem somar origens', () => {
  const products = [
    { id: 'alternativo', ativo: true },
    { id: 'interno', ativo: true },
    { id: 'ambos', ativo: true },
    { id: 'sem-fonte', ativo: true },
    { id: 'interno-inativo', ativo: false },
  ];

  const result = classifySupplierDeactivationProducts(
    products,
    new Set(['alternativo', 'ambos']),
    new Set(['interno', 'ambos', 'interno-inativo']),
  );

  assert.deepEqual(result.withAlternative.map((product) => product.id), ['alternativo', 'ambos']);
  assert.deepEqual(result.withInternalStock.map((product) => product.id), ['interno', 'ambos', 'interno-inativo']);
  assert.deepEqual(result.keptOnlyByInternalStock.map((product) => product.id), ['interno']);
  assert.deepEqual(result.withoutAvailableSource.map((product) => product.id), ['sem-fonte']);
});

test('considera candidato à pausa somente anúncio confirmado como ativo', () => {
  assert.equal(isActiveSupplierListingStatus('active'), true);
  assert.equal(isActiveSupplierListingStatus(' active '), true);
  for (const status of ['paused', 'closed', 'under_review', 'ativo', '', null]) {
    assert.equal(isActiveSupplierListingStatus(status), false);
  }
});

test('libera produto inativo somente para a pausa segura e exata do fornecedor', () => {
  const safePause = {
    source: 'fornecedor_inativo_pause',
    desiredStatus: 'pausado',
    desiredQuantity: 0,
    appliesPrice: false,
    appliesQuantityPricing: false,
    appliesQuantity: true,
    appliesStatus: true,
  };
  assert.equal(isSafeInactiveSupplierPause(safePause), true);

  for (const invalid of [
    { ...safePause, source: 'fornecedor_inativo_alternativa' },
    { ...safePause, desiredStatus: 'ativo' },
    { ...safePause, desiredQuantity: 1 },
    { ...safePause, desiredQuantity: null },
    { ...safePause, desiredQuantity: '' },
    { ...safePause, appliesPrice: true },
    { ...safePause, appliesQuantityPricing: true },
    { ...safePause, appliesQuantity: false },
    { ...safePause, appliesStatus: false },
  ]) assert.equal(isSafeInactiveSupplierPause(invalid), false);
});

test('rota usa capacidade canônica, preserva atividade manual e sincroniza estoque interno', () => {
  assert.match(statusRoute, /loadProductFulfillmentCapacities/);
  assert.match(statusRoute, /capacity\.internal > 0/);
  assert.match(statusRoute, /classifySupplierDeactivationProducts/);
  assert.match(statusRoute, /enfileirarSyncMlEstoqueInterno/);
  assert.match(statusRoute, /staleDeleteOutboxCancelled/);
  assert.match(statusRoute, /exclusão permanente substituída pela política reversível de pausa/);
  assert.match(statusRoute, /products_kept_only_by_internal_stock/);
  assert.match(statusRoute, /products_without_available_source/);
  assert.match(statusRoute, /source: 'fornecedor_inativo_pause'/);
  assert.match(statusRoute, /desiredStatus: 'pausado'/);
  assert.match(statusRoute, /desiredQuantity: 0/);
  assert.match(statusRoute, /delete_listing: false/);
  assert.match(statusRoute, /ml_pause_candidates/);
  assert.doesNotMatch(statusRoute, /source: 'fornecedor_inativo_delete',[\s\S]{0,260}delete_listing: true/);
  assert.doesNotMatch(statusRoute, /productsToInactivate|productsInactivated/);
  assert.doesNotMatch(statusRoute, /\.from\('produtos'\)[\s\S]{0,120}\.update\(\{ ativo: false/);
  assert.match(publishWorker, /isSafeInactiveSupplierPause/);
  assert.match(publishWorker, /&& !safeInactiveSupplierPause/);
});

test('BNT-PARITY-05 exige reprocessamento explícito e serializa a transição por fornecedor', () => {
  assert.match(statusRoute, /body\?\.reprocess !== undefined/);
  assert.match(statusRoute, /Fornecedor já está inativo\. Use a ação explícita de reprocessamento\./);
  assert.match(statusRoute, /acquireDomainLock/);
  assert.match(statusRoute, /domain: lockDomain/);
  assert.match(statusRoute, /ownerTask: 'fornecedor_status_transition'/);
  assert.match(statusRoute, /const lockDomain = `fornecedor:status:\$\{params\.id\}`/);
  assert.match(statusRoute, /releaseDomainLock/);
  assert.match(statusRoute, /finally/);
});

test('BNT-PARITY-05 corrige e verifica todas as ofertas, inclusive estoque residual inativo', () => {
  assert.match(statusRoute, /select\('id,ativo,estoque'\)/);
  assert.match(statusRoute, /offer\.ativo !== false \|\| Number\(offer\.estoque \|\| 0\) !== 0/);
  assert.match(statusRoute, /update\(\{ ativo: false, estoque: 0 \} as any\)[\s\S]{0,120}\.eq\('dslite_fornecedor_id', dsliteFornecedorId\)/);
  assert.match(statusRoute, /supplierOffersVerifiedInactive/);
  assert.match(statusRoute, /supplierOffersVerifiedZeroStock/);
  assert.match(statusRoute, /reprocessed: reprocess/);
  assert.doesNotMatch(statusRoute, /activeOfferIds/);
});

test('confirmações explicam que estoque interno preserva a operação', () => {
  for (const page of [supplierList, supplierDetail]) {
    assert.match(page, /Mantidos pelo estoque interno/);
    assert.match(page, /Sem fonte disponível/);
    assert.match(page, /Anúncios a pausar/);
    assert.match(page, /pausados com estoque zero, preservando o vínculo para retomada/);
  }
});

test('fornecedor inativo oferece reprocessamento explícito na lista e no detalhe', () => {
  for (const page of [supplierList, supplierDetail]) {
    assert.match(page, /Reprocessar inativação/);
    assert.match(page, /supplier_offers_to_correct/);
    assert.match(page, /JSON\.stringify\(\{ ativo[^}]*reprocess \}\)/);
  }
});
