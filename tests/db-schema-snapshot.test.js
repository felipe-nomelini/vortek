const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  SNAPSHOT_QUERIES,
  assertSafeOutput,
  buildSummary,
  captureSnapshot,
  migrationComparison,
  migrationContentComparison,
  repositoryMigrations,
  structuralFingerprint,
} = require('../scripts/capture-db-03-snapshot');

const REQUIRED_CATEGORIES = [
  'column_grants',
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

const hardeningMigration = fs.readFileSync(
  path.resolve(
    __dirname,
    '../supabase/migrations/20260830220000_harden_public_schema_after_db03.sql',
  ),
  'utf8',
);

const postHardeningSnapshot = JSON.parse(fs.readFileSync(
  path.resolve(
    __dirname,
    '../reports/db-03/supabase-dev-2026-08-30-post-hardening.json',
  ),
  'utf8',
));

const executableHardeningSql = hardeningMigration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

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

test('paridade de versões e nomes não afirma equivalência de conteúdo', () => {
  const comparison = migrationComparison([{ version: '1', name: 'same', file_sha256: 'a' }], [
    { version: '1', name: 'same', statements_md5: 'b', statement_count: 1 },
  ]);
  assert.equal(comparison.exact_match, true);
  assert.equal(comparison.comparison_scope, 'version_and_name_only');
  assert.equal(comparison.content_equivalence, 'not_established');
});

test('versões duplicadas bloqueiam comparação antes de serem sobrescritas no Map', () => {
  const duplicate = [{ version: '1', name: 'a' }, { version: '1', name: 'b' }];
  for (const [left, right] of [[duplicate, []], [[], duplicate]]) {
    assert.throws(() => migrationComparison(left, right), /duplicada/);
    assert.throws(() => migrationContentComparison(left, right, 'file_sha256'), /duplicada/);
  }
});

test('conteúdo detecta colisão de versão mesmo com nome igual', () => {
  const a = [{ version: '20260830143000', name: 'same', file_sha256: 'a' }];
  const b = [{ version: '20260830143000', name: 'same', file_sha256: 'b' }];
  const [result] = migrationContentComparison(a, b, 'file_sha256');
  assert.equal(result.status, 'different');
  assert.equal(result.requires_review, true);
  b[0].name = 'another';
  assert.equal(migrationContentComparison(a, b, 'file_sha256')[0].status, 'different');
});

test('conteúdo desconhecido não é igualdade, inclusive registros vazios ou sem nome', () => {
  const a = [{ version: '1', name: 'a', statement_count: 1, statements_md5: 'hash' }];
  for (const b of [
    { version: '1', name: null },
    { version: '1', name: 'a', statement_count: 0, statements_md5: 'hash' },
    { version: '1', name: 'a', statement_count: 1, statements_md5: null },
  ]) {
    const [result] = migrationContentComparison(a, [b], 'statements_md5');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.requires_review, true);
  }
  const [renamed] = migrationContentComparison(a, [{ ...a[0], name: null }], 'statements_md5');
  assert.equal(renamed.status, 'matching');
  assert.equal(renamed.requires_review, true);
});

test('hashes de representações diferentes não podem ser comparados', () => {
  const left = [{ version: '1', name: 'a', file_sha256: 'same' }];
  const right = [{ version: '1', name: 'a', statements_md5: 'same', statement_count: 1 }];
  for (const field of ['file_sha256', 'statements_md5']) {
    assert.equal(migrationContentComparison(left, right, field)[0].status, 'unavailable');
  }
  assert.throws(() => migrationContentComparison(left, right, 'hash'), /inválida/);
});

test('comparação de conteúdo ordena versões e identifica exclusivas sem mutar entradas', () => {
  const a = [{ version: '3', name: 'third', file_sha256: 'c' }, { version: '1', name: 'first', file_sha256: 'a' }];
  const b = [{ version: '2', name: 'second', file_sha256: 'b' }, { ...a[1] }];
  const result = migrationContentComparison(a, b, 'file_sha256');
  assert.deepEqual(result.map((row) => row.status), ['matching', 'right_only', 'left_only']);
  assert.equal(result[0].requires_review, false);
  assert.equal(a[0].version, '3');
  assert.deepEqual(result, migrationContentComparison([...a].reverse(), [...b].reverse(), 'file_sha256'));
});

