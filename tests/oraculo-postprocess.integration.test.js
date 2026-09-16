const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Pool } = require('pg');

const connectionString = process.env.ORACULO_TEST_DATABASE_URL;
const enabled = Boolean(connectionString);
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001';
const supplierA = '00000000-0000-4000-8000-000000000002';
const supplierB = '00000000-0000-4000-8000-000000000003';
const purchaseA = '00000000-0000-4000-8000-000000000011';
const purchaseB = '00000000-0000-4000-8000-000000000012';
let pool;
const query = (sql, params = []) => pool.query(sql, params);

before(async () => {
  if (!enabled) return;
  const target = new URL(connectionString);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/oraculo_core_test') {
    throw Error('ORACULO_TEST_DATABASE_URL deve apontar apenas para 127.0.0.1/oraculo_core_test');
  }
  const admin = new Client({ connectionString });
  await admin.connect();
  await admin.query('drop schema if exists auth cascade; drop schema if exists public cascade; create schema public');
  await admin.query('drop role if exists anon; drop role if exists authenticated; drop role if exists service_role');
  await admin.query(read('tests/fixtures/oraculo-core-base.sql'));
  for (const file of [
    'supabase/migrations/20260916180000_oraculo_supplier_settlements_schema.sql',
    'supabase/migrations/20260916193000_oraculo_supplier_settlement_core.sql',
    'supabase/migrations/20260916210000_oraculo_supplier_settlement_postprocess.sql',
    'supabase/migrations/20260916210000_oraculo_supplier_settlement_postprocess.sql',
  ]) await admin.query(read(file));
  await admin.end();
  pool = new Pool({ connectionString, max: 4 });
});
after(async () => { if (pool) await pool.end(); });

async function seed() {
  await query('truncate public.supplier_oracle_manual_decisions, public.supplier_settlement_communication_members, public.supplier_settlement_communications, public.supplier_settlement_resume_effects, public.jobs, public.supplier_balance_movements, public.supplier_settlement_items, public.supplier_settlements, public.compras, public.pedidos, public.fornecedores, auth.users cascade');
  await query('insert into auth.users(id) values ($1)', [actor]);
  await query(`insert into public.fornecedores(id,dslite_id,nome,apelido,cnpj,supplier_pix_key,telefone) values
    ($1,'108','Fornecedor A','A','11222333000181','pix-a','11999999999'),
    ($2,'109','Fornecedor B','B','11444777000161','pix-b','11999999999')`, [supplierA, supplierB]);
  await query(`insert into public.compras(id,dsid,fornecedor_id,supplier_payment_mode,supplier_payment_status,
    supplier_payment_amount,supply_status,produto_descricao,data_criacao) values
    ($1,'110','108','prepaid_pix','pending',50,'ready','Produto A','2026-09-01'),
    ($2,'120','109','prepaid_pix','pending',70,'ready','Produto B','2026-09-02')`, [purchaseA, purchaseB]);
  await query(`insert into public.pedidos(dslite_id,numero,ml_order_id,situacao,snapshot_incompleto,
    snapshot_pendencias,label_type,label_delivery_channel,label_delivered_at) values
    ('110',101,'ML-101','pendente',false,'[]','real','dslite',now()),
    ('120',102,'ML-102','pendente',false,'[]','real','whatsapp',now())`);
}

async function settlement(supplier, purchase, key) {
  const first = await query('select public.supplier_oracle_prepare($1,$2::uuid[],0,$3,$4,$5) as data',
    [supplier, [purchase], key, 'a'.repeat(64), actor]);
  const id = first.rows[0].data.id;
  await query('select public.supplier_oracle_confirm($1,1,$2,null,$3)', [id, `PIX-${key}`, actor]);
  return id;
}

test('ORC-04 agrupa CNPJs por contato, aprova uma vez e toma job sem disputa', { skip: !enabled }, async () => {
  await seed();
  const a = await settlement('108', purchaseA, 'orc04-group-a');
  const b = await settlement('109', purchaseB, 'orc04-group-b');
  const ids = [a, b];
  const key = 'b'.repeat(64);
  const draft = (await query('select public.supplier_oracle_communication_draft($1::uuid[],$2,$3,$4) as data',
    [ids, key, 'Mensagem com CNPJ A e CNPJ B', actor])).rows[0].data;
  assert.equal(draft.status, 'draft');
  assert.equal((await query('select public.supplier_oracle_communication_draft($1::uuid[],$2,$3,$4) as data',
    [ids, key, 'Mensagem com CNPJ A e CNPJ B', actor])).rows[0].data.replayed, true);
  await assert.rejects(query('select public.supplier_oracle_communication_draft($1::uuid[],$2,$3,$4)',
    [[a], 'c'.repeat(64), 'Outra mensagem', actor]), /já reservada/i);
  const approved = (await query('select public.supplier_oracle_communication_approve($1,1,$2) as data',
    [draft.id, actor])).rows[0].data;
  assert.equal(approved.status, 'approved');
  await assert.rejects(query('select public.supplier_oracle_communication_approve($1,1,$2)',
    [draft.id, actor]), /já aprovado/i);
  const clientA = new Client({ connectionString });
  const clientB = new Client({ connectionString });
  await Promise.all([clientA.connect(), clientB.connect()]);
  const claimed = await Promise.all([clientA.query("select public.supplier_oracle_claim_job('supplier_settlement_communication') as data"),
    clientB.query("select public.supplier_oracle_claim_job('supplier_settlement_communication') as data")]);
  assert.equal(claimed.filter((result) => result.rows[0].data).length, 1);
  await Promise.all([clientA.end(), clientB.end()]);
});

