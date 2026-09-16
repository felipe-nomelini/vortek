import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { maskSupplierFinancialValue } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const FIELDS = 'id,fornecedor_dslite_id,fornecedor_nome_snapshot,cnpj_snapshot,supplier_pix_key_snapshot,status,gross_amount,credit_amount,pix_amount,version,prepared_at,confirmed_at,contact_phone_snapshot';

function present(row: { id: string; fornecedor_dslite_id: string; fornecedor_nome_snapshot: string;
  cnpj_snapshot: string; supplier_pix_key_snapshot: string; contact_phone_snapshot: string | null;
  status: string; gross_amount: number; credit_amount: number; pix_amount: number;
  version: number; prepared_at: string; confirmed_at: string | null }) {
  return { id: row.id, fornecedorId: row.fornecedor_dslite_id, fornecedor: row.fornecedor_nome_snapshot,
    cnpjMasked: maskSupplierFinancialValue(row.cnpj_snapshot),
    pixKeyMasked: maskSupplierFinancialValue(row.supplier_pix_key_snapshot),
    contactMasked: row.contact_phone_snapshot ? maskSupplierFinancialValue(row.contact_phone_snapshot) : null,
    status: row.status, grossAmount: row.gross_amount, creditAmount: row.credit_amount,
    pixAmount: row.pix_amount, version: row.version,
    preparedAt: row.prepared_at, confirmedAt: row.confirmed_at };
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const parsed = z.object({
    status: z.enum(['prepared', 'confirmed', 'cancelled']).optional(),
    fornecedorId: z.string().regex(/^[0-9]{1,20}$/).optional(),
    contactOf: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  }).strict().safeParse(Object.fromEntries(params));
  if (!parsed.success) return NextResponse.json({ error: 'Filtros inválidos' }, { status: 422 });
  const client = createServiceClient();
  let contact: string | null = null;
  if (parsed.data.contactOf) {
    const { data, error } = await client.from('supplier_settlements')
      .select('contact_phone_snapshot').eq('id', parsed.data.contactOf).eq('status', 'confirmed').maybeSingle();
    if (error) return NextResponse.json({ error: 'Falha ao consultar contato' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Liquidação confirmada não encontrada' }, { status: 404 });
    contact = String(data.contact_phone_snapshot || '').replace(/\D/g, '');
    if (!contact) return NextResponse.json({ data: [], total: 0, page: parsed.data.page });
  }
  const limit = 30;
  const offset = (parsed.data.page - 1) * limit;
  if (contact) {
    const matches = [];
    for (let start = 0; ; start += 200) {
      const { data, error } = await client.from('supplier_settlements').select(FIELDS)
        .eq('status', 'confirmed').order('prepared_at', { ascending: false }).order('id', { ascending: false })
        .range(start, start + 199);
      if (error) return NextResponse.json({ error: 'Falha ao consultar liquidações do contato' }, { status: 500 });
      matches.push(...(data || []).filter((row) => String(row.contact_phone_snapshot || '').replace(/\D/g, '') === contact));
      if (!data || data.length < 200) break;
    }
    return NextResponse.json({ data: matches.slice(offset, offset + limit).map(present), total: matches.length,
      page: parsed.data.page }, { headers: { 'Cache-Control': 'no-store' } });
  }
  let query = client.from('supplier_settlements')
    .select(FIELDS, { count: 'exact' })
    .order('prepared_at', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + limit - 1);
  if (parsed.data.status) query = query.eq('status', parsed.data.status);
  if (parsed.data.fornecedorId) query = query.eq('fornecedor_dslite_id', parsed.data.fornecedorId);
  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao consultar liquidações' }, { status: 500 });
  return NextResponse.json({
    data: (data || []).map(present), total: count || 0, page: parsed.data.page,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
