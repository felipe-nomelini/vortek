import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.read');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const client = createServiceClient();
  const [run, states, processing] = await Promise.all([
    (client.from('ml_catalog_identity_runs' as any) as any).select('*').eq('id', id).maybeSingle(),
    (client.from('ml_catalog_identity_audits' as any) as any).select('identity_state').eq('run_id', id).not('identity_state', 'is', null),
    (client.from('ml_catalog_identity_audits' as any) as any).select('processing_state').eq('run_id', id),
  ]);
  if (run.error || !run.data) return NextResponse.json({ error: 'Auditoria não encontrada.' }, { status: 404 });
  if (states.error || processing.error) return NextResponse.json({ error: 'Progresso indisponível.' }, { status: 503 });
  const count = (rows: any[], field: string, value: string) => rows.filter(row => row[field] === value).length;
  return NextResponse.json({ data: run.data, counters: {
    processed: count(processing.data || [], 'processing_state', 'processed'),
    pending: count(processing.data || [], 'processing_state', 'pending'),
    conflict: count(states.data || [], 'identity_state', 'CONFLITO_CONFIRMADO'),
    validation: count(states.data || [], 'identity_state', 'PENDENCIA_VALIDACAO'),
    inconclusive: count(states.data || [], 'identity_state', 'INCONCLUSIVO'),
    clear: count(states.data || [], 'identity_state', 'SEM_CONFLITO'),
  } }, { headers: { 'Cache-Control': 'no-store' } });
}
