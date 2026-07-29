const assert = require("node:assert/strict");
const test = require("node:test");

const {
  mapCreatedListingDesiredStatus,
} = require("../src/lib/ml/status.ts");

test("mantém desejo ativo durante processamento inicial das imagens", () => {
  assert.equal(
    mapCreatedListingDesiredStatus({
      status: "paused",
      sub_status: ["picture_download_pending"],
    }),
    "ativo",
  );
});

test("preserva pausa real sem processamento de imagens", () => {
  assert.equal(
    mapCreatedListingDesiredStatus({
      status: "paused",
      sub_status: [],
    }),
    "pausado",
  );
});

test("mantém anúncio ativo quando Mercado Livre já ativou", () => {
  assert.equal(
    mapCreatedListingDesiredStatus({
      status: "active",
      sub_status: [],
    }),
    "ativo",
  );
});

test("usa pausa segura quando item criado ainda não retornou status", () => {
  assert.equal(mapCreatedListingDesiredStatus({}), "pausado");
});
