import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { recordCatalogIdentityManualDecision } from '@/services/catalog-identity-audit';

const schema = z.object({
  commandId: z.string().uuid(),
  actionType: z.enum(['NO_ACTION','FIX_LOCAL_LINK','CREATE_CORRECT_CATALOG_LISTING','PAUSE_WRONG_CATALOG_LISTING','MANUAL_REVIEW']),
  reason: z.string().trim().min(10).max(500),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ auditId: string }> }) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const { auditId } = await context.params;
  if (!parsed.success || !/^\d+$/.test(auditId)) return NextResponse.json({ error: 'Decisão inválida.' }, { status: 422 });
  try {
    return NextResponse.json({ data: await recordCatalogIdentityManualDecision({
      auditId: Number(auditId), actorId: auth.userId, ...parsed.data,
    }) });
  } catch {
    return NextResponse.json({ error: 'Não foi possível registrar a decisão.' }, { status: 409 });
  }
}
