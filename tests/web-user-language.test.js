const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isTechnicalUserMessage,
  userSafeMessage,
} = require('../src/lib/user-feedback.ts');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function collectSources(relativeDirectory) {
  const directory = path.join(__dirname, '..', relativeDirectory);
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) result.push(...collectSources(relativePath));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) result.push([relativePath, readSource(relativePath)]);
  }
  return result;
}

test('mensagens técnicas são substituídas por uma orientação simples', () => {
  const fallback = 'Não foi possível concluir a ação. Tente novamente.';
  const technicalMessages = [
    'completo_parcial',
    'CONTEXTO_ALTERADO',
    'item_fetch_failed',
    'Refresh job HTTP 500',
    'duplicate key violates constraint catalogo_ml_snapshot_pkey',
    '{"status_code":500,"error":"failed_auth"}',
  ];

  for (const message of technicalMessages) {
    assert.equal(isTechnicalUserMessage(message), true, message);
    assert.equal(userSafeMessage(message, fallback), fallback, message);
  }
});

test('mensagens operacionais conhecidas continuam visíveis', () => {
  const message = 'A etiqueta ainda não foi liberada pelo Mercado Livre.';
  assert.equal(isTechnicalUserMessage(message), false);
  assert.equal(userSafeMessage(message, 'Tente novamente.'), message);
});

test('páginas e componentes não reintroduzem termos internos já removidos', () => {
  const sources = [
    ...collectSources('src/app/(app)'),
    ...collectSources('src/components'),
  ];
  const forbiddenVisiblePhrases = [
    /["'`]Refresh concluído/i,
    /["'`]Refresh do catálogo iniciado/i,
    /["'`]snapshot fiscal/i,
    /["'`]allowlist do runtime/i,
    /["'`]DEV ·/i,
    /label=["']Client ID["']/i,
    /label=["']Client Secret["']/i,
    /label=["']Access token["']/i,
    /label=["']Refresh token["']/i,
    /label=["']User token/i,
    /["'`]Shipment(?:\s|#| ML)/i,
    /extra=["'][^"']*not_specified/i,
    /["'`][^"'`]*amostra[^"'`]*homologa/i,
  ];

  const violations = [];
  for (const [relativePath, source] of sources) {
    for (const pattern of forbiddenVisiblePhrases) {
      if (pattern.test(source)) violations.push(`${relativePath}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('resultado do catálogo usa uma apresentação própria para o usuário', () => {
  const statusRoute = readSource('src/app/api/catalogo/no-catalogo/refresh/status/route.ts');
  const catalogView = readSource('src/components/catalogo/CatalogoView.tsx');

  assert.match(statusRoute, /presentCatalogRefresh/);
  assert.match(catalogView, /job\?\.presentation/);
  assert.doesNotMatch(catalogView, /job\.status\}/);
  assert.doesNotMatch(catalogView, /last_event\?\.message/);
  assert.doesNotMatch(catalogView, /failures\?\.\[0\]/);
});
