const assert = require('node:assert/strict');
const test = require('node:test');

const load = require('./helpers/load-integration-module');
const audit = load('src/services/pricing-audit.ts', { zod: require('zod') });
const { persistSingleAnuncioBySku } = load('src/lib/ml/persist-single-anuncio.ts', { '@/services/pricing-audit': audit });

function createClient(initialRows) {
  const rows = initialRows.map((row) => ({ ...row }));
  const operations = [];

  return {
    rows,
    operations,
    async rpc(name, args) {
      assert.equal(name, 'persist_ml_pricing_observations');
      for (const patch of args.p_rows) {
        const current = rows.find(row => row.ml_item_id === patch.ml_item_id);
        operations.push(current ? { type: 'update', column: 'id', value: current.id } : { type: 'upsert', item: patch.ml_item_id });
        if (current) Object.assign(current, patch); else rows.push({ id: `row-${rows.length + 1}`, ...patch });
      }
      return { data: args.p_rows, error: null };
    },
    from(table) {
      assert.equal(table, 'anuncios_ml');
      return {
        select() {
          return {
            async eq(column, value) {
              return { data: rows.filter((row) => row[column] === value).map((row) => ({ ...row })), error: null };
            },
          };
        },
        update(patch) {
          return {
            async eq(column, value) {
              operations.push({ type: 'update', column, value });
              const row = rows.find((entry) => entry[column] === value);
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          };
        },
        async upsert(payload) {
          operations.push({ type: 'upsert', item: payload.ml_item_id });
          const existing = rows.find((entry) => entry.ml_item_id === payload.ml_item_id);
          if (existing) Object.assign(existing, payload);
          else rows.push({ id: `row-${rows.length + 1}`, ...payload });
          return { error: null };
        },
      };
    },
  };
}

test('preserva anúncios legítimos diferentes do mesmo SKU e produto', async () => {
  const client = createClient([{
    id: 'row-1',
    ml_item_id: 'MLB1',
    sku: 'VTK001',
    produto_id: 'produto-1',
  }]);

  const result = await persistSingleAnuncioBySku(client, {
    ml_item_id: 'MLB2',
    sku: 'VTK001',
    produto_id: 'produto-1',
    titulo: 'Segundo anúncio legítimo',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(client.rows.map((row) => row.ml_item_id).sort(), ['MLB1', 'MLB2']);
  assert.deepEqual(result.removedDuplicateIds, []);
});

test('atualiza somente a linha do mesmo ml_item_id', async () => {
  const client = createClient([
    { id: 'row-1', ml_item_id: 'MLB1', sku: 'VTK001', produto_id: 'produto-1', titulo: 'Um' },
    { id: 'row-2', ml_item_id: 'MLB2', sku: 'VTK001', produto_id: 'produto-1', titulo: 'Dois' },
  ]);

  const result = await persistSingleAnuncioBySku(client, {
    ml_item_id: 'MLB2',
    sku: 'VTK001',
    produto_id: 'produto-1',
    titulo: 'Dois atualizado',
  });

  assert.equal(result.ok, true);
  assert.equal(client.rows.find((row) => row.ml_item_id === 'MLB1').titulo, 'Um');
  assert.equal(client.rows.find((row) => row.ml_item_id === 'MLB2').titulo, 'Dois atualizado');
});

test('bloqueia reutilização de SKU associado a outro produto', async () => {
  const client = createClient([{
    id: 'row-1',
    ml_item_id: 'MLB1',
    sku: 'VTK001',
    produto_id: 'produto-1',
  }]);

  const result = await persistSingleAnuncioBySku(client, {
    ml_item_id: 'MLB2',
    sku: 'VTK001',
    produto_id: 'produto-2',
    titulo: 'Anúncio conflitante',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Conflito de SKU VTK001/);
  assert.equal(client.operations.length, 0);
});
