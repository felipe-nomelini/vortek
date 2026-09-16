const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Pool } = require('pg');

const connectionString = process.env.ORACULO_TEST_DATABASE_URL;
const enabled = Boolean(connectionString);
let pool;

function requireSafeTarget() {
  const target = new URL(connectionString);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/oraculo_core_test') {
    throw new Error('ORACULO_TEST_DATABASE_URL deve apontar apenas para 127.0.0.1/oraculo_core_test');
  }
}

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001';
const supplierId = '00000000-0000-4000-8000-000000000002';
const purchaseA = '00000000-0000-4000-8000-000000000011';
const purchaseB = '00000000-0000-4000-8000-000000000012';
const fingerprint = 'a'.repeat(64);

async function query(sql, params = []) { return pool.query(sql, params); }

async function seed(options = {}) {
  await query('truncate public.jobs, public.supplier_balance_movements, public.supplier_settlement_items, public.supplier_settlements, public.compras, public.pedidos, public.fornecedores, auth.users cascade');
  await query('insert into auth.users(id) values ($1)', [actor]);
  await query(`insert into public.fornecedores(id,dslite_id,nome,apelido,cnpj,supplier_pix_key,telefone)
    values ($1,'108','Fornecedor Teste','Teste','11222333000181','chave-teste','11999999999')`, [supplierId]);
  await query(`insert into public.compras(id,dsid,fornecedor_id,supplier_payment_mode,supplier_payment_status,
    supplier_payment_amount,supply_status,produto_descricao,data_criacao) values
    ($1,'110','108','prepaid_pix','pending',50,'ready','Produto A','2026-09-01'),
    ($2,'120','108','prepaid_pix','pending',70,'ready','Produto B','2026-09-02')`, [purchaseA, purchaseB]);
  await query(`insert into public.pedidos(dslite_id,numero,ml_order_id,situacao,snapshot_incompleto,
    snapshot_pendencias,label_type,label_delivery_channel,label_delivered_at) values
    ('110',101,'ML-101','pendente',false,'[]','real','dslite',now()),
    ('120',102,'ML-102','pendente',false,'[]','real','whatsapp',now())`);
  if (options.credit) {
    await query(`insert into public.supplier_balance_movements(fornecedor_id,movement_type,amount,status)
      values ('108','manual_credit',$1,'confirmed')`, [options.credit]);
  }
}

async function prepare(ids, credit, key, hash = fingerprint) {
  const result = await query('select public.supplier_oracle_prepare($1,$2::uuid[],$3,$4,$5,$6) as result',
    ['108', ids, credit, key, hash, actor]);
  return result.rows[0].result;
}

async function confirm(id, reference = 'PIX-TESTE') {
  const result = await query('select public.supplier_oracle_confirm($1,1,$2,null,$3) as result', [id, reference, actor]);
  return result.rows[0].result;
}

before(async () => {
  if (!enabled) return;
  requireSafeTarget();
  const admin = new Client({ connectionString });
  await admin.connect();
  await admin.query('drop schema if exists auth cascade; drop schema if exists public cascade; create schema public');
  await admin.query('drop role if exists anon; drop role if exists authenticated; drop role if exists service_role');
  await admin.query(read('tests/fixtures/oraculo-core-base.sql'));
  await admin.query(read('supabase/migrations/20260916180000_oraculo_supplier_settlements_schema.sql'));
  await admin.query(read('supabase/migrations/20260916193000_oraculo_supplier_settlement_core.sql'));
  await admin.query(read('supabase/migrations/20260916193000_oraculo_supplier_settlement_core.sql'));
  await admin.end();
  pool = new Pool({ connectionString, max: 5 });
});

after(async () => { if (pool) await pool.end(); });

