import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { startCatalogIdentityDryRun } from '@/services/catalog-identity-audit';

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.manage');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    return NextResponse.json({ data: await startCatalogIdentityDryRun({ runId: id, actorId: auth.userId }) }, {
      status: 202, headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'catalog_identity_start_failed';
    return NextResponse.json({ error: 'Não foi possível iniciar o dry-run.', code }, { status: 409 });
  }
}
