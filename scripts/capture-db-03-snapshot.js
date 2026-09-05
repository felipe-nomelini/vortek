#!/usr/bin/env node
/* eslint-disable no-console */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const DEFAULT_SCHEMAS = ['graphql_public', 'private', 'public'];
const DEFAULT_EXPOSED_SCHEMAS = ['graphql_public', 'public'];
const FORBIDDEN_OUTPUT_KEYS = /(?:password|secret|token|connection(?:_string)?|function_(?:body|definition)|source_code|^statements$|^rollback$|^raw_sql$)/i;

const SNAPSHOT_QUERIES = {
  server: {
    scoped: false,
    sql: `
      select
        current_database() as database_name,
        current_user as current_user,
        current_setting('server_version') as server_version,
        current_setting('server_version_num') as server_version_num
    `,
  },
  migration_registry: {
    scoped: false,
    sql: `
      select version::text as version, name,
        coalesce(cardinality(statements), 0) as statement_count,
        case when cardinality(statements) > 0 then md5(statements::text) end as statements_md5
      from supabase_migrations.schema_migrations
      order by version, name
    `,
  },
  roles: {
    scoped: false,
    sql: `
      select
        rolname as role_name,
        rolsuper as is_superuser,
        rolinherit as inherits_privileges,
        rolcreaterole as can_create_roles,
        rolcreatedb as can_create_databases,
        rolcanlogin as can_login,
        rolreplication as can_replicate,
        rolbypassrls as bypasses_rls
      from pg_catalog.pg_roles
      where rolname = any(array['anon', 'authenticated', 'authenticator', 'postgres', 'service_role'])
      order by rolname
    `,
  },
  schemas: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        pg_catalog.pg_get_userbyid(n.nspowner) as owner
      from pg_catalog.pg_namespace n
      where n.nspname = any($1::text[])
      order by n.nspname
    `,
  },
  schema_grants: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        pg_catalog.pg_get_userbyid(a.grantor) as grantor,
        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type,
        a.is_grantable
      from pg_catalog.pg_namespace n
      cross join lateral pg_catalog.aclexplode(
        coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
      ) a
      where n.nspname = any($1::text[])
      order by n.nspname, grantee, a.privilege_type, grantor
    `,
  },
  relations: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        c.relname as relation_name,
        case c.relkind
          when 'r' then 'table'
          when 'p' then 'partitioned_table'
          when 'v' then 'view'
          when 'm' then 'materialized_view'
          when 'f' then 'foreign_table'
        end as relation_kind,
        pg_catalog.pg_get_userbyid(c.relowner) as owner,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
      order by n.nspname, c.relname
    `,
  },
  relation_grants: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        c.relname as relation_name,
        case c.relkind
          when 'r' then 'table'
          when 'p' then 'partitioned_table'
          when 'v' then 'view'
          when 'm' then 'materialized_view'
          when 'f' then 'foreign_table'
        end as relation_kind,
        pg_catalog.pg_get_userbyid(a.grantor) as grantor,
        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type,
        a.is_grantable
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) a
      where n.nspname = any($1::text[])
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
      order by n.nspname, c.relname, grantee, a.privilege_type, grantor
    `,
  },
  column_grants: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        c.relname as relation_name,
        att.attname as column_name,
        pg_catalog.pg_get_userbyid(a.grantor) as grantor,
        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type,
        a.is_grantable
      from pg_catalog.pg_attribute att
      join pg_catalog.pg_class c on c.oid = att.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(att.attacl) a
      where n.nspname = any($1::text[])
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and att.attnum > 0
        and not att.attisdropped
        and att.attacl is not null
      order by n.nspname, c.relname, att.attnum, grantee, a.privilege_type, grantor
    `,
  },
  sequences: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        c.relname as sequence_name,
        pg_catalog.pg_get_userbyid(c.relowner) as owner
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])
        and c.relkind = 'S'
      order by n.nspname, c.relname
    `,
  },
  sequence_grants: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        c.relname as sequence_name,
        pg_catalog.pg_get_userbyid(a.grantor) as grantor,
        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type,
        a.is_grantable
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('s', c.relowner))
      ) a
      where n.nspname = any($1::text[])
        and c.relkind = 'S'
      order by n.nspname, c.relname, grantee, a.privilege_type, grantor
    `,
  },
  policies: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        c.relname as table_name,
        p.polname as policy_name,
        p.polpermissive as permissive,
        array(
          select case
            when role_oid = 0 then 'PUBLIC'::text
            else pg_catalog.pg_get_userbyid(role_oid)::text
          end
          from unnest(p.polroles) role_oid
          order by 1
        ) as roles,
        case p.polcmd
          when 'r' then 'SELECT'
          when 'a' then 'INSERT'
          when 'w' then 'UPDATE'
          when 'd' then 'DELETE'
          when '*' then 'ALL'
        end as command,
        pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expression,
        pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])
      order by n.nspname, c.relname, p.polname
    `,
  },
  constraints: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        c.relname as table_name,
        con.conname as constraint_name,
        case con.contype
          when 'c' then 'check'
          when 'f' then 'foreign_key'
          when 'n' then 'not_null'
          when 'p' then 'primary_key'
          when 'u' then 'unique'
          when 't' then 'constraint_trigger'
          when 'x' then 'exclusion'
        end as constraint_type,
        rn.nspname as referenced_schema,
        rc.relname as referenced_table,
        con.condeferrable as deferrable,
        con.condeferred as initially_deferred,
        con.convalidated as validated,
        pg_catalog.pg_get_constraintdef(con.oid, true) as definition
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      left join pg_catalog.pg_class rc on rc.oid = con.confrelid
      left join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
      where n.nspname = any($1::text[])
      order by n.nspname, c.relname, con.conname
    `,
  },
  indexes: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        t.relname as table_name,
        i.relname as index_name,
        am.amname as access_method,
        x.indisunique as is_unique,
        x.indisprimary as is_primary,
        x.indisexclusion as is_exclusion,
        x.indimmediate as is_immediate,
        x.indisclustered as is_clustered,
        x.indisvalid as is_valid,
        x.indcheckxmin as check_xmin,
        x.indisready as is_ready,
        x.indislive as is_live,
        x.indisreplident as is_replica_identity,
        pg_catalog.pg_get_expr(x.indpred, x.indrelid) as predicate,
        pg_catalog.pg_get_indexdef(x.indexrelid) as definition
      from pg_catalog.pg_index x
      join pg_catalog.pg_class t on t.oid = x.indrelid
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      join pg_catalog.pg_am am on am.oid = i.relam
      where n.nspname = any($1::text[])
      order by n.nspname, t.relname, i.relname
    `,
  },
  default_privileges: {
    scoped: true,
    sql: `
      select
        pg_catalog.pg_get_userbyid(d.defaclrole) as owner,
        case when d.defaclnamespace = 0 then null else n.nspname end as schema_name,
        case d.defaclobjtype
          when 'r' then 'relation'
          when 'S' then 'sequence'
          when 'f' then 'function'
          when 'T' then 'type'
          when 'n' then 'schema'
        end as object_type,
        pg_catalog.pg_get_userbyid(a.grantor) as grantor,
        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type,
        a.is_grantable
      from pg_catalog.pg_default_acl d
      left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
      cross join lateral pg_catalog.aclexplode(d.defaclacl) a
      where d.defaclnamespace = 0
        or n.nspname = any($1::text[])
      order by owner, schema_name nulls first, object_type, grantee, a.privilege_type, grantor
    `,
  },
  routine_grants: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as signature,
        pg_catalog.pg_get_userbyid(a.grantor) as grantor,
        case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type,
        a.is_grantable
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) a
      where n.nspname = any($1::text[])
      order by n.nspname, signature, grantee, a.privilege_type, grantor
    `,
  },
  security_definer_functions: {
    scoped: true,
    sql: `
      select
        n.nspname as schema_name,
        format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as signature,
        pg_catalog.pg_get_userbyid(p.proowner) as owner,
        l.lanname as language,
        case p.prokind
          when 'f' then 'function'
          when 'p' then 'procedure'
          when 'a' then 'aggregate'
          when 'w' then 'window'
        end as routine_kind,
        case p.provolatile
          when 'i' then 'immutable'
          when 's' then 'stable'
          when 'v' then 'volatile'
        end as volatility,
        p.proleakproof as leakproof,
        p.proisstrict as strict,
        p.proconfig as configuration,
        (
          select substring(setting from length('search_path=') + 1)
          from unnest(coalesce(p.proconfig, array[]::text[])) setting
          where setting like 'search_path=%'
          limit 1
        ) as search_path,
        md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_fingerprint
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      join pg_catalog.pg_language l on l.oid = p.prolang
      where n.nspname = any($1::text[])
        and p.prosecdef
      order by n.nspname, signature
    `,
  },
};

function parseCsv(value, fallback) {
  const parsed = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parsed.length ? parsed : fallback)].sort();
}

function readArg(name, fallback = null) {
  const exactIndex = process.argv.indexOf(`--${name}`);
  if (exactIndex >= 0) return process.argv[exactIndex + 1] || fallback;
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function structuralFingerprint(snapshot) {
  const structural = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !['captured_at', 'structural_fingerprint'].includes(key)),
  );
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(structural))).digest('hex');
}

function assertSafeOutput(value, currentPath = 'snapshot') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeOutput(item, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OUTPUT_KEYS.test(key)) {
      throw new Error(`Campo sensível proibido no snapshot: ${currentPath}.${key}`);
    }
    assertSafeOutput(child, `${currentPath}.${key}`);
  }
}

function repositoryMigrations(rootDirectory) {
  const migrationsDirectory = path.join(rootDirectory, 'supabase/migrations');
  return fs.readdirSync(migrationsDirectory)
    .filter((fileName) => /^\d+_.+\.sql$/.test(fileName))
    .sort()
    .map((fileName) => {
      const separator = fileName.indexOf('_');
      return {
        version: fileName.slice(0, separator),
        name: fileName.slice(separator + 1, -4),
        file: fileName,
        file_sha256: crypto.createHash('sha256')
          .update(fs.readFileSync(path.join(migrationsDirectory, fileName))).digest('hex'),
      };
    });
}

function assertUniqueMigrationVersions(migrations, label) {
  const seen = new Set();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Versão de migration duplicada em ${label}: ${migration.version}`);
    }
    seen.add(migration.version);
  }
}

