const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20260916180000_oraculo_supplier_settlements_schema.sql'),
  'utf8',
);
const databaseTypes = readFileSync(join(root, 'src/types/database.ts'), 'utf8');

test('ORC-01 cria apenas o schema passivo e mantém compras existentes desconhecidas', () => {
  assert.match(migration, /create table if not exists public\.supplier_settlements\s*\(/);
  assert.match(migration, /create table if not exists public\.supplier_settlement_items\s*\(/);
  assert.match(migration, /supply_status text not null default 'unknown'/);
  assert.match(migration, /label_type text/);
  assert.match(migration, /label_delivery_channel text/);
  assert.match(migration, /label_delivered_at timestamptz/);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:compras|pedidos|supplier_balance_movements)\b/i);
});

test('ORC-01 preserva unicidade da compra ativa e restringe acesso direto', () => {
  assert.match(migration, /create unique index if not exists supplier_settlement_items_compra_active_unique[\s\S]*?where released_at is null;/);
  assert.match(migration, /alter table public\.supplier_settlements enable row level security;/);
  assert.match(migration, /alter table public\.supplier_settlement_items enable row level security;/);
  assert.match(migration, /revoke all on table public\.supplier_settlements, public\.supplier_settlement_items\s+from public, anon, authenticated, service_role;/);
  assert.match(migration, /grant select, insert, update on table public\.supplier_settlements, public\.supplier_settlement_items\s+to service_role;/);
  assert.doesNotMatch(migration, /\bgrant\s+delete\b/i);
});

test('tipos compartilhados incluem as novas relações e campos', () => {
  for (const name of [
    'supplier_settlements:',
    'supplier_settlement_items:',
    'supplier_settlement_id:',
    'supply_status:',
    'label_type:',
    'label_delivery_channel:',
    'label_delivered_at:',
  ]) {
    assert.ok(databaseTypes.includes(name), `Campo ausente: ${name}`);
  }
});
