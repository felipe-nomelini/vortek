import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { maskSupplierFinancialValue } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Comunicação inválida' }, { status: 422 });
  const client = createServiceClient();
  const [header, members, decisions] = await Promise.all([
    client.from('supplier_settlement_communications').select('id,body,status,version,contact_phone,created_at,reviewed_at,sent_at,attempts,error_code').eq('id', id).maybeSingle(),
    client.from('supplier_settlement_communication_members').select('settlement_id').eq('communication_id', id),
    client.from('supplier_oracle_manual_decisions').select('decision,actor,note,created_at')
      .eq('target_type', 'communication').eq('target_id', id).order('created_at', { ascending: false }),
  ]);
  if (header.error || members.error || decisions.error) return NextResponse.json({ error: 'Falha ao consultar comunicação' }, { status: 500 });
  if (!header.data) return NextResponse.json({ error: 'Comunicação não encontrada' }, { status: 404 });
  return NextResponse.json({ data: {
    id, body: header.data.body, status: header.data.status, version: header.data.version,
    contactMasked: maskSupplierFinancialValue(header.data.contact_phone),
    settlementIds: (members.data || []).map((row) => row.settlement_id),
    createdAt: header.data.created_at, reviewedAt: header.data.reviewed_at,
    sentAt: header.data.sent_at, attempts: header.data.attempts, errorCode: header.data.error_code,
    manualDecisions: decisions.data || [],
  } }, { headers: { 'Cache-Control': 'no-store' } });
}
