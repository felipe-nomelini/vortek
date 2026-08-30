const assert = require('node:assert/strict');
const test = require('node:test');

const { enqueueMlPublishOutbox } = require('../src/lib/sync/ml-publish-outbox.ts');

function createFakeClient(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row, payload: { ...(row.payload || {}) } }));
  let sequence = rows.length;

  class Query {
    constructor() {
      this.filters = [];
      this.orders = [];
      this.maxRows = null;
      this.mode = 'select';
      this.values = null;
    }

    select() { return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    contains(column, value) {
      this.filters.push((row) => Object.entries(value).every(([key, expected]) => row[column]?.[key] === expected));
      return this;
    }
    order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false }); return this; }
    limit(value) { this.maxRows = value; return this; }
    update(values) { this.mode = 'update'; this.values = values; return this; }
    insert(values) { this.mode = 'insert'; this.values = values; return this; }

    matchingRows() {
      let result = rows.filter((row) => this.filters.every((filter) => filter(row)));
      for (const order of [...this.orders].reverse()) {
        result = [...result].sort((left, right) => {
          const comparison = String(left[order.column] || '').localeCompare(String(right[order.column] || ''));
          return order.ascending ? comparison : -comparison;
        });
      }
      return this.maxRows === null ? result : result.slice(0, this.maxRows);
    }

    execute() {
      if (this.mode === 'update') {
        for (const row of this.matchingRows()) Object.assign(row, this.values);
        return { data: null, error: null };
      }
      if (this.mode === 'insert') {
        const inserted = { id: `new-${++sequence}`, created_at: new Date().toISOString(), ...this.values };
        rows.push(inserted);
        return { data: inserted, error: null };
      }
      return { data: this.matchingRows(), error: null };
    }

    maybeSingle() {
      const result = this.execute();
      return Promise.resolve({ data: result.data?.[0] || null, error: result.error });
    }

    single() {
      const result = this.execute();
      return Promise.resolve({ data: result.data, error: result.error });
    }

    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  return {
    rows,
    from() { return new Query(); },
  };
}

function completedStock(overrides = {}) {
  return {
    id: 'done-stock',
    produto_id: 'product',
    ml_item_id: 'MLB1',
    desired_quantity: 5,
    desired_status: 'ativo',
    desired_price: null,
    status: 'done',
    processed_at: '2026-08-30T01:00:00.000Z',
    created_at: '2026-08-30T00:59:00.000Z',
    payload: {
      apply_price: false,
      apply_quantity_pricing: false,
      apply_quantity: true,
      apply_status: true,
    },
    ...overrides,
  };
}

function stockInput(overrides = {}) {
  return {
    produtoId: 'product',
    mlItemId: 'MLB1',
    desiredQuantity: 5,
    desiredStatus: 'ativo',
    dedupePending: true,
    payload: {
      apply_price: false,
      apply_quantity_pricing: false,
      apply_quantity: true,
      apply_status: true,
      synced_at: '2026-08-30T02:00:00.000Z',
    },
    ...overrides,
  };
}

test('não cria outbox quando quantidade e status já foram publicados', async () => {
  const client = createFakeClient([completedStock()]);
  const result = await enqueueMlPublishOutbox(client, stockInput());
  assert.deepEqual(result, { ok: true, outboxId: 'done-stock', action: 'unchanged' });
  assert.equal(client.rows.length, 1);
});

test('timestamp diferente não transforma estoque igual em mudança', async () => {
  const client = createFakeClient([completedStock()]);
  const result = await enqueueMlPublishOutbox(client, stockInput({
    payload: { ...stockInput().payload, synced_at: '2026-08-31T10:00:00.000Z' },
  }));
  assert.equal(result.action, 'unchanged');
  assert.equal(client.rows.length, 1);
});

test('quantidade diferente cria nova publicação', async () => {
  const client = createFakeClient([completedStock()]);
  const result = await enqueueMlPublishOutbox(client, stockInput({ desiredQuantity: 6 }));
  assert.equal(result.action, 'inserted');
  assert.equal(client.rows.length, 2);
  assert.equal(client.rows[1].desired_quantity, 6);
  assert.equal(client.rows[1].payload.apply_quantity, true);
  assert.equal(client.rows[1].payload.apply_status, false);
});

test('compara com a publicação concluída mais recente da operação', async () => {
  const client = createFakeClient([
    completedStock({
      id: 'done-stock-old',
      desired_quantity: 5,
      processed_at: '2026-08-30T01:00:00.000Z',
    }),
    completedStock({
      id: 'done-stock-new',
      desired_quantity: 7,
      processed_at: '2026-08-30T02:00:00.000Z',
    }),
  ]);
  const result = await enqueueMlPublishOutbox(client, stockInput({ desiredQuantity: 5 }));
  assert.equal(result.action, 'inserted');
  assert.equal(client.rows.length, 3);
  assert.equal(client.rows[2].desired_quantity, 5);
});