test('inventário calcula SHA-256 dos bytes sem publicar SQL', () => {
  const crypto = require('node:crypto');
  const inventory = repositoryMigrations(path.resolve(__dirname, '..'));
  assert.ok(inventory.length > 0);
  for (const entry of inventory) {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations', entry.file));
    assert.equal(entry.file_sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(Object.keys(entry).sort(), ['file', 'file_sha256', 'name', 'version']);
  }
  assertSafeOutput(inventory);
});

test('registro exporta somente contagem e fingerprint, nunca comandos ou rollback', () => {
  assert.match(SNAPSHOT_QUERIES.migration_registry.sql, /cardinality\(statements\)/);
  assert.match(SNAPSHOT_QUERIES.migration_registry.sql, /then md5\(statements::text\) end/);
  for (const key of ['statements', 'rollback', 'raw_sql']) {
    assert.throws(() => assertSafeOutput({ nested: [{ [key]: 'sensitive SQL' }] }), /Campo sensível/);
  }
});

test('evidência PARITY-13 reproduz comparações e classifica toda revisão sem liberar release', () => {
  const evidence = JSON.parse(fs.readFileSync(path.resolve(
    __dirname, '../reports/bnt-parity-13/reconciliation-2026-09-05.json',
  ), 'utf8'));
  assertSafeOutput(evidence);
  assert.equal(evidence.reconciliation_status, 'mapped_not_release_ready');
  assert.ok(evidence.release_blockers.length > 0);
  assert.equal(evidence.development.host, '192.168.1.162');
  assert.equal(evidence.production.host, '192.168.1.160');
  const pairs = {
    dev_files_main_files: migrationContentComparison(evidence.development.files, evidence.production.files, 'file_sha256'),
    dev_registry_production_registry: migrationContentComparison(evidence.development.registry, evidence.production.registry, 'statements_md5'),
  };
  assert.deepEqual(evidence.comparisons.dev_files_registry,
    migrationComparison(evidence.development.files, evidence.development.registry));
  assert.deepEqual(evidence.comparisons.main_files_registry,
    migrationComparison(evidence.production.files, evidence.production.registry));
  const reviews = new Set();
  for (const [comparison, rows] of Object.entries(pairs)) {
    assert.deepEqual(evidence.comparisons[comparison], rows);
    for (const row of rows.filter((item) => item.requires_review)) {
      const matches = evidence.reviews.filter((item) => item.comparison === comparison && item.version === row.version);
      assert.equal(matches.length, 1, `revisão ausente/duplicada: ${comparison}:${row.version}`);
      const treatment = evidence.treatments[matches[0].treatment];
      assert.ok(treatment?.classification && treatment?.scope && treatment?.evidence && treatment?.action);
      reviews.add(`${comparison}:${row.version}`);
    }
  }
  assert.equal(evidence.reviews.length, reviews.size);
  for (const environment of ['development', 'production']) {
    assert.equal(evidence[environment].read_only, 'on');
    assert.equal(evidence.verification[environment].read_only, 'on');
    assert.equal(evidence.verification[environment].registry_unchanged, true);
    assert.equal(evidence.verification[environment].catalog_unchanged, true);
    assert.equal(evidence.verification[environment].catalog_md5_after, evidence[environment].catalog_md5);
  }
  // New migrations are allowed; applied historical files may not be rewritten.
  const current = new Map(repositoryMigrations(path.resolve(__dirname, '..')).map((item) => [item.version, item]));
  for (const previous of evidence.development.files) {
    assert.deepEqual(current.get(previous.version), previous, `migration histórica alterada: ${previous.version}`);
  }
});

test('falha de coleta encerra transação somente leitura com rollback', async () => {
  const queries = [];
  const client = { query: async (sql) => {
    queries.push(sql);
    if (sql === SNAPSHOT_QUERIES.migration_registry.sql) throw new Error('simulated');
    return { rows: [] };
  } };
  await assert.rejects(() => captureSnapshot({
    client, label: 'test', rootDirectory: process.cwd(), schemas: ['public'], exposedSchemas: ['public'],
  }), /simulated/);
  assert.equal(queries[0], 'begin read only');
  assert.equal(queries.at(-1), 'rollback');
  assert.ok(!queries.includes('commit'));
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

test('hardening fecha RLS e grants sem remover a edição pessoal de profiles', () => {
  for (const table of [
    'ops_whatsapp_events',
    'whatsapp_alert_events',
    'whatsapp_alert_settings',
  ]) {
    assert.match(
      executableHardeningSql,
      new RegExp(`alter table public\\.${table} enable row level security;`, 'i'),
    );
  }
  assert.match(
    executableHardeningSql,
    /revoke all privileges on all tables in schema public from anon, authenticated;/i,
  );
  assert.match(
    executableHardeningSql,
    /revoke all privileges on all sequences in schema public from anon, authenticated;/i,
  );
  assert.match(
    executableHardeningSql,
    /grant select on table public\.profiles to authenticated;/i,
  );
  assert.match(
    executableHardeningSql,
    /grant update \(nome, avatar_url\) on table public\.profiles to authenticated;/i,
  );
  assert.doesNotMatch(executableHardeningSql, /grant update on table public\.profiles/i);
  assert.doesNotMatch(executableHardeningSql, /grant update \([^)]*cargo/i);
});

test('hardening reduz RPCs de cliente e normaliza as nove SECURITY DEFINER', () => {
  for (const routine of [
    'search_pedidos_paginated',
    'search_produtos_paginated',
    'search_produtos_resumo',
  ]) {
    assert.match(
      executableHardeningSql,
      new RegExp(`revoke execute on function public\\.${routine}\\(`, 'i'),
    );
  }

  const hardenedFunctions = [...executableHardeningSql.matchAll(
    /alter function\s+(?:public|private)\.([a-z0-9_]+)\([\s\S]*?\)\s+set search_path = pg_catalog, pg_temp;/gi,
  )].map((match) => match[1]);

  assert.deepEqual(hardenedFunctions, [
    'acquire_integracao_refresh_lock',
    'release_integracao_refresh_lock',
    'acquire_sync_domain_lock',
    'release_sync_domain_lock',
    'search_pedidos_paginated',
    'search_pedidos_resumo',
    'search_produtos_paginated',
    'search_produtos_resumo',
    'capture_ml_p0_population',
  ]);
  assert.doesNotMatch(executableHardeningSql, /supabase_admin/i);
  assert.doesNotMatch(executableHardeningSql, /from service_role/i);
});

test('hardening remove as quatro policies de cliente dos kits', () => {
  assert.equal(
    [...executableHardeningSql.matchAll(/drop policy if exists .* on public\.produto_kit(?:s|_componentes);/gi)].length,
    4,
  );
});

test('fotografia pós-hardening comprova o contrato mínimo do Data API', () => {
  assert.equal(postHardeningSnapshot.format_version, 2);
  assert.equal(postHardeningSnapshot.environment, 'supabase-dev-post-hardening');
  assert.equal(postHardeningSnapshot.migration_comparison.exact_match, true);
  assert.deepEqual(postHardeningSnapshot.summary.public_tables_without_rls, []);

  const clientRelationGrants = postHardeningSnapshot.relation_grants.filter(
    (grant) => ['anon', 'authenticated'].includes(grant.grantee),
  );
  assert.deepEqual(clientRelationGrants, [{
    schema_name: 'public',
    relation_name: 'profiles',
    relation_kind: 'table',
    grantor: 'postgres',
    grantee: 'authenticated',
    privilege_type: 'SELECT',
    is_grantable: false,
  }]);

  assert.deepEqual(postHardeningSnapshot.column_grants, [
    {
      schema_name: 'public',
      relation_name: 'profiles',
      column_name: 'nome',
      grantor: 'postgres',
      grantee: 'authenticated',
      privilege_type: 'UPDATE',
      is_grantable: false,
    },
    {
      schema_name: 'public',
      relation_name: 'profiles',
      column_name: 'avatar_url',
      grantor: 'postgres',
      grantee: 'authenticated',
      privilege_type: 'UPDATE',
      is_grantable: false,
    },
  ]);
  assert.deepEqual(
    postHardeningSnapshot.sequence_grants.filter(
      (grant) => ['anon', 'authenticated'].includes(grant.grantee),
    ),
    [],
  );
  assert.deepEqual(
    postHardeningSnapshot.default_privileges.filter(
      (grant) => grant.owner === 'postgres'
        && grant.schema_name === 'public'
        && ['relation', 'sequence'].includes(grant.object_type)
        && ['anon', 'authenticated'].includes(grant.grantee),
    ),
    [],
  );
  assert.deepEqual(
    postHardeningSnapshot.policies.filter(
      (policy) => ['produto_kits', 'produto_kit_componentes'].includes(policy.table_name),
    ),
    [],
  );
  assert.deepEqual(
    postHardeningSnapshot.security_definer_functions.filter(
      (routine) => routine.search_path !== 'pg_catalog, pg_temp',
    ),
    [],
  );
  assert.deepEqual(
    postHardeningSnapshot.routine_grants.filter(
      (grant) => grant.grantee === 'authenticated'
        && /search_(?:pedidos_paginated|produtos_paginated|produtos_resumo)/.test(grant.signature),
    ),
    [],
  );
});