test('ORC-03 prepara, reserva e cancela sem consumir crédito', { skip: !enabled }, async () => {
  await seed({ credit: 60 });
  const first = await prepare([purchaseA], 40, 'prepare-cancel-001');
  assert.equal(first.status, 'prepared');
  assert.equal((await prepare([purchaseA], 40, 'prepare-cancel-001')).replayed, true);
  await assert.rejects(prepare([purchaseA], 40, 'prepare-cancel-001', 'b'.repeat(64)), /idempotência/i);
  assert.equal(Number((await query("select public.supplier_oracle_credit_preview('108') as amount")).rows[0].amount), 20);
  await assert.rejects(query(`insert into public.supplier_balance_movements(fornecedor_id,movement_type,amount,status)
    values ('108','credit_usage',-30,'confirmed')`), /disponível insuficiente/i);
  const cancelled = (await query('select public.supplier_oracle_cancel($1,1,$2) as result', [first.id, actor])).rows[0].result;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await query('select public.supplier_oracle_cancel($1,1,$2) as result', [first.id, actor])).rows[0].result.replayed, true);
  assert.equal(Number((await query("select public.supplier_oracle_credit_preview('108') as amount")).rows[0].amount), 60);
  assert.equal((await query('select supplier_settlement_id from public.compras where id=$1', [purchaseA])).rows[0].supplier_settlement_id, null);
});

test('ORC-03 confirma uma vez, distribui crédito e deixa job pendente', { skip: !enabled }, async () => {
  await seed({ credit: 60 });
  const prepared = await prepare([purchaseB, purchaseA], 60, 'prepare-confirm-001');
  const confirmed = await confirm(prepared.id);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal((await confirm(prepared.id)).replayed, true);
  await assert.rejects(confirm(prepared.id, 'OUTRA-REFERENCIA'), /conteúdo diferente/i);
  const items = (await query('select dsid_snapshot,gross_amount,credit_amount,pix_amount from public.supplier_settlement_items order by dsid_snapshot')).rows;
  assert.deepEqual(items.map((item) => [Number(item.gross_amount), Number(item.credit_amount), Number(item.pix_amount)]), [[50, 50, 0], [70, 10, 60]]);
  assert.equal(Number((await query('select count(*) as total from public.compras where supplier_payment_status=$1', ['paid'])).rows[0].total), 2);
  assert.equal(Number((await query("select count(*) as total from public.supplier_balance_movements where movement_type='credit_usage'")).rows[0].total), 1);
  assert.equal(Number((await query("select count(*) as total from public.jobs where tipo='supplier_settlement_postprocess' and status='pendente'")).rows[0].total), 1);
  await assert.rejects(query('select public.supplier_oracle_cancel($1,1,$2)', [prepared.id, actor]), /já foi confirmada/i);
});

test('ORC-03 quita integralmente por crédito sem PIX fictício', { skip: !enabled }, async () => {
  await seed({ credit: 60 });
  const prepared = await prepare([purchaseA], 50, 'prepare-zero-pix-001');
  assert.equal((await query('select pix_amount from public.supplier_settlements where id=$1', [prepared.id])).rows[0].pix_amount, '0.00');
  await assert.rejects(confirm(prepared.id, 'PIX-INDEVIDO'), /não tem referência PIX/i);
  assert.equal((await confirm(prepared.id, null)).status, 'confirmed');
  assert.equal((await query('select supplier_payment_reference from public.compras where id=$1', [purchaseA])).rows[0].supplier_payment_reference, null);
});

