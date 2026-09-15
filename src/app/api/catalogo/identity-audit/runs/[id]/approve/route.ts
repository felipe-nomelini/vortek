import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { approveCatalogIdentityRun } from '@/services/catalog-identity-audit';

const schema = z.object({
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(500),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Aprovação inválida.' }, { status: 422 });
  const { id } = await context.params;
  try {
    return NextResponse.json({ data: await approveCatalogIdentityRun({
      runId: id, actorId: auth.userId, manifestHash: parsed.data.manifestHash, reason: parsed.data.reason,
    }) });
  } catch (error) {
    return NextResponse.json({ error: 'O manifesto mudou ou não está pronto para aprovação.',
      code: error instanceof Error ? error.message : 'approval_failed' }, { status: 409 });
  }
}
