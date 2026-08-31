const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.resolve(
  __dirname,
  '../supabase/migrations/20260830235900_rule_05_canonical_nfe_status.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');

test('migration converte somente aliases fiscais conhecidos', () => {
  assert.match(migration, /when 'autorizada' then 'authorized'/);
  assert.match(migration, /when 'cancelada' then 'cancelled'/);
  assert.match(migration, /when 'pendente' then 'pending'/);
  assert.match(migration, /when 'rejeitada' then 'rejected'/);
  assert.match(migration, /when 'denegada' then 'denied'/);
  assert.match(migration, /when 'outro' then 'other'/);
  assert.match(migration, /else nfe_status/);
  assert.doesNotMatch(migration, /else 'other'/);
});

test('migration define default e constraint canônicos com validação segura', () => {
  assert.match(migration, /alter column nfe_status set default 'pending'/);
  assert.match(migration, /constraint pedidos_nfe_status_check/);
  for (const status of [
    'authorized',
    'cancelled',
    'pending',
    'interrupted',
    'rejected',
    'denied',
    'processing',
    'not_found',
    'cancel_rejected_deadline',
    'other',
  ]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /\) not valid;/);
  assert.match(migration, /validate constraint pedidos_nfe_status_check/);
  assert.match(migration, /pg_catalog\.pg_constraint/);
});
