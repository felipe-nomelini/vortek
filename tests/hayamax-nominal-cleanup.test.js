const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('remove guardas de categoria exclusivos sem remover guardas compartilhados', () => {
  const categoryGuard = read('src/lib/ml-category-guard.ts');
  const categoryRoute = read('src/app/api/ml/anuncio/categorias/route.ts');

  assert.doesNotMatch(categoryGuard, /Hayamax|HAYAMAX|requiresHayamax|getPreferredHayamax/);
  assert.doesNotMatch(categoryRoute, /Hayamax|HAYAMAX|getPreferredHayamax/);
  assert.match(categoryGuard, /getRequiredPanasonicBatteryCategory/);
  assert.match(categoryGuard, /requiresPetShopCategory/);
  assert.match(categoryGuard, /assertNicheCategoryEvidence/);
  assert.match(categoryRoute, /predictCategoryWithFallbacks/);
});

test('usa evento e mensagem neutros no fluxo compartilhado de etiqueta provisória', () => {
  const auditService = read('src/services/nf-auditoria.ts');
  const createRoute = read('src/app/api/dslite/pedido/route.ts');
  const autoRoute = read('src/app/api/dslite/etiqueta-auto/route.ts');
  const ordersPage = read('src/app/(app)/pedidos/page.tsx');
  const placeholder = read('src/lib/dslite/placeholder-label.ts');
  const combined = [auditService, createRoute, autoRoute, ordersPage, placeholder].join('\n');

  assert.doesNotMatch(combined, /placeholder_label_blocked_non_hayamax/);
  assert.doesNotMatch(combined, /Etiqueta genérica Hayamax|supplierLabel: 'Hayamax'/);
  assert.match(auditService, /placeholder_label_blocked_supplier_not_configured/);
  assert.match(createRoute, /allowed_fornecedores: \['97', '108', '133'\]/);
  assert.match(autoRoute, /allowed_fornecedores: \['97', '108', '133'\]/);
});

test('remove scripts exclusivos e campanhas encerradas sem retirar regras compartilhadas', () => {
  const removedScripts = [
    'apply-hayamax-audit-corrections.js',
    'apply-hayamax-cash-tourniquet.js',
    'create-hayamax-ml-batch.js',
    'delete-unavailable-hayamax-listings.js',
    'fix-hayamax-listing-skus.js',
    'pause-hayamax-catalog-risk-pairs.js',
    'prepare-hayamax-listing-audit.js',
    'reconcile-hayamax-balance-2026-06-16.mjs',
    'repair-ml-kit-image-2026-08-03.js',
    'apply-supplier-pricing-campaign.js',
    'create-profitable-shelf-listings.js',
    'run-ml-p0-audit.js',
  ];

  for (const script of removedScripts) {
    assert.equal(fs.existsSync(path.join(root, 'scripts', script)), false, script);
  }

  assert.equal(fs.existsSync(path.join(root, 'reports/hayamax-cash-tourniquet')), false);
});

test('mantém bloqueio operacional e documentação histórica', () => {
  const supplierPolicy = read('src/lib/dslite/supplier-policy.ts');
  assert.doesNotMatch(supplierPolicy, /\['2', '134'\]/);
  assert.match(supplierPolicy, /\.eq\('ativo', true\)/);
  assert.match(supplierPolicy, /\.is\('dropshipping_retired_at', null\)/);
  assert.equal(
    fs.existsSync(
      path.join(
        root,
        'docs/reestruturacao-vortek/VORTEK_AUDITORIA_ITEM_15_SCRIPTS_DOCUMENTACAO_HISTORICOS.md',
      ),
    ),
    true,
  );
});
