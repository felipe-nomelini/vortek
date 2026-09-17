const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Pool } = require('pg');
const { randomUUID } = require('node:crypto');

const connectionString = process.env.ORACULO_TEST_DATABASE_URL;
const enabled = Boolean(connectionString);
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001';
const supplier = '00000000-0000-4000-8000-000000000002';
const purchaseA = '00000000-0000-4000-8000-000000000011';
const purchaseB = '00000000-0000-4000-8000-000000000012';
let pool;

function safeTarget() {
  const url = new URL(connectionString);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/oraculo_core_test') {
    throw new Error('Banco sintético deve ser 127.0.0.1/oraculo_core_test');
  }
}
const query = (sql, params = []) => pool.query(sql, params);

async function seed() {
  await query(`truncate public.supplier_cancellation_cases, public.jobs, public.supplier_balance_movements,
    public.supplier_settlement_items, public.supplier_settlements, public.compras, public.pedidos,
    public.fornecedores, auth.users cascade`);
  await query('insert into auth.users(id) values ($1)', [actor]);
  await query(`insert into public.fornecedores(id,dslite_id,nome,apelido,cnpj,supplier_pix_key,telefone)
    values ($1,'108','Fornecedor Teste','Teste','11222333000181','chave-teste','11999999999')`, [supplier]);
  await query(`insert into public.compras(id,dsid,fornecedor_id,fornecedor_nome,supplier_payment_mode,
    supplier_payment_status,supplier_payment_amount,supply_status,produto_descricao,data_criacao) values
    ($1,'110','108','Teste','prepaid_pix','pending',50,'ready','Produto A','2026-09-01'),
    ($2,'120','108','Teste','prepaid_pix','pending',70,'ready','Produto B','2026-09-02')`, [purchaseA, purchaseB]);
  const sales = await query(`insert into public.pedidos(dslite_id,numero,ml_order_id,situacao,snapshot_incompleto,
    snapshot_pendencias,label_type,label_delivery_channel,label_delivered_at) values
    ('110',101,'ML-101','pendente',false,'[]','real','dslite',now()),
    ('120',102,'ML-102','pendente',false,'[]','real','whatsapp',now()) returning id,dslite_id`);
  return Object.fromEntries(sales.rows.map((row) => [row.dslite_id, row.id]));
}
async function prepare(ids) {
  const key = `orc06-${randomUUID()}`;
  return (await query('select public.supplier_oracle_prepare($1,$2::uuid[],$3,$4,$5,$6) result',
    ['108', ids, 0, key, 'a'.repeat(64), actor])).rows[0].result;
}
async function confirm(id) {
  return (await query('select public.supplier_oracle_confirm($1,1,$2,null,$3) result',
    [id, 'PIX-TESTE', actor])).rows[0].result;
}
async function record(compraId, pedidoId, dispatch, evidence) {
  return (await query('select public.supplier_oracle_record_cancellation($1,$2,$3,$4,$5::jsonb,$6) result',
    [compraId, pedidoId, 'ml_sync', dispatch, JSON.stringify(evidence), 'ml_sync'])).rows[0].result;
}

before(async () => {
  if (!enabled) return;
  safeTarget();
  const admin = new Client({ connectionString });
  await admin.connect();
  try {
    await admin.query('drop schema if exists auth cascade; drop schema if exists public cascade; create schema public');
    await admin.query('drop role if exists anon; drop role if exists authenticated; drop role if exists service_role');
    await admin.query(read('tests/fixtures/oraculo-core-base.sql'));
    for (const file of [
      'supabase/migrations/20260916180000_oraculo_supplier_settlements_schema.sql',
      'supabase/migrations/20260916193000_oraculo_supplier_settlement_core.sql',
      'supabase/migrations/20260916230000_oraculo_supplier_settlement_receipt.sql',
      'supabase/migrations/20260916233000_oraculo_supplier_cancellations.sql',
      'supabase/migrations/20260916233000_oraculo_supplier_cancellations.sql',
      'supabase/migrations/20260917130000_oraculo_simplify_purchase_eligibility.sql',
    ]) await admin.query(read(file));
  } finally { await admin.end(); }
  pool = new Pool({ connectionString, max: 5 });
});
after(async () => { if (pool) await pool.end(); });