test('ORC-04 bloqueia contato diferente e liquidação não confirmada', { skip: !enabled }, async () => {
  await seed();
  await query("update public.fornecedores set telefone='11988888888' where id=$1", [supplierB]);
  const a = await settlement('108', purchaseA, 'orc04-contact-a');
  const b = await settlement('109', purchaseB, 'orc04-contact-b');
  await assert.rejects(query('select public.supplier_oracle_communication_draft($1::uuid[],$2,$3,$4)',
    [[a,b], 'c'.repeat(64), 'Mensagem', actor]), /Contatos diferentes/i);
});

test('ORC-04 requisições simultâneas do mesmo rascunho convergem para um registro', { skip: !enabled }, async () => {
  await seed();
  const a = await settlement('108', purchaseA, 'orc04-race-a');
  const clients = [new Client({ connectionString }), new Client({ connectionString })];
  await Promise.all(clients.map((client) => client.connect()));
  const results = await Promise.all(clients.map((client) => client.query(
    'select public.supplier_oracle_communication_draft($1::uuid[],$2,$3,$4) as data',
    [[a], 'd'.repeat(64), 'Uma mensagem revisável', actor],
  )));
  assert.equal(new Set(results.map((result) => result.rows[0].data.id)).size, 1);
  assert.equal(Number((await query('select count(*) as n from public.supplier_settlement_communications')).rows[0].n), 1);
  await Promise.all(clients.map((client) => client.end()));
});

test('ORC-04 exige decisão humana e justificativa para efeito incerto', { skip: !enabled }, async () => {
  await seed();
  const a = await settlement('108', purchaseA, 'orc04-resolve-a');
  const order = (await query("select id from public.pedidos where dslite_id='110'")).rows[0].id;
  await query("insert into public.supplier_settlement_resume_effects(settlement_id,pedido_id,status) values ($1,$2,'uncertain')", [a,order]);
  await assert.rejects(query('select public.supplier_oracle_resolve_resume($1,$2,$3,$4,$5)',
    [a,order,'not_occurred','curta',actor]), /inválida/i);
  const resolved = (await query('select public.supplier_oracle_resolve_resume($1,$2,$3,$4,$5) as data',
    [a,order,'not_occurred','Conferido manualmente',actor])).rows[0].data;
  assert.equal(resolved.status, 'pending');
  assert.equal((await query('select status from public.jobs where id=$1',[resolved.job_id])).rows[0].status,'pendente');
  assert.equal((await query("select count(*)::int as n from public.supplier_oracle_manual_decisions where target_type='resume'")).rows[0].n, 1);
  await assert.rejects(query('select public.supplier_oracle_resolve_resume($1,$2,$3,$4,$5)',
    [a,order,'already_occurred','Conferido manualmente',actor]), /não aguarda/i);
});

test('ORC-04 comunicação incerta não é reprocessada sem resolução', { skip: !enabled }, async () => {
  await seed();
  const a = await settlement('108', purchaseA, 'orc04-message-resolution');
  const draft = (await query('select public.supplier_oracle_communication_draft($1::uuid[],$2,$3,$4) as data',
    [[a], 'e'.repeat(64), 'Mensagem revisada', actor])).rows[0].data;
  await query('select public.supplier_oracle_communication_approve($1,1,$2)', [draft.id, actor]);
  const job = (await query("select id from public.jobs where tipo='supplier_settlement_communication'")).rows[0].id;
  await query("update public.jobs set status='on_hold' where id=$1", [job]);
  await query("update public.supplier_settlement_communications set status='uncertain' where id=$1", [draft.id]);
  await assert.rejects(query('select public.supplier_oracle_requeue_job($1,$2,$3)',
    [job,'Sem confirmação do fornecedor',actor]), /Resolva o envio/i);
  const resolved = (await query('select public.supplier_oracle_resolve_communication($1,$2,$3,$4) as data',
    [draft.id,'not_sent','Conferido no histórico WAHA',actor])).rows[0].data;
  assert.equal(resolved.status, 'approved');
  assert.equal((await query('select status from public.jobs where id=$1',[job])).rows[0].status,'pendente');
});

test('ORC-04 funções novas não são executáveis pelo cliente e RLS fica ativo', { skip: !enabled }, async () => {
  const rights = await query(`select
    has_function_privilege('authenticated','public.supplier_oracle_communication_draft(uuid[],text,text,text)','EXECUTE') as draft,
    has_function_privilege('authenticated','public.supplier_oracle_claim_job(text)','EXECUTE') as claim,
    has_function_privilege('service_role','public.supplier_oracle_claim_job(text)','EXECUTE') as service`);
  assert.deepEqual(rights.rows[0], { draft: false, claim: false, service: true });
  const rls = await query("select count(*)::int as n from pg_class where relname like 'supplier_settlement_%' and relname in ('supplier_settlement_resume_effects','supplier_settlement_communications','supplier_settlement_communication_members') and relrowsecurity");
  assert.equal(rls.rows[0].n, 3);
  assert.equal((await query("select relrowsecurity from pg_class where relname='supplier_oracle_manual_decisions'")).rows[0].relrowsecurity, true);
  const service = await pool.connect();
  try {
    await service.query('begin');
    await service.query('set local role service_role');
    await service.query("select public.supplier_oracle_claim_job('supplier_settlement_communication')");
    await service.query('rollback');
  } finally { service.release(); }
});