test('status diferente publica somente status quando quantidade é igual', async () => {
  const client = createFakeClient([completedStock()]);
  const result = await enqueueMlPublishOutbox(client, stockInput({ desiredStatus: 'pausado' }));
  assert.equal(result.action, 'inserted');
  assert.equal(client.rows[1].payload.apply_quantity, false);
  assert.equal(client.rows[1].payload.apply_status, true);
});

test('preço diferente não reaplica quantidade igual', async () => {
  const client = createFakeClient([completedStock()]);
  const result = await enqueueMlPublishOutbox(client, stockInput({
    desiredPrice: 99.9,
    payload: { ...stockInput().payload, apply_price: true },
  }));
  assert.equal(result.action, 'inserted');
  assert.equal(client.rows[1].payload.apply_price, true);
  assert.equal(client.rows[1].payload.apply_quantity, false);
  assert.equal(client.rows[1].payload.apply_status, false);
});

test('pendência igual não reinicia tentativas nem timestamps', async () => {
  const pending = completedStock({
    id: 'pending-stock',
    status: 'retry',
    attempts: 2,
    available_at: '2026-08-30T03:00:00.000Z',
  });
  const client = createFakeClient([pending]);
  const result = await enqueueMlPublishOutbox(client, stockInput());
  assert.equal(result.action, 'unchanged');
  assert.equal(client.rows[0].attempts, 2);
  assert.equal(client.rows[0].available_at, '2026-08-30T03:00:00.000Z');
});

test('pendência diferente é atualizada na mesma linha', async () => {
  const client = createFakeClient([completedStock({ id: 'pending-stock', status: 'pending' })]);
  const result = await enqueueMlPublishOutbox(client, stockInput({ desiredQuantity: 7 }));
  assert.equal(result.action, 'updated_existing');
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].desired_quantity, 7);
});

test('processamento igual não duplica e processamento diferente cria sucessora', async () => {
  const sameClient = createFakeClient([completedStock({ id: 'processing-stock', status: 'processing' })]);
  const sameResult = await enqueueMlPublishOutbox(sameClient, stockInput());
  assert.equal(sameResult.action, 'unchanged');
  assert.equal(sameClient.rows.length, 1);

  const changedClient = createFakeClient([completedStock({ id: 'processing-stock', status: 'processing' })]);
  const changedResult = await enqueueMlPublishOutbox(changedClient, stockInput({ desiredQuantity: 8 }));
  assert.equal(changedResult.action, 'inserted');
  assert.equal(changedClient.rows.length, 2);
});

test('falha existente continua podendo ser reaberta', async () => {
  const client = createFakeClient([completedStock({ id: 'failed-stock', status: 'failed', attempts: 5 })]);
  const result = await enqueueMlPublishOutbox(client, stockInput());
  assert.equal(result.action, 'reopened_failed');
  assert.equal(client.rows[0].status, 'pending');
  assert.equal(client.rows[0].attempts, 0);
});

test('divergência observada força republicação da quantidade', async () => {
  const client = createFakeClient([completedStock()]);
  const result = await enqueueMlPublishOutbox(client, stockInput({
    forceQuantityPublish: true,
  }));
  assert.equal(result.action, 'inserted');
  assert.equal(client.rows[1].payload.apply_quantity, true);
  assert.equal(client.rows[1].payload.apply_status, false);
});

test('não recria outbox quando anúncio possui bloqueio terminal', async () => {
  const client = createFakeClient([{
    id: 'listing',
    ml_item_id: 'MLB1',
    status: 'ativo',
    ml_sync_block_reason: 'non_modifiable_status:under_review',
    ml_sync_blocked_until: null,
  }]);
  const result = await enqueueMlPublishOutbox(client, stockInput());
  assert.deepEqual(result, {
    ok: true,
    outboxId: null,
    action: 'skipped_ineligible',
    reason: 'non_modifiable_status:under_review',
    eligibility: 'terminally_blocked',
    retryAt: null,
  });
  assert.equal(client.rows.length, 1);
});

test('não recria outbox durante cooldown temporário', async () => {
  const blockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const client = createFakeClient([{
    id: 'listing',
    ml_item_id: 'MLB1',
    status: 'ativo',
    ml_sync_block_reason: 'field_not_updatable',
    ml_sync_blocked_until: blockedUntil,
  }]);
  const result = await enqueueMlPublishOutbox(client, stockInput());
  assert.equal(result.action, 'skipped_ineligible');
  assert.equal(result.eligibility, 'temporarily_blocked');
  assert.equal(result.retryAt, blockedUntil);
  assert.equal(client.rows.length, 1);
});

test('exclusão ignora bloqueio de publicação comum', async () => {
  const client = createFakeClient([{
    id: 'listing',
    ml_item_id: 'MLB1',
    status: 'ativo',
    ml_sync_block_reason: 'non_modifiable_status:closed',
    ml_sync_blocked_until: null,
  }]);
  const result = await enqueueMlPublishOutbox(client, stockInput({
    desiredQuantity: null,
    desiredStatus: null,
    payload: {
      apply_price: false,
      apply_quantity_pricing: false,
      apply_quantity: false,
      apply_status: false,
      delete_listing: true,
    },
  }));
  assert.equal(result.action, 'inserted');
  assert.equal(client.rows.length, 2);
});
