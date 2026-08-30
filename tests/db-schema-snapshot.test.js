const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SNAPSHOT_QUERIES,
  assertSafeOutput,
  buildSummary,
  captureSnapshot,
  migrationComparison,
  structuralFingerprint,
} = require('../scripts/capture-db-03-snapshot');

const REQUIRED_CATEGORIES = [
  'constraints',
  'default_privileges',
  'indexes',
  'migration_registry',
  'policies',
  'relation_grants',
  'relations',
  'routine_grants',
  'schema_grants',
  'security_definer_functions',
  'sequence_grants',
];

test('coletor cobre todas as categorias obrigatórias da DB-03', () => {
  for (const category of REQUIRED_CATEGORIES) {
    assert.ok(SNAPSHOT_QUERIES[category], `categoria ausente: ${category}`);
  }
  assert.equal(SNAPSHOT_QUERIES.default_privileges.scoped, true);
});

test('consultas do snapshot são comandos únicos e somente leitura', () => {
  for (const [name, query] of Object.entries(SNAPSHOT_QUERIES)) {
    const normalized = query.sql.trim().replace(/\s+/g, ' ');
    assert.match(normalized, /^(select|with)\b/i, `${name} não começa com SELECT/WITH`);
    assert.equal(normalized.includes(';'), false, `${name} contém mais de um comando`);
  }
});

test('snapshot não aceita campos com credenciais ou corpo de função', () => {
  assert.doesNotThrow(() => assertSafeOutput({ definition_fingerprint: 'abc', rows: [] }));
  assert.throws(() => assertSafeOutput({ password: 'não deve sair' }), /Campo sensível/);
  assert.throws(() => assertSafeOutput({ function_definition: 'não deve sair' }), /Campo sensível/);
  assert.throws(() => assertSafeOutput({ nested: { access_token: 'não deve sair' } }), /Campo sensível/);
});

test('comparação de migrations detecta paridade e divergências', () => {
  const repository = [
    { version: '1', name: 'primeira', file: '1_primeira.sql' },
    { version: '2', name: 'segunda', file: '2_segunda.sql' },
  ];
  assert.equal(migrationComparison(repository, [
    { version: '1', name: 'primeira' },
    { version: '2', name: 'segunda' },
  ]).exact_match, true);

  const divergent = migrationComparison(repository, [
    { version: '1', name: 'nome_diferente' },
    { version: '3', name: 'terceira' },
  ]);
  assert.equal(divergent.exact_match, false);
  assert.deepEqual(divergent.repository_only.map((item) => item.version), ['2']);
  assert.deepEqual(divergent.database_only.map((item) => item.version), ['3']);
  assert.deepEqual(divergent.name_mismatches.map((item) => item.version), ['1']);
});

test('fingerprint ignora horário da coleta e permanece determinístico', () => {
  const first = {
    captured_at: '2026-08-30T10:00:00.000Z',
    relations: [{ relation_name: 'b', schema_name: 'public' }],
    summary: { tables: 1 },
  };
  const second = {
    summary: { tables: 1 },
    relations: [{ schema_name: 'public', relation_name: 'b' }],
    captured_at: '2026-08-30T11:00:00.000Z',
  };
  assert.equal(structuralFingerprint(first), structuralFingerprint(second));
});

test('resumo evidencia RLS, constraints e índices inválidos', () => {
  const results = {
    relations: [
      { schema_name: 'public', relation_name: 'segura', relation_kind: 'table', rls_enabled: true },
      { schema_name: 'public', relation_name: 'aberta', relation_kind: 'table', rls_enabled: false },
    ],
    policies: [{}],
    constraints: [
      { schema_name: 'public', constraint_name: 'ok', validated: true },
      { schema_name: 'public', constraint_name: 'pendente', validated: false },
    ],
    indexes: [
      { schema_name: 'public', index_name: 'ok', is_valid: true, is_ready: true, is_live: true },
      { schema_name: 'public', index_name: 'invalido', is_valid: false, is_ready: true, is_live: true },
    ],
    security_definer_functions: [{ signature: 'public.fn()' }],
  };
  const summary = buildSummary(
    results,
    { repository_count: 2, database_count: 2, exact_match: true },
    ['public'],
  );
  assert.deepEqual(summary.public_tables_without_rls, ['aberta']);
  assert.deepEqual(summary.invalid_constraints, ['public.pendente']);
  assert.deepEqual(summary.invalid_or_unready_indexes, ['public.invalido']);
});

test('coleta rejeita schema exposto ausente do escopo de inspeção', async () => {
  await assert.rejects(
    () => captureSnapshot({
      client: {},
      label: 'supabase-dev',
      rootDirectory: process.cwd(),
      schemas: ['public'],
      exposedSchemas: ['graphql_public', 'public'],
    }),
    /Schemas expostos fora da coleta: graphql_public/,
  );
});