// Compare only like representations: file bytes with file bytes, or recorded
// PostgreSQL text[] with recorded text[]. Neither proves semantic equivalence.
function migrationContentComparison(left, right, fingerprintField) {
  if (!['file_sha256', 'statements_md5'].includes(fingerprintField)) {
    throw new Error('Representação de fingerprint de migration inválida.');
  }
  assertUniqueMigrationVersions(left, 'left');
  assertUniqueMigrationVersions(right, 'right');
  const leftByVersion = new Map(left.map((item) => [item.version, item]));
  const rightByVersion = new Map(right.map((item) => [item.version, item]));
  return [...new Set([...leftByVersion.keys(), ...rightByVersion.keys()])].sort().map((version) => {
    const a = leftByVersion.get(version);
    const b = rightByVersion.get(version);
    const available = (item) => Boolean(item?.[fingerprintField])
      && (fingerprintField !== 'statements_md5' || item.statement_count > 0);
    let status;
    if (!a) status = 'right_only';
    else if (!b) status = 'left_only';
    else if (!available(a) || !available(b)) status = 'unavailable';
    else status = a[fingerprintField] === b[fingerprintField] ? 'matching' : 'different';
    return {
      version,
      left_name: a?.name ?? null,
      right_name: b?.name ?? null,
      representation: fingerprintField,
      status,
      requires_review: status !== 'matching' || a?.name !== b?.name,
    };
  });
}