test('fechamento dispensa classificação, revisão e etiqueta; preserva bloqueio de cancelamento', { skip: !enabled }, async () => {
  const sales = await seed();
  await query("update public.compras set supply_status='unknown', status_dslite='Aguardando Informações' where id=$1", [purchaseA]);
  await query("update public.pedidos set label_type='provisional', label_delivered_at=null, snapshot_incompleto=true, ml_claim_id='claim' where id=$1", [sales['110']]);
  const settlement = await prepare([purchaseA]);
  assert.equal((await confirm(settlement.id)).status, 'confirmed');
  assert.equal((await query('select supplier_payment_status from public.compras where id=$1', [purchaseA])).rows[0].supplier_payment_status, 'paid');

  await seed();
  await query("update public.pedidos set situacao='cancelado' where dslite_id='110'");
  await assert.rejects(prepare([purchaseA]), /Venda cancelada/i);
});

test('ORC-06: cancelamento antes do PIX invalida o lote inteiro e libera reservas', { skip: !enabled }, async () => {
  const sale = await seed();
  const settlement = await prepare([purchaseA, purchaseB]);
  await query("update public.pedidos set situacao='cancelado' where id=$1", [sale['110']]);
  const result = await record(purchaseA, sale['110'], 'unknown', { source: 'payment_pending', proof: 'not_paid' });
  assert.equal(result.classification, 'unpaid');
  assert.equal((await query('select status from public.supplier_settlements where id=$1', [settlement.id])).rows[0].status, 'cancelled');
  assert.equal(Number((await query('select count(*) total from public.compras where supplier_settlement_id is not null')).rows[0].total), 0);
  assert.equal((await query('select supply_status from public.compras where id=$1', [purchaseA])).rows[0].supply_status, 'cancelled');
  assert.equal(Number((await query('select count(*) total from public.supplier_balance_movements')).rows[0].total), 0);
  assert.equal((await record(purchaseA, sale['110'], 'unknown', { proof: 'not_paid' })).replayed, true);
});

test('ORC-06: pago antes do despacho cria um só crédito pendente pelo bruto', { skip: !enabled }, async () => {
  const sale = await seed();
  const settlement = await prepare([purchaseA]);
  await confirm(settlement.id);
  await query("update public.pedidos set situacao='cancelado' where id=$1", [sale['110']]);
  const result = await record(purchaseA, sale['110'], 'not_dispatched',
    { source: 'ml_history', proof: 'cancelled_history', shipmentId: '1' });
  assert.equal(result.classification, 'paid_pre_dispatch');
  const movement = (await query("select amount,status,supplier_settlement_id from public.supplier_balance_movements where movement_type='cancellation_credit'")).rows[0];
  assert.equal(Number(movement.amount), 50);
  assert.equal(movement.status, 'pending');
  assert.equal(movement.supplier_settlement_id, settlement.id);
  assert.equal((await record(purchaseA, sale['110'], 'not_dispatched',
    { source: 'ml_history', proof: 'cancelled_history', shipmentId: '1' })).replayed, true);
  assert.equal(Number((await query("select count(*) total from public.supplier_balance_movements where movement_type='cancellation_credit'")).rows[0].total), 1);
  assert.equal((await query('select status from public.supplier_settlements where id=$1', [settlement.id])).rows[0].status, 'confirmed');
});

test('ORC-06: eventos concorrentes para a mesma compra não duplicam o crédito', { skip: !enabled }, async () => {
  const sale = await seed();
  await query("update public.compras set supplier_payment_status='paid' where id=$1", [purchaseA]);
  await query("update public.pedidos set situacao='cancelado' where id=$1", [sale['110']]);
  const evidence = { source: 'ml_history', proof: 'cancelled_history', shipmentId: '1' };
  const results = await Promise.all([
    record(purchaseA, sale['110'], 'not_dispatched', evidence),
    record(purchaseA, sale['110'], 'not_dispatched', evidence),
  ]);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(Number((await query("select count(*) total from public.supplier_balance_movements where movement_type='cancellation_credit'")).rows[0].total), 1);
});

