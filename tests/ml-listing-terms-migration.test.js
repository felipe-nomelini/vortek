const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260913213000_ml_listing_terms_batch_audit.sql'),
  'utf8',
);

test('auditoria do lote restringe acesso e indexa chaves de consulta', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all[^;]+from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete[^;]+to service_role/i);
  assert.match(migration, /\(job_id, status, ordinal\)/i);
  assert.match(migration, /\(produto_id\)[\s\S]+where produto_id is not null/i);
});

test('auditoria limita ações e estados aceitos', () => {
  assert.match(migration, /action in \('normalize', 'delete_permanent', 'noop', 'blocked'\)/i);
  assert.match(migration, /status in \('prepared', 'applying', 'confirmed', 'skipped', 'blocked', 'error'\)/i);
});