function migrationComparison(repository, registry) {
  assertUniqueMigrationVersions(repository, 'repository');
  assertUniqueMigrationVersions(registry, 'registry');
  const repositoryByVersion = new Map(repository.map((migration) => [migration.version, migration]));
  const registryByVersion = new Map(registry.map((migration) => [migration.version, migration]));
  const repositoryOnly = repository.filter((migration) => !registryByVersion.has(migration.version));
  const databaseOnly = registry.filter((migration) => !repositoryByVersion.has(migration.version));
  const nameMismatches = registry.flatMap((migration) => {
    const local = repositoryByVersion.get(migration.version);
    return local && local.name !== migration.name
      ? [{ version: migration.version, repository_name: local.name, database_name: migration.name }]
      : [];
  });
  return {
    comparison_scope: 'version_and_name_only',
    content_equivalence: 'not_established',
    repository_count: repository.length,
    database_count: registry.length,
    repository_only: repositoryOnly,
    database_only: databaseOnly,
    name_mismatches: nameMismatches,
    exact_match: repositoryOnly.length === 0 && databaseOnly.length === 0 && nameMismatches.length === 0,
  };
}

function gitSha(rootDirectory) {
  return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: rootDirectory,
    encoding: 'utf8',
  }).trim();
}

function buildSummary(results, comparison, exposedSchemas) {
  const publicTables = results.relations.filter(
    (relation) => relation.schema_name === 'public'
      && ['table', 'partitioned_table'].includes(relation.relation_kind),
  );
  return {
    repository_migrations: comparison.repository_count,
    database_migrations: comparison.database_count,
    migrations_exact_match: comparison.exact_match,
    exposed_schemas: exposedSchemas,
    public_tables: publicTables.length,
    public_tables_without_rls: publicTables
      .filter((relation) => !relation.rls_enabled)
      .map((relation) => relation.relation_name),
    policies: results.policies.length,
    constraints: results.constraints.length,
    invalid_constraints: results.constraints
      .filter((constraint) => !constraint.validated)
      .map((constraint) => `${constraint.schema_name}.${constraint.constraint_name}`),
    indexes: results.indexes.length,
    invalid_or_unready_indexes: results.indexes
      .filter((index) => !index.is_valid || !index.is_ready || !index.is_live)
      .map((index) => `${index.schema_name}.${index.index_name}`),
    security_definer_functions: results.security_definer_functions.length,
  };
}

