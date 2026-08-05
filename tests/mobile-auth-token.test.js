const assert = require("node:assert/strict");
const test = require("node:test");

const { parseBearerToken } = require("../src/lib/mobile-auth-token.ts");

test("extrai token Bearer válido", () => {
  assert.equal(parseBearerToken("Bearer abc.def-123"), "abc.def-123");
  assert.equal(parseBearerToken("bearer token"), "token");
});

test("rejeita cabeçalho ausente ou ambíguo", () => {
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken("Basic abc"), null);
  assert.equal(parseBearerToken("Bearer"), null);
  assert.equal(parseBearerToken("Bearer token extra"), null);
});
