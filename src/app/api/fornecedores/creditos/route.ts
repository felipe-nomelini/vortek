import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { HAYAMAX_FORNECEDOR_ID, normalizeMoneyAmount } from '@/lib/supplier-balance';
import type { Database } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MANUAL_MOVEMENT_SCHEMA = z.object({
  fornecedor_id: z.string().trim().min(1),
  movement_type: z.enum(['manual_credit', 'credit_usage', 'adjustment_credit', 'adjustment_debit']),
  amount: z.coerce.number().positive().max(10_000_000),
  reference: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().min(3).max(1000),
});

type Movement = Database['public']['Tables']['supplier_balance_movements']['Row'];

async function requireAdmin() {
  const supabase = await createClient();
  return requireAdminUser(supabase);
}

async function fetchAllMovements(fornecedorId?: string | null): Promise<Movement[]> {
  const service = createServiceClient();
  const pageSize = 1000;
  const rows: Movement[] = [];
  let offset = 0;

  while (true) {
    let query = service
      .from('supplier_balance_movements')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (fornecedorId) query = query.eq('fornecedor_id', fornecedorId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const fornecedorId = String(searchParams.get('fornecedor_id') || '').trim() || null;

    const service = createServiceClient();
    const [{ data: fornecedores, error: fornecedoresError }, movements] = await Promise.all([
      service
        .from('fornecedores')
        .select('dslite_id,nome,apelido,ativo,status_dslite')
        .neq('dslite_id', HAYAMAX_FORNECEDOR_ID)
        .order('nome', { ascending: true }),
      fetchAllMovements(fornecedorId),
    ]);

    if (fornecedoresError) throw new Error(fornecedoresError.message);

    if (fornecedorId) {
      const fornecedor = (fornecedores || []).find((item) => String(item.dslite_id || '') === fornecedorId) || null;
      return NextResponse.json({ fornecedor, movements });
    }

    const bySupplier = new Map<string, {
      fornecedor_id: string;
      fornecedor_nome: string;
      ativo: boolean;
      status_dslite: string | null;
      available: number;
      pending: number;
      used_month: number;
      last_movement_at: string | null;
      pending_count: number;
      read_only: boolean;
    }>();

    for (const fornecedor of fornecedores || []) {
      const id = String(fornecedor.dslite_id || '').trim();
      if (!id) continue;
      bySupplier.set(id, {
        fornecedor_id: id,
        fornecedor_nome: fornecedor.apelido || fornecedor.nome || `Fornecedor ${id}`,
        ativo: Boolean(fornecedor.ativo),
        status_dslite: fornecedor.status_dslite || null,
        available: 0,
        pending: 0,
        used_month: 0,
        last_movement_at: null,
        pending_count: 0,
        read_only: false,
      });
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    for (const movement of movements) {
      const id = String(movement.fornecedor_id);
      const row = bySupplier.get(id) || {
        fornecedor_id: id,
        fornecedor_nome: movement.fornecedor_nome || `Fornecedor ${id}`,
        ativo: false,
        status_dslite: null,
        available: 0,
        pending: 0,
        used_month: 0,
        last_movement_at: null,
        pending_count: 0,
        read_only: id === HAYAMAX_FORNECEDOR_ID,
      };
      if (movement.status === 'confirmed') row.available += Number(movement.amount || 0);
      if (movement.status === 'pending' && Number(movement.amount || 0) > 0) {
        row.pending += Number(movement.amount || 0);
        row.pending_count += 1;
      }
      if (
        movement.status === 'confirmed'
        && movement.movement_type === 'credit_usage'
        && new Date(movement.created_at) >= monthStart
      ) {
        row.used_month += Math.abs(Number(movement.amount || 0));
      }
      if (!row.last_movement_at || movement.created_at > row.last_movement_at) {
        row.last_movement_at = movement.created_at;
      }
      bySupplier.set(id, row);
    }

    const suppliers = Array.from(bySupplier.values())
      .map((row) => ({
        ...row,
        available: normalizeMoneyAmount(row.available),
        pending: normalizeMoneyAmount(row.pending),
        used_month: normalizeMoneyAmount(row.used_month),
      }))
      .sort((a, b) => Number(a.read_only) - Number(b.read_only)
        || b.pending - a.pending
        || b.available - a.available
        || a.fornecedor_nome.localeCompare(b.fornecedor_nome));
    const operationalSuppliers = suppliers.filter((row) => !row.read_only);

    return NextResponse.json({
      summary: {
        available: normalizeMoneyAmount(operationalSuppliers.reduce((sum, row) => sum + row.available, 0)),
        pending: normalizeMoneyAmount(operationalSuppliers.reduce((sum, row) => sum + row.pending, 0)),
        used_month: normalizeMoneyAmount(operationalSuppliers.reduce((sum, row) => sum + row.used_month, 0)),
        suppliers_with_pending: operationalSuppliers.filter((row) => row.pending_count > 0).length,
      },
      suppliers,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao carregar créditos.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const parsed = MANUAL_MOVEMENT_SCHEMA.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 422 });
  }
  if (parsed.data.fornecedor_id === HAYAMAX_FORNECEDOR_ID) {
    return NextResponse.json({ error: 'Hayamax não participa deste controle.' }, { status: 422 });
  }

  const service = createServiceClient();
  const { data: fornecedor, error: fornecedorError } = await service
    .from('fornecedores')
    .select('dslite_id,nome,apelido')
    .eq('dslite_id', parsed.data.fornecedor_id)
    .maybeSingle();
  if (fornecedorError) return NextResponse.json({ error: fornecedorError.message }, { status: 500 });
  if (!fornecedor?.dslite_id) return NextResponse.json({ error: 'Fornecedor não encontrado.' }, { status: 404 });

  const isDebit = parsed.data.movement_type === 'credit_usage' || parsed.data.movement_type === 'adjustment_debit';
  const movementType = parsed.data.movement_type.startsWith('adjustment') ? 'adjustment' : parsed.data.movement_type;
  const amount = normalizeMoneyAmount(parsed.data.amount) * (isDebit ? -1 : 1);
  const now = new Date().toISOString();
  const { data, error } = await service
    .from('supplier_balance_movements')
    .insert({
      fornecedor_id: String(fornecedor.dslite_id),
      fornecedor_nome: fornecedor.apelido || fornecedor.nome || null,
      movement_type: movementType,
      amount,
      reference: parsed.data.reference || null,
      notes: parsed.data.notes,
      created_by: auth.user.email || auth.user.id,
      status: 'confirmed',
      source: 'manual',
      confirmed_at: now,
      confirmed_by: auth.user.email || auth.user.id,
    })
    .select('*')
    .single();

  if (error) {
    const message = error.code === '23514' ? 'Crédito confirmado insuficiente para esta baixa.' : error.message;
    return NextResponse.json({ error: message }, { status: 422 });
  }
  return NextResponse.json({ success: true, movement: data });
}