async function captureSnapshot({ client, label, rootDirectory, schemas, exposedSchemas }) {
  const missingExposedSchemas = exposedSchemas.filter((schema) => !schemas.includes(schema));
  if (missingExposedSchemas.length > 0) {
    throw new Error(`Schemas expostos fora da coleta: ${missingExposedSchemas.join(', ')}.`);
  }
  const results = {};
  try {
    await client.query('begin read only');
  } catch (error) {
    error.snapshotCategory = 'transaction_start';
    throw error;
  }
  try {
    for (const [name, query] of Object.entries(SNAPSHOT_QUERIES)) {
      try {
        const response = await client.query(query.sql, query.scoped ? [schemas] : []);
        results[name] = response.rows;
      } catch (error) {
        error.snapshotCategory = name;
        throw error;
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }

  const repository = repositoryMigrations(rootDirectory);
  const comparison = migrationComparison(repository, results.migration_registry);
  const server = results.server[0];
  const snapshot = {
    format_version: 3,
    environment: label,
    captured_at: new Date().toISOString(),
    git_sha: gitSha(rootDirectory),
    database: server,
    inspected_schemas: schemas,
    exposed_schemas: exposedSchemas,
    repository_migrations: repository,
    migration_registry: results.migration_registry,
    migration_comparison: comparison,
    roles: results.roles,
    schemas: results.schemas,
    schema_grants: results.schema_grants,
    relations: results.relations,
    relation_grants: results.relation_grants,
    column_grants: results.column_grants,
    sequences: results.sequences,
    sequence_grants: results.sequence_grants,
    policies: results.policies,
    constraints: results.constraints,
    indexes: results.indexes,
    default_privileges: results.default_privileges,
    routine_grants: results.routine_grants,
    security_definer_functions: results.security_definer_functions,
    summary: buildSummary(results, comparison, exposedSchemas),
  };
  snapshot.structural_fingerprint = structuralFingerprint(snapshot);
  assertSafeOutput(snapshot);
  return snapshot;
}

async function main() {
  const rootDirectory = process.cwd();
  const label = readArg('label', 'supabase-dev');
  const output = readArg('output');
  const expectedHost = String(process.env.DB_SNAPSHOT_EXPECTED_HOST || '').trim();
  const actualHost = String(process.env.PGHOST || '').trim();
  const schemas = parseCsv(process.env.DB_SNAPSHOT_SCHEMAS, DEFAULT_SCHEMAS);
  const exposedSchemas = parseCsv(
    process.env.DB_SNAPSHOT_EXPOSED_SCHEMAS,
    DEFAULT_EXPOSED_SCHEMAS,
  );

  if (!output) throw new Error('Informe --output para gravar o snapshot.');
  if (!expectedHost || !actualHost || expectedHost !== actualHost) {
    throw new Error('PGHOST não corresponde a DB_SNAPSHOT_EXPECTED_HOST.');
  }

  const client = new Client({ application_name: 'vortek_db_03_snapshot' });
  try {
    await client.connect();
  } catch (error) {
    error.snapshotCategory = 'connection';
    throw error;
  }
  try {
    const snapshot = await captureSnapshot({
      client,
      label,
      rootDirectory,
      schemas,
      exposedSchemas,
    });
    const outputPath = path.resolve(rootDirectory, output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    console.log(`Snapshot DB-03 salvo em ${path.relative(rootDirectory, outputPath)}.`);
    console.log(`Fingerprint estrutural: ${snapshot.structural_fingerprint}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const category = error.snapshotCategory ? ` em ${error.snapshotCategory}` : '';
    const routine = error.routine ? `, rotina ${error.routine}` : '';
    console.error(`Falha ao capturar snapshot DB-03${category} (${error.code || 'erro_local'}${routine}).`);
    process.exitCode = 1;
  });
}

module.exports = {
  SNAPSHOT_QUERIES,
  assertSafeOutput,
  buildSummary,
  captureSnapshot,
  migrationComparison,
  migrationContentComparison,
  repositoryMigrations,
  stableValue,
  structuralFingerprint,
};
