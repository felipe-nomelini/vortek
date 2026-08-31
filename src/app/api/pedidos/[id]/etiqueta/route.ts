import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  createShippingLabelSignedUrl,
  downloadShippingLabelFromStorage,
} from '@/lib/shipping-label-storage';
import { normalizeMlShippingLabelPdfForThermalPrint } from '@/lib/shipping-label-pdf';
import {
  HOMOLOGATION_FIXTURE_READ_ONLY_ERROR,
  isHomologationFixtureSource,
} from '@/lib/homologation-fixture';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;

  const client = createServiceClient();
  const format = new URL(request.url).searchParams.get('format');
  const thermal = format === 'zpl2';
  const thermalPdf = format === 'thermal_pdf';
  const { data: pedido, error } = await client
    .from('pedidos')
    .select('numero,ml_label_storage_path,ml_thermal_label_storage_path,snapshot_source')
    .eq('id', (await context.params).id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Erro ao localizar etiqueta' }, { status: 500 });
  if (isHomologationFixtureSource((pedido as any)?.snapshot_source)) {
    return NextResponse.json(HOMOLOGATION_FIXTURE_READ_ONLY_ERROR, { status: 409 });
  }
  const storagePath = thermal
    ? pedido?.ml_thermal_label_storage_path
    : pedido?.ml_label_storage_path;
  if (!storagePath) return NextResponse.json({ error: 'Etiqueta ainda não foi baixada' }, { status: 404 });

  if (thermalPdf) {
    const originalPdf = await downloadShippingLabelFromStorage(client, String(storagePath));
    if (!originalPdf) {
      return NextResponse.json({ error: 'Falha ao baixar PDF original da etiqueta' }, { status: 404 });
    }
    try {
      const normalizedPdf = await normalizeMlShippingLabelPdfForThermalPrint(originalPdf);
      return new Response(new Uint8Array(normalizedPdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="etiqueta_ml_${pedido?.numero}_100x150.pdf"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (conversionError: any) {
      return NextResponse.json(
        { error: conversionError?.message || 'Falha ao preparar PDF térmico' },
        { status: 422 },
      );
    }
  }

  const url = await createShippingLabelSignedUrl(
    client,
    String(storagePath),
    undefined,
    thermal ? `etiqueta_ml_${pedido?.numero}.zpl` : undefined,
  );
  if (!url) return NextResponse.json({ error: 'Falha ao gerar link da etiqueta' }, { status: 404 });
  return NextResponse.json({ success: true, url, format: thermal ? 'zpl2' : 'pdf' });
}
