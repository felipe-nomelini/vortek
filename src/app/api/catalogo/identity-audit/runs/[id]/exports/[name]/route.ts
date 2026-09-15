import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { CATALOG_IDENTITY_EXPORTS, type CatalogIdentityExportName } from '@/lib/catalog-identity-exports';
import { generateCatalogIdentityExport } from '@/services/catalog-identity-exports';

export async function GET(request: Request, context: { params: Promise<{ id: string; name: string }> }) {
  const auth = await authorizeApiRequest(request, 'catalog.identity.read');
  if (!auth.ok) return auth.response;
  const { id, name } = await context.params;
  if (!CATALOG_IDENTITY_EXPORTS.includes(name as CatalogIdentityExportName)) {
    return NextResponse.json({ error: 'Entregável inválido.' }, { status: 404 });
  }
  try {
    const output = await generateCatalogIdentityExport(id, name as CatalogIdentityExportName);
    return new NextResponse(output.body, { headers: {
      'Content-Type': output.contentType,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return NextResponse.json({ error: 'Não foi possível gerar o entregável.' }, { status: 503 });
  }
}
