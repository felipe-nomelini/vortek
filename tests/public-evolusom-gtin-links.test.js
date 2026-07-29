const assert = require("node:assert/strict");
const test = require("node:test");

process.env.PUBLIC_EVOLUSOM_GTIN_LINK_SECRET =
  "test-only-public-evolusom-secret";

const {
  createPublicEvolusomGtinToken,
  verifyPublicEvolusomGtinToken,
} = require("../src/lib/public-evolusom-gtin-links.ts");

test("aceita token Evolusom válido e ainda não expirado", () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const token = createPublicEvolusomGtinToken(expiresAt);

  assert.equal(
    verifyPublicEvolusomGtinToken(token, expiresAt),
    true,
  );
});

test("rejeita token adulterado ou expirado", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const expired = new Date(Date.now() - 60_000).toISOString();

  assert.equal(verifyPublicEvolusomGtinToken("invalid", future), false);
  assert.equal(
    verifyPublicEvolusomGtinToken(
      createPublicEvolusomGtinToken(expired),
      expired,
    ),
    false,
  );
});
