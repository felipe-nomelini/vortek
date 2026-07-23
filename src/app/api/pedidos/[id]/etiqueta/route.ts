import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  createShippingLabelSignedUrl,
  downloadShippingLabelFromStorage,
} from '@/lib/shipping-label-storage';
import { normalizeMlShippingLabelPdfForThermalPrint } from '@/lib/shipping-label-pdf';

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const client = createServiceClient();
  const format = new URL(request.url).searchParams.get('format');
  const thermal = format === 'zpl2';
  const thermalPdf = format === 'thermal_pdf';
  const { data: pedido, error } = await client
    .from('pedidos')
    .select('numero,ml_label_storage_path,ml_thermal_label_storage_path')
    .eq('id', context.params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Erro ao localizar etiqueta' }, { status: 500 });
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
