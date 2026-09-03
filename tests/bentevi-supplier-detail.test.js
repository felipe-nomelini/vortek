const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/fornecedores/[id]/page.tsx');
const styles = read('src/app/(app)/fornecedores/[id]/fornecedor-detalhe.module.css');
const route = read('src/app/api/fornecedores/[id]/route.ts');
const statusRoute = read('src/app/api/fornecedores/[id]/status/route.ts');
const offersPage = read('src/app/(app)/produtos/ofertas/page.tsx');
const { hasPermission } = require('../src/lib/permissions.ts');

test('BNT-D16 organiza fornecedor por origem e contexto operacional', () => {
  for (const section of ['Operação', 'Cadastro DSLite', 'Contato operacional', 'Pagamento local', 'Auditoria']) {
    assert.match(page, new RegExp(section));
  }
  for (const metric of ['Compras vinculadas', 'Ofertas cadastradas', 'Ofertas operacionais']) {
    assert.match(page, new RegExp(metric));
  }
  assert.match(page, /Cadastro sincronizado · DSLite/);
  assert.match(page, /Somente leitura/);
  assert.match(page, /Local · complementar/);
  assert.match(styles, /var\(--bentevi-primary/);
  assert.doesNotMatch(page, /payload_dslite/);
});

test('BNT-D16 edita somente contato e pagamento locais em modais separados', () => {
  assert.match(page, /title="Editar contato operacional"/);
  assert.match(page, /title="Editar chave PIX"/);
  for (const field of ['email', 'phone', 'address', 'pixKey']) {
    assert.match(page, new RegExp(`name="${field}"`));
  }
  for (const externalField of ['nickname', 'legalName', 'document', 'dsliteStatus', 'crossdocking', 'dropshipping']) {
    assert.doesNotMatch(page, new RegExp(`name="${externalField}"`));
  }
  assert.match(page, /hasPermission\(role, 'suppliers\.manage'\)/);
});

test('BNT-D16 reutiliza mudança segura de status e bloqueia reativação histórica', () => {
  assert.match(page, /\/status/);
  assert.match(page, /products_active/);
  assert.match(page, /supplier_offers_active/);
  assert.match(page, /ml_delete_candidates/);
  assert.match(page, /supplier\.activationBlocked/);
  assert.match(page, /A reativação está bloqueada pela política operacional/);
  assert.equal(statusRoute.match(/authorizeApiRequest\([^,]+, 'suppliers\.manage'\)/g)?.length, 2);
});

test('API BNT-D16 retorna DTO explícito, resumo e saúde canônica', () => {
  assert.match(route, /authorizeApiRequest\(request, 'purchases\.read'\)/);
  assert.match(route, /supplierIdSchema = z\.string\(\)\.uuid\(\)/);
  assert.match(route, /supplierFields = 'id,dslite_id,apelido,nome,cnpj,email,telefone,endereco,supplier_pix_key,status_dslite,crossdocking,dropshipping,ativo,dslite_ultima_sync,created_at,updated_at'/);
  assert.match(route, /getSyncTaskByKey\('sync_dslite_fornecedores'\)/);
  assert.match(route, /evaluateScheduledTaskHealth/);
  assert.match(route, /count: 'exact', head: true/);
  assert.match(route, /purchaseCount, offerCount, activeOfferCount/);
  assert.match(route, /Cache-Control': 'no-store'/);
  assert.doesNotMatch(route, /select\(['"]\*['"]\)|payload_dslite/);
});

test('PATCH BNT-D16 rejeita propriedade externa e altera apenas campos locais', () => {
  assert.match(route, /authorizeApiRequest\(request, 'suppliers\.manage'\)/);
  assert.match(route, /localUpdateSchema = z\.object/);
  assert.match(route, /\.strict\(\)\.refine/);
  for (const mapping of [
    /update\.email = parsed\.data\.email/,
    /update\.telefone = parsed\.data\.phone/,
    /update\.endereco = parsed\.data\.address/,
    /update\.supplier_pix_key = parsed\.data\.pixKey/,
  ]) assert.match(route, mapping);
  assert.doesNotMatch(route, /editableFields|normalizePatch|update\.ativo|update\.status_dslite|update\.crossdocking|update\.dropshipping/);
});

test('atalhos do fornecedor abrem Compras e Ofertas com filtro real', () => {
  assert.match(page, /\/compras\?fornecedorId=/);
  assert.match(page, /\/produtos\/ofertas\?fornecedores=/);
  assert.match(offersPage, /params\.get\('fornecedores'\)/);
  assert.match(offersPage, /setSupplierIds\(Array\.from\(new Set\(requestedSuppliers\)\)\)/);
  assert.match(offersPage, /if \(filtersHydrated\) void fetchOffers\(\)/);
});

test('somente gestão altera cadastro; todos os perfis autenticados podem consultar', () => {
  for (const role of ['admin', 'gerente']) assert.equal(hasPermission(role, 'suppliers.manage'), true);
  for (const role of ['operador', 'visualizador']) {
    assert.equal(hasPermission(role, 'purchases.read'), true);
    assert.equal(hasPermission(role, 'suppliers.manage'), false);
  }
});
