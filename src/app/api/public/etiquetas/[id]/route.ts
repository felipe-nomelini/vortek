import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { downloadShippingLabelFromStorage } from '@/lib/shipping-label-storage';
import { verifyPublicShippingLabelToken } from '@/lib/public-shipping-label-links';
import { normalizeMlShippingLabelPdfForThermalPrint } from '@/lib/shipping-label-pdf';
import { loadDslitePlaceholderLabel } from '@/lib/dslite/placeholder-label';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = (await context?.params)?.id;
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
  if (!pedido) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
  }
  if (format === 'placeholder_evolusom') {
    try {
      const pdf = await loadDslitePlaceholderLabel('133');
      return new Response(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="etiqueta_evolusom_aguardando_ml.pdf"',
          'Cache-Control': 'private, no-store',
        },
      });
    } catch {
      return NextResponse.json({ error: 'Etiqueta padrão Evolusom indisponível' }, { status: 500 });
    }
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

  const label = await downloadShippingLabelFromStorage(client, String(storagePath));
  if (!label) {
    return NextResponse.json({ error: 'Falha ao baixar etiqueta' }, { status: 404 });
  }

  const extension = thermal ? 'zpl' : 'pdf';
  return new Response(new Uint8Array(label), {
    headers: {
      'Content-Type': thermal ? 'text/plain' : 'application/pdf',
      'Content-Disposition': `${thermal ? 'attachment' : 'inline'}; filename="etiqueta_ml_${pedido.numero}.${extension}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
