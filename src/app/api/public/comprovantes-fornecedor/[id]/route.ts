import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyPublicSupplierReceiptToken } from '@/lib/public-supplier-receipt-links';

const RECEIPTS_BUCKET = 'supplier-payment-receipts';

export async function GET(request: Request, context: { params: { id: string } }) {
  const id = context?.params?.id;
  const token = new URL(request.url).searchParams.get('token');
  if (!id || !verifyPublicSupplierReceiptToken(id, token)) {
    return NextResponse.json({ error: 'Link inválido' }, { status: 403 });
  }

  const client = createServiceClient();
  const { data: compra, error } = await client
    .from('compras')
    .select('id,supplier_payment_receipt_path')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar comprovante' }, { status: 500 });
  }
  if (!compra?.supplier_payment_receipt_path) {
    return NextResponse.json({ error: 'Comprovante não encontrado' }, { status: 404 });
  }

  const { data, error: signedError } = await client.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrl(String((compra as any).supplier_payment_receipt_path), 60 * 60);
  if (signedError || !data?.signedUrl) {
    return NextResponse.json({ error: 'Falha ao gerar link do comprovante' }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl, 302);
}
