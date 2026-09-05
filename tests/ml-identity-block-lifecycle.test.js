const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  clearAutomaticMlIdentityBlock,
  ensureAutomaticMlIdentityBlock,
  ML_IDENTITY_GATE_CREATED_BY,
} = require("../src/lib/ml/identity-block.ts");

const root = path.resolve(__dirname, "..");
const syncRouteSource = fs.readFileSync(
  path.join(root, "src/app/api/sync/anuncios/route.ts"),
  "utf8",
);
const createRouteSource = fs.readFileSync(
  path.join(root, "src/app/api/ml/anuncio/criar/route.ts"),
  "utf8",
);

function createClient({ existing = null, lookupError = null, writeError = null } = {}) {
  const operations = [];

  function filteredOperation(kind, values) {
    const operation = { kind, values, filters: [] };
    operations.push(operation);
    const builder = {
      eq(column, value) {
        operation.filters.push([column, value]);
        return builder;
      },
      then(resolve) {
        resolve({ error: writeError });
      },
    };
    return builder;
  }

  return {
    operations,
    from(table) {
      assert.equal(table, "ml_manual_blocklist");
      return {
        select(columns) {
          const operation = { kind: "select", columns, filters: [] };
          operations.push(operation);
          const builder = {
            eq(column, value) {
              operation.filters.push([column, value]);
              return builder;
            },
            limit(value) {
              operation.limit = value;
              return builder;
            },
            async maybeSingle() {
              return { data: existing, error: lookupError };
            },
          };
          return builder;
        },
        async insert(values) {
          operations.push({ kind: "insert", values });
          return { error: writeError };
        },
        update(values) {
          return filteredOperation("update", values);
        },
      };
    },
  };
}

test("encerra somente o bloqueio automático ativo do item validado", async () => {
  const client = createClient();

  assert.deepEqual(await clearAutomaticMlIdentityBlock(client, "MLB123"), { ok: true });
  assert.deepEqual(client.operations, [
    {
      kind: "update",
      values: { ativo: false },
      filters: [
        ["ml_item_id", "MLB123"],
        ["ativo", true],
        ["created_by", ML_IDENTITY_GATE_CREATED_BY],
      ],
    },
  ]);
});

test("não duplica bloqueio quando já existe bloqueio ativo", async () => {
  const client = createClient({ existing: { id: "existing-block" } });

  assert.deepEqual(
    await ensureAutomaticMlIdentityBlock(client, "MLB123", "Divergência"),
    { ok: true },
  );
  assert.equal(client.operations.some((operation) => operation.kind === "insert"), false);
});

test("novo bloqueio registra a propriedade automática sem bloquear o SKU", async () => {
  const client = createClient();

  assert.deepEqual(
    await ensureAutomaticMlIdentityBlock(client, "MLB123", "Divergência"),
    { ok: true },
  );
  const insert = client.operations.find((operation) => operation.kind === "insert");
  assert.deepEqual(insert.values, {
    ml_item_id: "MLB123",
    sku: null,
    ativo: true,
    motivo: "Divergência",
    created_by: ML_IDENTITY_GATE_CREATED_BY,
  });
});

test("erro ao limpar o bloqueio é propagado", async () => {
  const client = createClient({ writeError: { message: "database unavailable" } });

  assert.deepEqual(await clearAutomaticMlIdentityBlock(client, "MLB123"), {
    ok: false,
    error: "database unavailable",
  });
});

test("sync encerra bloqueio somente após identidade válida e mantém fornecedores operacionais", () => {
  const assessmentIndex = syncRouteSource.indexOf("const identityAssessment = assessMlProductIdentity(");
  const supplierPolicyIndex = syncRouteSource.indexOf("operationalSupplierIds", assessmentIndex);
  const validIdentityIndex = syncRouteSource.indexOf("if (identityConflicts.length === 0)", assessmentIndex);
  const clearIndex = syncRouteSource.indexOf("clearAutomaticMlIdentityBlock(", validIdentityIndex);

  assert.ok(assessmentIndex >= 0);
  assert.ok(supplierPolicyIndex > assessmentIndex);
  assert.ok(validIdentityIndex > supplierPolicyIndex);
  assert.ok(clearIndex > validIdentityIndex);
  assert.equal(syncRouteSource.includes("ensureMlIdentityManualBlock"), false);
});

test("criação e vínculo reconciliam bloqueio resolvido sem remover o gate de conflito", () => {
  const assessments = createRouteSource.match(/assessMlProductIdentity\(/g) || [];
  const reconciliations = createRouteSource.match(/reconcileResolvedMlIdentity\(/g) || [];

  assert.equal(assessments.length, 2);
  assert.equal(reconciliations.length, 3);
  assert.match(createRouteSource, /const identityConflicts = identityAssessment\.blockingConflicts/);
  assert.match(createRouteSource, /identity_conflicts: identityConflicts/);
  assert.match(createRouteSource, /pauseCreatedListing\(result\.id\)/);
});
