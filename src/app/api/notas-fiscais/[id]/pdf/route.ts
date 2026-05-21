import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

const DANFE_BUCKET = 'danfes';
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export async function GET(_request: Request, context: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json({ error: 'ID da nota fiscal é obrigatório' }, { status: 422 });
  }

  const serviceClient = createServiceClient();
  const { data: pedido, error } = await serviceClient
    .from('pedidos')
    .select('id, numero, nota_fiscal_numero')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar nota fiscal' }, { status: 500 });
  }

  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }

  if (!pedido.nota_fiscal_numero) {
    return NextResponse.json({ error: 'Nota fiscal sem número para gerar PDF' }, { status: 422 });
  }

  const filePath = `${pedido.numero}/${pedido.nota_fiscal_numero}.pdf`;
  const { data: signedData, error: signedError } = await serviceClient.storage
    .from(DANFE_BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json({ error: 'PDF da DANFE não encontrado no storage' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    url: signedData.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
}