test('ORC-03 serializa preparações concorrentes da mesma compra e do mesmo saldo', { skip: !enabled }, async () => {
  await seed({ credit: 60 });
  const results = await Promise.allSettled([
    prepare([purchaseA], 50, 'concurrent-item-a'),
    prepare([purchaseA], 50, 'concurrent-item-b'),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(Number((await query("select count(*) as total from public.supplier_settlements where status='prepared'")).rows[0].total), 1);
  await seed({ credit: 60 });
  const creditResults = await Promise.allSettled([
    prepare([purchaseA], 50, 'concurrent-credit-a'),
    prepare([purchaseB], 50, 'concurrent-credit-b'),
  ]);
  assert.equal(creditResults.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(Number((await query("select sum(credit_amount) as total from public.supplier_settlements where status='prepared'")).rows[0].total), 50);
});

test('ORC-03 rejeita divergência e reverte confirmação inteira', { skip: !enabled }, async () => {
  await seed({ credit: 60 });
  const prepared = await prepare([purchaseA, purchaseB], 40, 'prepare-divergence-001');
  await query("update public.pedidos set ml_claim_id='claim-test' where dslite_id='120'");
  await assert.rejects(confirm(prepared.id), /não elegível/i);
  assert.equal((await query('select status from public.supplier_settlements where id=$1', [prepared.id])).rows[0].status, 'prepared');
  assert.equal(Number((await query("select count(*) as total from public.compras where supplier_payment_status='paid'")).rows[0].total), 0);
  assert.equal(Number((await query('select count(*) as total from public.jobs')).rows[0].total), 0);
  assert.equal(Number((await query("select count(*) as total from public.supplier_balance_movements where movement_type='credit_usage'")).rows[0].total), 0);
});

test('ORC-03 bloqueia alteração da conta e crédito pendente não vira saldo', { skip: !enabled }, async () => {
  await seed();
  await query(`insert into public.supplier_balance_movements(fornecedor_id,movement_type,amount,status)
    values ('108','cancellation_credit',60,'pending')`);
  await assert.rejects(prepare([purchaseA], 1, 'prepare-pending-001'), /insuficiente/i);
  const prepared = await prepare([purchaseA], 0, 'prepare-account-001');
  await query("update public.fornecedores set supplier_pix_key='outra-chave' where dslite_id='108'");
  await assert.rejects(confirm(prepared.id), /Cadastro financeiro mudou/i);
  assert.equal((await query('select status from public.supplier_settlements where id=$1', [prepared.id])).rows[0].status, 'prepared');
});

test('ORC-03 impede edição de confirmação e escrita direta pelo service_role', { skip: !enabled }, async () => {
  await seed({ credit: 60 });
  const prepared = await prepare([purchaseA], 10, 'prepare-immutable-001');
  await confirm(prepared.id);
  await assert.rejects(query("update public.supplier_settlements set gross_amount=1 where id=$1", [prepared.id]), /imutável/i);
  await assert.rejects(query("update public.supplier_balance_movements set amount=-1 where supplier_settlement_id=$1", [prepared.id]), /imutável/i);
  assert.equal((await query("select has_table_privilege('service_role','public.supplier_settlements','INSERT') as allowed")).rows[0].allowed, false);
  assert.equal((await query("select has_table_privilege('service_role','public.supplier_settlement_items','UPDATE') as allowed")).rows[0].allowed, false);
  assert.equal((await query("select has_function_privilege('anon','public.supplier_oracle_prepare(text,uuid[],numeric,text,text,text)','EXECUTE') as allowed")).rows[0].allowed, false);
});

test('ORC-03 permite RPC ao service_role, sem conceder escrita direta', { skip: !enabled }, async () => {
  await seed();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('set role service_role');
    assert.equal(Number((await client.query("select public.supplier_oracle_credit_preview('108') as amount")).rows[0].amount), 0);
    await assert.rejects(client.query(`insert into public.supplier_settlements
      (fornecedor_id,fornecedor_dslite_id,fornecedor_nome_snapshot,cnpj_snapshot,supplier_pix_key_snapshot,
       gross_amount,pix_amount,idempotency_key,request_fingerprint,prepared_by)
      values ($1,'108','Teste','11222333000181','chave-teste',10,10,'forbidden-write','${fingerprint}','teste')`,
    [supplierId]), /permission denied/i);
  } finally {
    await client.query('reset role');
    await client.end();
  }
});
