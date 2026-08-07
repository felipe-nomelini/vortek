const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getJobIdempotencyKey,
  getJobPedidoId,
  getLatestJobSnapshot,
  isJobUniqueViolation,
  jobBelongsToPedido,
  normalizeIdempotencyKey,
} = require("../src/services/job-idempotency.ts");

test("aceita chave móvel válida e rejeita entrada insegura", () => {
  assert.equal(
    normalizeIdempotencyKey("mobile:whatsapp-label:sale-1:12345678"),
    "mobile:whatsapp-label:sale-1:12345678",
  );
  assert.equal(normalizeIdempotencyKey("curta"), null);
  assert.equal(normalizeIdempotencyKey("chave com espaço"), null);
});

test("valida pedido pelo dedupe key em jobs legados sem payload", () => {
  assert.equal(jobBelongsToPedido([], "pedido:pedido-123", "pedido-123"), true);
  assert.equal(jobBelongsToPedido([], "pedido:pedido-456", "pedido-123"), false);
});

test("recupera identidade e pedido do log do job", () => {
  const log = [{
    event: "progress_snapshot",
    payload: {
      pedidoId: "pedido-123",
      idempotencyKey: "mobile:resume-dslite:pedido-123:12345678",
    },
  }];
  assert.equal(getJobPedidoId(log), "pedido-123");
  assert.equal(
    getJobIdempotencyKey(log),
    "mobile:resume-dslite:pedido-123:12345678",
  );
});

test("usa snapshot mais recente e reconhece conflito único", () => {
  const log = [
    { event: "progress_snapshot", state: "running" },
    { event: "progress_snapshot", state: "success" },
  ];
  assert.equal(getLatestJobSnapshot(log).state, "success");
  assert.equal(isJobUniqueViolation({ code: "23505" }), true);
  assert.equal(isJobUniqueViolation({ code: "PGRST116" }), false);
});
