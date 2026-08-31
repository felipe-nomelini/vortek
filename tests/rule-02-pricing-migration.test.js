const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260830233000_rule_02_dynamic_pricing.sql'),
  'utf8',
);

test('migration exige alíquota explícita nas buscas de produtos', () => {
  assert.match(migration, /create or replace function public\.search_produtos_paginated\(\s*p_tax_rate numeric,/);
  assert.match(migration, /create or replace function public\.search_produtos_resumo\(\s*p_tax_rate numeric,/);
  assert.match(migration, /p_tax_rate is null or p_tax_rate < 0\.04 or p_tax_rate >= 1/g);
  assert.doesNotMatch(migration, /1\s*-\s*\(0\.04\s*\+/);
  assert.doesNotMatch(migration, /1\s*-\s*\(0\.05\s*\+/);
});

test('migration restringe leitura de faturamento e RPCs de busca ao service role', () => {
  assert.match(migration, /security definer\s+stable\s+set search_path = pg_catalog, pg_temp/);
  assert.match(migration, /revoke all on function public\.get_pricing_monthly_revenue\(date, date\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_pricing_monthly_revenue\(date, date\) to service_role/);
  assert.match(migration, /grant execute on function public\.search_produtos_paginated[\s\S]+to service_role/);
  assert.match(migration, /grant execute on function public\.search_produtos_resumo[\s\S]+to service_role/);
});

test('migration usa a mesma estratégia central de margem e lucro mínimo', () => {
  assert.match(migration, /when coalesce\(p_cost, 0\) <= 400 then 0\.15/);
  assert.match(migration, /when coalesce\(p_cost, 0\) <= 1000 then 0\.20/);
  assert.match(migration, /else 0\.25/);
  assert.match(migration, /when coalesce\(p_cost, 0\) <= 400 then 20/);
  assert.match(migration, /when coalesce\(p_cost, 0\) <= 1000 then 60/);
  assert.match(migration, /else 150/);
});
