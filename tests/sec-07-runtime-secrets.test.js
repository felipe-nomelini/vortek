const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationSource = fs.readFileSync(
  path.join(
    __dirname,
    '../supabase/migrations/20260830210000_secure_runtime_api_secret.sql',
  ),
  'utf8',
);

const auditScriptSource = fs.readFileSync(
  path.join(__dirname, '../scripts/audit-syncs-production.js'),
  'utf8',
);

test('migration transfere a API key legada para o Supabase Vault', () => {
  assert.match(
    migrationSource,
    /create extension if not exists supabase_vault with schema vault/,
  );
  assert.match(migrationSource, /vault\.create_secret\(/);
  assert.match(migrationSource, /vault\.update_secret\(/);
  assert.match(
    migrationSource,
    /delete from public\.sync_runtime_config\s+where key = 'api_secret_key'/,
  );
  assert.match(
    migrationSource,
    /check \(key <> 'api_secret_key'\)/,
  );
});

test('os três dispatchers leem o secret exclusivamente do Vault', () => {
  const functionDefinitions = migrationSource.slice(
    migrationSource.indexOf('create or replace function public.dispatch_sync_cron'),
  );

  assert.equal(
    functionDefinitions.match(/from vault\.decrypted_secrets/g)?.length,
    3,
  );
  assert.equal(
    functionDefinitions.match(/where name = 'vortek\.runtime\.api_secret_key'/g)?.length,
    3,
  );
  assert.doesNotMatch(
    functionDefinitions,
    /from public\.sync_runtime_config\s+where key = 'api_secret_key'/,
  );
});

test('funções privilegiadas mantêm search_path e grants restritos', () => {
  assert.equal(
    migrationSource.match(/set search_path = pg_catalog, pg_temp/g)?.length,
    3,
  );
  assert.equal(
    migrationSource.match(/from public, anon, authenticated, service_role/g)?.length,
    3,
  );
  assert.equal(
    migrationSource.match(/grant execute on function .* to postgres/g)?.length,
    3,
  );
});

test('auditoria exige API_SECRET_KEY do ambiente sem fallback no banco', () => {
  assert.match(auditScriptSource, /process\.env\.API_SECRET_KEY/);
  assert.match(auditScriptSource, /API_SECRET_KEY ausente/);
  assert.doesNotMatch(auditScriptSource, /\.from\('sync_runtime_config'\)/);
  assert.doesNotMatch(auditScriptSource, /\.eq\('key', 'api_secret_key'\)/);
});
