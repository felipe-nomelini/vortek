import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { createShippingLabelSignedUrl } from '@/lib/shipping-label-storage';
import { verifyPublicShippingLabelToken } from '@/lib/public-shipping-label-links';

export async function GET(request: Request, context: { params: { id: string } }) {
  const id = context?.params?.id;
  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get('token');
  const thermal = searchParams.get('format') === 'zpl2';
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
