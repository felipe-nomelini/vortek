import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  createShippingLabelSignedUrl,
  downloadShippingLabelFromStorage,
} from '@/lib/shipping-label-storage';
import { verifyPublicShippingLabelToken } from '@/lib/public-shipping-label-links';
import { normalizeMlShippingLabelPdfForThermalPrint } from '@/lib/shipping-label-pdf';

export async function GET(request: Request, context: { params: { id: string } }) {
  const id = context?.params?.id;
  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get('token');
  const format = searchParams.get('format');
  const thermal = format === 'zpl2';
  const thermalPdf = format === 'thermal_pdf';
  if (!id || !verifyPublicShippingLabelToken(id, token)) {
    return NextResponse.json({ error: 'Link inválido' }, { status: 403 });
  }

  const client = createServiceClient();
  const { data: pedido, error } = await client
    .from('pedidos')
    .select('id,numero,ml_label_storage_path,ml_thermal_label_storage_path')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar etiqueta' }, { status: 500 });
  }
  const storagePath = thermal
    ? pedido?.ml_thermal_label_storage_path
    : pedido?.ml_label_storage_path;
  if (!storagePath) {
    return NextResponse.json({ error: 'Etiqueta não encontrada' }, { status: 404 });
  }

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

  const signedUrl = await createShippingLabelSignedUrl(
    client,
    String(storagePath),
    undefined,
    thermal ? `etiqueta_ml_${pedido?.numero}.zpl` : undefined,
  );
  if (!signedUrl) {
    return NextResponse.json({ error: 'Falha ao gerar link da etiqueta' }, { status: 404 });
  }

  return NextResponse.redirect(signedUrl, 302);
}
