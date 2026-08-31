const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '../src/app/(app)/compras/page.tsx'),
  'utf8',
);

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.notEqual(start, -1, `seção inicial ausente: ${from}`);
  assert.notEqual(end, -1, `seção final ausente: ${to}`);
  return source.slice(start, end);
}

const filteredLoader = section(
  'const fetchFilteredPurchases',
  'const fetchIndependentIndicators',
);
const independentLoader = section(
  'const fetchIndependentIndicators',
  'useEffect(() => {\n    const urlSearch',
);
const loadingEffects = section(
  'useEffect(() => {\n    if (!urlSearchReady)',
  'useEffect(() => {\n    setPage(1)',
);
const paymentHandler = section(
  'const handleConfirmSupplierPayment',
  'const renderSupplierPaymentTag',
);

test('separa compras filtradas dos indicadores independentes', () => {
  assert.match(filteredLoader, /fetch\(`\/api\/compras\?\$\{buildParams\(\)\}`\)/);
  assert.match(filteredLoader, /fetch\(`\/api\/compras\/resumo\?\$\{buildSummaryParams\(\)\}`\)/);
  assert.doesNotMatch(filteredLoader, /\/api\/ml\/anuncios\/alertas/);

  assert.match(independentLoader, /fetch\('\/api\/ml\/anuncios\/alertas'\)/);
  assert.doesNotMatch(independentLoader, /buildParams|buildSummaryParams|\/api\/compras\?/);
});

test('filtros não fazem o efeito independente depender do carregamento filtrado', () => {
  assert.equal(
    loadingEffects.match(/fetchFilteredPurchases\(\)/g)?.length,
    1,
  );
  assert.equal(
    loadingEffects.match(/fetchIndependentIndicators\(\)/g)?.length,
    1,
  );
  assert.match(
    loadingEffects,
    /\[fetchFilteredPurchases, urlSearchReady\]/,
  );
  assert.match(
    loadingEffects,
    /\[fetchIndependentIndicators, urlSearchReady\]/,
  );
  assert.doesNotMatch(independentLoader, /search|statusFilter|dateRange|page|sort/);
});

test('confirmação de pagamento atualiza somente os dados de compras', () => {
  assert.match(paymentHandler, /await fetchFilteredPurchases\(\)/);
  assert.doesNotMatch(paymentHandler, /fetchIndependentIndicators|\/api\/ml\/anuncios\/alertas/);
});

test('não restaura a integração operacional de saldo Hayamax', () => {
  assert.doesNotMatch(source, /\/api\/fornecedores\/saldo-hayamax/);
});
