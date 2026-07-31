const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveCatalogCompetitionStatus,
} = require("../src/lib/catalogo/no-catalogo.ts");

test("mostra sem catálogo quando o anúncio não pertence ao catálogo", () => {
  assert.equal(
    resolveCatalogCompetitionStatus({ catalogListing: false, buyBoxStatus: "winning" }),
    "sem_catalogo",
  );
});

test("considera winning e sharing_first_place como ganhando", () => {
  assert.equal(
    resolveCatalogCompetitionStatus({ catalogListing: true, buyBoxStatus: "winning" }),
    "ganhando",
  );
  assert.equal(
    resolveCatalogCompetitionStatus({ catalogListing: true, buyBoxStatus: "sharing_first_place" }),
    "ganhando",
  );
});

test("distingue competindo dos demais estados perdedores", () => {
  assert.equal(
    resolveCatalogCompetitionStatus({
      catalogListing: true,
      buyBoxStatus: "competing",
      buyBoxWinning: true,
    }),
    "competindo",
  );
  assert.equal(
    resolveCatalogCompetitionStatus({ catalogListing: true, buyBoxStatus: "not_listed" }),
    "perdendo",
  );
  assert.equal(
    resolveCatalogCompetitionStatus({ catalogListing: true, buyBoxStatus: null }),
    "perdendo",
  );
});
