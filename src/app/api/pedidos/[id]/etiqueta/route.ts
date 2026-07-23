import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { createShippingLabelSignedUrl } from '@/lib/shipping-label-storage';

export async function GET(request: Request, context: { params: { id: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const client = createServiceClient();
  const thermal = new URL(request.url).searchParams.get('format') === 'zpl2';
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

  const url = await createShippingLabelSignedUrl(
    client,
    String(storagePath),
    undefined,
    thermal ? `etiqueta_ml_${pedido?.numero}.zpl` : undefined,
  );
  if (!url) return NextResponse.json({ error: 'Falha ao gerar link da etiqueta' }, { status: 404 });
  return NextResponse.json({ success: true, url, format: thermal ? 'zpl2' : 'pdf' });
}