test('ORC-06: despacho comprovado não cria crédito; incerteza exige decisão', { skip: !enabled }, async () => {
  const sale = await seed();
  const settlement = await prepare([purchaseA]);
  await confirm(settlement.id);
  await query("update public.pedidos set situacao='cancelado' where id=$1", [sale['110']]);
  const dispatched = await record(purchaseA, sale['110'], 'dispatched',
    { source: 'ml_history', proof: 'dispatch_history', shipmentId: '1' });
  assert.equal(dispatched.classification, 'paid_post_dispatch');
  assert.equal(Number((await query("select count(*) total from public.supplier_balance_movements where movement_type='cancellation_credit'")).rows[0].total), 0);
  await seed();
  await query("update public.compras set supplier_payment_status='paid' where id=$1", [purchaseA]);
  const saleId = (await query("update public.pedidos set situacao='cancelado' where dslite_id='110' returning id")).rows[0].id;
  const uncertain = await record(purchaseA, saleId, 'unknown', { source: 'ml_history', proof: 'history_unavailable' });
  assert.equal(uncertain.status, 'open');
  const resolved = (await query('select public.supplier_oracle_resolve_cancellation($1,1,$2,$3,$4) result',
    [uncertain.caseId, 'pending_credit', 'Fornecedor confirmou a devolução integral', actor])).rows[0].result;
  assert.equal(resolved.status, 'closed');
  assert.equal((await query('select status from public.supplier_balance_movements where id=$1', [resolved.movementId])).rows[0].status, 'pending');
});

test('ORC-06: evidência tardia exige compensação sem editar o crédito original', { skip: !enabled }, async () => {
  const sale = await seed();
  await query("update public.compras set supplier_payment_status='paid' where id=$1", [purchaseA]);
  await query("update public.pedidos set situacao='cancelado' where id=$1", [sale['110']]);
  const first = await record(purchaseA, sale['110'], 'not_dispatched',
    { source: 'ml_history', proof: 'cancelled_history' });
  await query("update public.supplier_balance_movements set status='confirmed' where id=$1", [first.movementId]);
  const changed = await record(purchaseA, sale['110'], 'dispatched',
    { source: 'ml_history', proof: 'dispatch_history' });
  assert.equal(changed.status, 'open');
  const result = (await query('select public.supplier_oracle_resolve_cancellation($1,2,$2,$3,$4) result',
    [first.caseId, 'compensate', 'Histórico comprovou coleta anterior ao cancelamento', actor])).rows[0].result;
  const rows = (await query('select movement_type,amount,origin_movement_id from public.supplier_balance_movements order by created_at')).rows;
  assert.equal(result.status, 'closed');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].movement_type, 'cancellation_credit');
  assert.equal(Number(rows[1].amount), -50);
  assert.equal(rows[1].origin_movement_id, first.movementId);
});

test('ORC-06: tabela protegida e RPC sem acesso direto do cliente', { skip: !enabled }, async () => {
  assert.equal((await query("select has_table_privilege('authenticated','public.supplier_cancellation_cases','SELECT') allowed")).rows[0].allowed, false);
  assert.equal((await query("select has_function_privilege('authenticated','public.supplier_oracle_record_cancellation(uuid,uuid,text,text,jsonb,text)','EXECUTE') allowed")).rows[0].allowed, false);
  assert.equal((await query("select has_function_privilege('service_role','public.supplier_oracle_record_cancellation(uuid,uuid,text,text,jsonb,text)','EXECUTE') allowed")).rows[0].allowed, true);
});

test('ORC-06: divergência aberta bloqueia preparo, confirmação e aprovação do crédito', { skip: !enabled }, async () => {
  await seed();
  await query(`insert into public.supplier_cancellation_cases(compra_id,fornecedor_id,classification,status,source,evidence)
    values ($1,'108','review','open','ml_sync','{}')`, [purchaseA]);
  await assert.rejects(prepare([purchaseA]), /não elegível/i);
  await seed();
  const settlement = await prepare([purchaseA]);
  await query(`insert into public.supplier_cancellation_cases(compra_id,fornecedor_id,classification,status,source,evidence)
    values ($1,'108','review','open','ml_sync','{}')`, [purchaseA]);
  await assert.rejects(confirm(settlement.id), /não elegível/i);
  const movementId = (await query(`insert into public.supplier_balance_movements
    (fornecedor_id,movement_type,amount,status) values ('108','cancellation_credit',50,'pending') returning id`)).rows[0].id;
  await query('update public.supplier_cancellation_cases set movement_id=$1 where compra_id=$2', [movementId, purchaseA]);
  await assert.rejects(query('select public.supplier_oracle_decide_cancellation_credit($1,$2,$3,$4)',
    [movementId, 'confirmed', 'Tentativa indevida', actor]), /divergência aberta/i);
  await assert.rejects(query("update public.supplier_balance_movements set status='confirmed' where id=$1", [movementId]), /divergência aberta/i);
});
