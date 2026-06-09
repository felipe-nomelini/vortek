import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const service = createServiceClient();
  const { data: offer, error: offerError } = await service
    .from('produto_fornecedor_ofertas')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();

  if (offerError) {
    return NextResponse.json({ error: offerError.message }, { status: 500 });
  }
  if (!offer?.id) {
    return NextResponse.json({ error: 'Oferta não encontrada' }, { status: 404 });
  }

  const { data: product, error: productError } = await service
    .from('produtos')
    .select('*')
    .eq('id', String(offer.produto_id))
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }
  if (!product?.id) {
    return NextResponse.json({ error: 'Produto principal não encontrado' }, { status: 404 });
  }

  const { data: siblingOffers, error: siblingsError } = await service
    .from('produto_fornecedor_ofertas')
    .select('id,nome,fornecedor_nome,sku_oferta,dslite_fornecedor_id,dslite_produto_id,ativo,prioridade,payment_mode')
    .eq('produto_id', String(offer.produto_id))
    .order('prioridade', { ascending: true })
    .order('custo', { ascending: true });

  if (siblingsError) {
    return NextResponse.json({ error: siblingsError.message }, { status: 500 });
  }

  const currentPreferredOfferId = String((product as any).oferta_preferencial_id || '').trim();
  const preferred = currentPreferredOfferId
    ? currentPreferredOfferId === String(offer.id || '').trim()
    : (
      String(product.dslite_fornecedor_id || '').trim() === String(offer.dslite_fornecedor_id || '').trim()
      && String(product.dslite_produto_id || '').trim() === String(offer.dslite_produto_id || '').trim()
    );

  return NextResponse.json({
    data: {
      offer,
      product,
      preferred,
      siblingOffers: (siblingOffers || []).map((item: any) => ({
        ...item,
        preferred: currentPreferredOfferId
          ? currentPreferredOfferId === String(item.id || '').trim()
          : (
            String(product.dslite_fornecedor_id || '').trim() === String(item.dslite_fornecedor_id || '').trim()
            && String(product.dslite_produto_id || '').trim() === String(item.dslite_produto_id || '').trim()
          ),
      })),
    },
  });
}
