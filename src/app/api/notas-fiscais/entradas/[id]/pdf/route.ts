import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { BNT_D05_INVENTORY_FIXTURE_SOURCE } from '@/lib/homologation-fixture';
import { createServiceClient } from '@/lib/supabase';
import { obterDocumentoEntradaBrasilNfe } from '@/services/fiscal-provider';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.read');
  if (!auth.ok) return auth.response;
  const db = createServiceClient();
  const { data: receipt, error } = await (db as any).from('estoque_recebimentos_nfe')
    .select('chave_nfe,numero,snapshot_source').eq('id', (await props.params).id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!receipt) return NextResponse.json({ error: 'NF-e de entrada não encontrada.' }, { status: 404 });
  if (receipt.snapshot_source === BNT_D05_INVENTORY_FIXTURE_SOURCE) {
    return NextResponse.json({ error: 'Documento indisponível para amostra de homologação.' }, { status: 409 });
  }
  try {
    const content = await obterDocumentoEntradaBrasilNfe(receipt.chave_nfe, 2);
    if (!content) return NextResponse.json({ error: 'DANFE ainda não disponível.' }, { status: 404 });
    return new NextResponse(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="danfe-entrada-${receipt.numero || receipt.chave_nfe}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (lookupError: any) {
    return NextResponse.json({ error: lookupError?.message || 'Falha ao obter DANFE.' }, { status: 502 });
  }
}
