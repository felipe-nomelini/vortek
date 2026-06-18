import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { createShippingLabelSignedUrl } from '@/lib/shipping-label-storage';
import { verifyPublicShippingLabelToken } from '@/lib/public-shipping-label-links';

export async function GET(request: Request, context: { params: { id: string } }) {
  const id = context?.params?.id;
  const token = new URL(request.url).searchParams.get('token');
  if (!id || !verifyPublicShippingLabelToken(id, token)) {
    return NextResponse.json({ error: 'Link inválido' }, { status: 403 });
  }

  const client = createServiceClient();
  const { data: pedido, error } = await client
    .from('pedidos')
    .select('id,ml_label_storage_path')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar etiqueta' }, { status: 500 });
  }
  if (!pedido?.ml_label_storage_path) {
    return NextResponse.json({ error: 'Etiqueta não encontrada' }, { status: 404 });
  }

  const signedUrl = await createShippingLabelSignedUrl(client, String((pedido as any).ml_label_storage_path));
  if (!signedUrl) {
    return NextResponse.json({ error: 'Falha ao gerar link da etiqueta' }, { status: 404 });
  }

  return NextResponse.redirect(signedUrl, 302);
}
