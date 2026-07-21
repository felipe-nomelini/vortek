import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { inferSupplierPaymentMode, syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { obterSaldoEstoqueInternoProduto } from '@/lib/estoque-interno';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const service = createServiceClient();
  const [{ data: product, error: productError }, { data: offers, error: offersError }] = await Promise.all([
    service
      .from('produtos')
      .select('id,oferta_preferencial_id,dslite_fornecedor_id,dslite_produto_id')
      .eq('id', params.id)
      .maybeSingle(),
    service
      .from('produto_fornecedor_ofertas')
      .select('*')
      .eq('produto_id', params.id)
      .order('prioridade', { ascending: true })
      .order('custo', { ascending: true }),
  ]);

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }
  if (!product?.id) {
    return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
  }
  if (offersError) {
    return NextResponse.json({ error: offersError.message }, { status: 500 });
  }

  const currentPreferredOfferId = String((product as any).oferta_preferencial_id || '').trim();
  const currentFornecedorId = String(product.dslite_fornecedor_id || '').trim();
  const currentDsliteProdutoId = String(product.dslite_produto_id || '').trim();

  const saldoInterno = await obterSaldoEstoqueInternoProduto(String(product.id));
  const fornecedores: any[] = (offers || []).map((offer: any) => ({
      ...offer,
      // Enquanto houver saldo físico liberado, o fornecedor externo não pode
      // ser a origem principal do produto.
      preferred: saldoInterno <= 0 && (currentPreferredOfferId
        ? currentPreferredOfferId === String(offer.id || '').trim()
        : (
          currentFornecedorId === String(offer.dslite_fornecedor_id || '').trim()
          && currentDsliteProdutoId === String(offer.dslite_produto_id || '').trim()
        )),
    }));

  // Não persiste uma oferta DSLite fictícia: estoque próprio não pode gerar
  // pedido de compra. A linha é apenas a fonte interna disponível para envio.
  if (saldoInterno > 0) {
    fornecedores.unshift({
      id: `estoque-interno-${product.id}`,
      fornecedor_nome: 'Estoque Interno',
      sku_oferta: null,
      estoque: saldoInterno,
      custo: 0,
      ativo: true,
      prioridade: -1,
      preferred: true,
      is_internal_stock: true,
    });
  }

  return NextResponse.json({ data: fornecedores });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const offerId = String(body?.offerId || '').trim();
  if (!offerId) {
    return NextResponse.json({ error: 'offerId é obrigatório' }, { status: 422 });
  }

  const service = createServiceClient();
  const { data: offer, error: offerError } = await service
    .from('produto_fornecedor_ofertas')
    .select('id,produto_id,dslite_fornecedor_id,payment_mode')
    .eq('id', offerId)
    .eq('produto_id', params.id)
    .maybeSingle();

  if (offerError) {
    return NextResponse.json({ error: offerError.message }, { status: 500 });
  }
  if (!offer?.id) {
    return NextResponse.json({ error: 'Oferta não encontrada' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if ('ativo' in body) patch.ativo = Boolean(body.ativo);
  if ('prioridade' in body) {
    const parsed = Number(body.prioridade);
    patch.prioridade = Number.isFinite(parsed) ? Math.trunc(parsed) : 100;
  }
  if ('payment_mode' in body) {
    const value = String(body.payment_mode || '').trim();
    patch.payment_mode = value === 'prepaid_pix' || value === 'postpaid' || value === 'balance_account'
      ? value
      : inferSupplierPaymentMode(offer.dslite_fornecedor_id);
  }
  const shouldSetPreferred = body?.preferred === true;

  const { error: updateError } = await service
    .from('produto_fornecedor_ofertas')
    .update(patch as any)
    .eq('id', offerId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (shouldSetPreferred) {
    const { error: preferredError } = await service
      .from('produtos')
      .update({
        oferta_preferencial_id: offerId,
      } as any)
      .eq('id', params.id);

    if (preferredError) {
      return NextResponse.json({ error: preferredError.message }, { status: 500 });
    }
  }

  await syncPreferredProductSnapshot(service, [params.id]);

  const refreshed = await service
    .from('produto_fornecedor_ofertas')
    .select('*')
    .eq('produto_id', params.id)
    .order('prioridade', { ascending: true })
    .order('custo', { ascending: true });

  if (refreshed.error) {
    return NextResponse.json({ error: refreshed.error.message }, { status: 500 });
  }

  const { data: currentProduct } = await service
    .from('produtos')
    .select('oferta_preferencial_id,dslite_fornecedor_id,dslite_produto_id')
    .eq('id', params.id)
    .maybeSingle();

  const currentPreferredOfferId = String((currentProduct as any)?.oferta_preferencial_id || '').trim();
  const currentFornecedorId = String(currentProduct?.dslite_fornecedor_id || '').trim();
  const currentDsliteProdutoId = String(currentProduct?.dslite_produto_id || '').trim();

  return NextResponse.json({
    data: (refreshed.data || []).map((row: any) => ({
      ...row,
      preferred: currentPreferredOfferId
        ? currentPreferredOfferId === String(row.id || '').trim()
        : (
          currentFornecedorId === String(row.dslite_fornecedor_id || '').trim()
          && currentDsliteProdutoId === String(row.dslite_produto_id || '').trim()
        ),
    })),
  });
}
