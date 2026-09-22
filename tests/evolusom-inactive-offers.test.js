const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { resolveEvolusomOfferProduct } = require('../src/lib/sync/evolusom-offer-link.ts');
const catalog = fs.readFileSync(require.resolve('../src/app/api/sync/catalogo/route.ts'), 'utf8');
const priceStock = fs.readFileSync(require.resolve('../src/app/api/sync/preco-estoque/route.ts'), 'utf8');

test('identidade do fornecedor prevalece sobre GTIN e preserva produto inativo', () => {
  assert.deepEqual(resolveEvolusomOfferProduct({
    existingOffer: { produto_id: 'existing', product: { ativo: false } },
    supplierProduct: { id: 'legacy', ativo: true },
    gtinProducts: [{ id: 'one', ativo: true }, { id: 'two', ativo: true }],
  }), { productId: 'existing', productActive: false, gtinConflict: false });
  assert.deepEqual(resolveEvolusomOfferProduct({
    supplierProduct: { id: 'legacy', ativo: false },
    gtinProducts: [{ id: 'one', ativo: true }],
  }), { productId: 'legacy', productActive: false, gtinConflict: false });
});

test('GTIN único vincula o produto existente; GTIN ambíguo bloqueia o vínculo', () => {
  assert.deepEqual(resolveEvolusomOfferProduct({
    gtinProducts: [{ id: 'inactive', ativo: false }],
  }), { productId: 'inactive', productActive: false, gtinConflict: false });
  assert.deepEqual(resolveEvolusomOfferProduct({
    gtinProducts: [{ id: 'one', ativo: false }, { id: 'two', ativo: false }],
  }), { productId: null, productActive: false, gtinConflict: true });
});

test('catálogo grava oferta inativa com custo e estoque sem tocar snapshot do produto inativo', () => {
  assert.match(catalog, /resolveEvolusomOfferProduct\(/);
  assert.match(catalog, /catalog_gtin_ambiguous/);
  assert.match(catalog, /else if \(resolvedProductActive\) \{\s*touchedProductIds\.add\(productId\)/);
  assert.match(catalog, /custo: Number\(row\.custo \|\| 0\),\s*estoque: Number\(row\.estoque \|\| 0\),\s*ativo: resolvedProductActive && !shouldSupplierOfferBeInactiveByCost/);
});

test('preço/estoque mantém oferta de produto inativo inelegível e fora de publicação', () => {
  assert.match(priceStock, /const productActive = \(existingOffer\?\.product\?\.ativo \?\? legacyProduct\?\.ativo\) !== false/);
  assert.match(priceStock, /if \(productActive \|\| !directEvolusomSync\) touchedProductIds\.add\(productId\)/);
  assert.match(priceStock, /custo: normalizeCost\(row\.custo\),\s*estoque: normalizeStock\(row\.estoque\),\s*ativo: !inactiveOfferByCost && \(productActive \|\| !directEvolusomSync\)/);
  assert.match(priceStock, /if \(staleOffer\.product\?\.ativo !== false\) \{\s*touchedProductIds\.add\(productId\)/);
  assert.match(priceStock, /productId && touchedProductIds\.has\(productId\)/);
});
