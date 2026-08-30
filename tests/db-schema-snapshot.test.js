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
