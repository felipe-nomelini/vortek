#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const TARGET_BALANCE = 2462.05;
const HAYAMAX_FORNECEDOR_ID = '2';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function money(value) {
  return Number(Number(value).toFixed(2));
}

async function balance() {
  const { data, error } = await client
    .from('supplier_balance_movements')
    .select('amount')
    .eq('fornecedor_id', HAYAMAX_FORNECEDOR_ID);
  if (error) throw error;
  return money((data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
}

async function compraIdByDsid(dsid) {
  const { data, error } = await client
    .from('compras')
    .select('id')
    .eq('dsid', String(dsid))
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function upsertMovement(row) {
  const compraId = row.dsid ? await compraIdByDsid(row.dsid) : null;
  const payload = {
    fornecedor_id: HAYAMAX_FORNECEDOR_ID,
    fornecedor_nome: 'HAYAMAX',
    movement_type: row.type,
    amount: money(row.amount),
    reference: row.reference,
    compra_id: compraId,
    notes: row.notes,
    created_by: 'manual:hayamax_2026-06-16',
    movement_key: row.key,
    created_at: row.createdAt,
  };

  if (!APPLY) {
    console.log('[dry-run] upsert', payload);
    return null;
  }

  const { data: existing, error: lookupError } = await client
    .from('supplier_balance_movements')
    .select('id')
    .eq('movement_key', row.key)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const query = existing?.id
    ? client.from('supplier_balance_movements').update(payload).eq('id', existing.id)
    : client.from('supplier_balance_movements').insert(payload);

  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw error;

  if (row.dsid && row.type === 'purchase_debit') {
    await client
      .from('compras')
      .update({ supplier_payment_amount: Math.abs(payload.amount) })
      .eq('dsid', String(row.dsid));
  }

  return data?.id || null;
}

const rows = [
  {
    key: 'purchase:375322',
    type: 'purchase_debit',
    amount: -54.49,
    reference: 'Compra DSLite 375322',
    dsid: '375322',
    createdAt: '2026-06-15T15:00:00-03:00',
    notes: 'Valor reconciliado pelo extrato Hayamax de 16/06/2026.',
  },
  {
    key: 'hayamax-ledger:2026-06-15:itens-compensados-credit-1872-68',
    type: 'adjustment',
    amount: 1872.68,
    reference: 'ITENS COMPENSADOS',
    createdAt: '2026-06-15T15:05:00-03:00',
    notes: 'Movimento importado do extrato Hayamax.',
  },
  {
    key: 'hayamax-ledger:2026-06-15:itens-compensados-debit-1953-02',
    type: 'adjustment',
    amount: -1953.02,
    reference: 'ITENS COMPENSADOS',
    createdAt: '2026-06-15T15:06:00-03:00',
    notes: 'Movimento importado do extrato Hayamax.',
  },
  {
    key: 'purchase:375600',
    type: 'purchase_debit',
    amount: -461.07,
    reference: 'Compra DSLite 375600',
    dsid: '375600',
    createdAt: '2026-06-15T15:10:00-03:00',
    notes: 'Valor reconciliado pelo extrato Hayamax de 16/06/2026.',
  },
  {
    key: 'purchase:375823',
    type: 'purchase_debit',
    amount: -57.08,
    reference: 'Compra DSLite 375823',
    dsid: '375823',
    createdAt: '2026-06-15T15:11:00-03:00',
    notes: 'Valor reconciliado pelo extrato Hayamax de 16/06/2026.',
  },
  {
    key: 'purchase:375457',
    type: 'purchase_debit',
    amount: -105.67,
    reference: 'Compra DSLite 375457',
    dsid: '375457',
    createdAt: '2026-06-15T15:12:00-03:00',
    notes: 'Valor reconciliado pelo extrato Hayamax de 16/06/2026.',
  },
  {
    key: 'hayamax-ledger:2026-06-10:creddropship-dsl-374501-59-29',
    type: 'topup',
    amount: 59.29,
    reference: '**CREDROPSHIP**2744298 DSL-374501',
    dsid: '374501',
    createdAt: '2026-06-10T15:00:00-03:00',
    notes: 'Crédito importado do extrato Hayamax.',
  },
  {
    key: 'hayamax-ledger:2026-06-15:creddropship-80-34',
    type: 'topup',
    amount: 80.34,
    reference: '**CREDROPSHIP**2744298',
    createdAt: '2026-06-15T16:00:00-03:00',
    notes: 'Crédito importado do extrato Hayamax.',
  },
  {
    key: 'hayamax-ledger:2026-06-15:creddropship-3000-00',
    type: 'topup',
    amount: 3000,
    reference: '**CREDROPSHIP**2744298',
    createdAt: '2026-06-15T16:01:00-03:00',
    notes: 'Crédito importado do extrato Hayamax.',
  },
  {
    key: 'purchase:376307',
    type: 'purchase_debit',
    amount: -461.07,
    reference: 'Compra DSLite 376307',
    dsid: '376307',
    createdAt: '2026-06-16T09:00:00-03:00',
    notes: 'Valor reconciliado pelo extrato Hayamax de 16/06/2026.',
  },
  {
    key: 'purchase:376308',
    type: 'purchase_debit',
    amount: -216.51,
    reference: 'Compra DSLite 376308',
    dsid: '376308',
    createdAt: '2026-06-16T09:01:00-03:00',
    notes: 'Valor reconciliado pelo extrato Hayamax de 16/06/2026.',
  },
];

console.log('mode', APPLY ? 'apply' : 'dry-run');
console.log('balance_before', await balance());

for (const row of rows) {
  await upsertMovement(row);
}

const afterRowsBalance = await balance();
const delta = money(TARGET_BALANCE - afterRowsBalance);
console.log('balance_after_rows', afterRowsBalance, 'target', TARGET_BALANCE, 'delta', delta);

if (Math.abs(delta) >= 0.01) {
  await upsertMovement({
    key: 'hayamax-ledger:2026-06-16:reconcile-target-2462-05',
    type: 'adjustment',
    amount: delta,
    reference: 'Reconciliação saldo Hayamax 16/06/2026',
    createdAt: '2026-06-16T09:30:00-03:00',
    notes: 'Ajuste explícito para fechar o ledger local no saldo real do extrato Hayamax: R$ 2.462,05.',
  });
}

console.log('balance_final', await balance());
