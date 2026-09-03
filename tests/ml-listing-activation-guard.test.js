const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const publishRouteSource = fs.readFileSync(
  path.join(root, 'src/app/api/sync/anuncios/publish/route.ts'),
  'utf8',
);
const mlServiceSource = fs.readFileSync(
  path.join(root, 'src/services/mercadolibre.ts'),
  'utf8',
);
const identityGuardSource = fs.readFileSync(
  path.join(root, 'src/lib/ml/identity-block.ts'),
  'utf8',
);

test('fila valida identidade antes de ativar anúncio', () => {
  const guardIndex = publishRouteSource.indexOf("updateProcessingMarker('identity_activation_guard')");
  const activationIndex = publishRouteSource.indexOf("body: JSON.stringify({ status: statusMl })");

  assert.ok(guardIndex >= 0);
  assert.ok(activationIndex > guardIndex);
  assert.equal(publishRouteSource.includes('validateMlListingIdentityForActivation'), true);
  assert.equal(identityGuardSource.includes('assessMlProductIdentity'), true);
  assert.equal(identityGuardSource.includes('ensureAutomaticMlIdentityBlock'), true);
  assert.equal(identityGuardSource.includes('clearAutomaticMlIdentityBlock'), true);
});

test('reativação direta também valida identidade antes de enviar active', () => {
  const guardIndex = mlServiceSource.indexOf('validateMlListingIdentityForActivation(');
  const activationIndex = mlServiceSource.indexOf('body: JSON.stringify({ status: "active" })');

  assert.ok(guardIndex >= 0);
  assert.ok(activationIndex > guardIndex);
});
