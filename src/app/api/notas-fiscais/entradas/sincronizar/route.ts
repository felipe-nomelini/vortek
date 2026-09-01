import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { upsertIncomingNfeSnapshots } from '@/lib/fiscal/incoming-nfe';
import { listarNotasEntradaBrasilNfe } from '@/services/fiscal-provider';

const schema = z.object({
  inicio: z.string().date(),
  fim: z.string().date(),
});

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Período de sincronização inválido.' }, { status: 400 });
  const start = new Date(`${parsed.data.inicio}T00:00:00`);
  const end = new Date(`${parsed.data.fim}T23:59:59`);
  if (end.getTime() < start.getTime() || end.getTime() - start.getTime() > 31 * 86400000) {
    return NextResponse.json({ error: 'O período deve ter no máximo 31 dias.' }, { status: 400 });
  }
  try {
    const documents = await listarNotasEntradaBrasilNfe({
      inicio: `${parsed.data.inicio}T00:00:00`,
      fim: `${parsed.data.fim}T23:59:59`,
    });
    const result = await upsertIncomingNfeSnapshots({ documents, source: 'brasilnfe_sync' });
    return NextResponse.json({ success: true, found: documents.length, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao sincronizar NF-e de entrada.' }, { status: 502 });
  }
}
