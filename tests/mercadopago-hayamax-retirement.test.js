const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('relatório Mercado Pago importa somente evidência financeira bruta', () => {
  const syncRoute = read('src/app/api/sync/mercadopago-account-money/route.ts');

  assert.match(syncRoute, /parseMercadoPagoAccountMoneyCsv/);
  assert.match(syncRoute, /defaultToNull: false/);
  assert.doesNotMatch(syncRoute, /supplier_balance_movements/);
  assert.doesNotMatch(syncRoute, /matched_supplier|supplier_balance_movement_id/);
  assert.doesNotMatch(syncRoute, /topup|HAYAMAX|Hayamax/);
});

test('remove webhook, consulta de pagamento e SDK sem afetar o relatório', () => {
  const service = read('src/services/mercadopago.ts');
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(fs.existsSync(path.join(root, 'src/app/api/webhooks/mercadopago/route.ts')), false);
  assert.doesNotMatch(service, /MercadoPagoConfig|getMercadoPagoClient|getMercadoPagoPayment/);
  assert.match(service, /createAccountMoneyReport/);
  assert.match(service, /downloadAccountMoneyReport/);
  assert.equal(packageJson.dependencies.mercadopago, undefined);
});

test('remove contrato ativo Hayamax e preserva schema e histórico Mercado Pago', () => {
  const syncRoute = read('src/app/api/sync/mercadopago-account-money/route.ts');
  const parser = read('src/lib/mercadopago-account-money.ts');
  const migration = read('supabase/migrations/20260609202911_mercadopago_account_money.sql');
  const databaseTypes = read('src/types/database.ts');

  assert.doesNotMatch(syncRoute, /MERCADOPAGO_HAYAMAX_MATCHERS|MERCADOPAGO_WEBHOOK_SECRET/);
  assert.doesNotMatch(parser, /isHayamaxTopupCandidate|isReviewRequiredCandidate/);
  assert.match(migration, /create table if not exists public\.mercadopago_account_movements/i);
  assert.match(migration, /matched_supplier text null/);
  assert.match(migration, /supplier_balance_movement_id uuid null/);
  assert.match(databaseTypes, /mercadopago_account_movements/);
});
