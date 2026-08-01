import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { inferSupplierPaymentMode, syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { obterSaldoEstoqueInternoProduto } from '@/lib/estoque-interno';
import { enqueueAutomaticPricesForCostChanges } from '@/lib/ml/automatic-pricing';

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
      .select('id,oferta_preferencial_id,fornecedor_preferencial_manual,dslite_fornecedor_id,dslite_produto_id')
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
  const manualSelection = Boolean(product.fornecedor_preferencial_manual);
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
      preferred_manual: manualSelection && currentPreferredOfferId === String(offer.id || '').trim(),
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

  return NextResponse.json({
    data: fornecedores,
    selection_mode: manualSelection ? 'manual' : 'automatic',
    preferred_offer_id: currentPreferredOfferId || null,
  });
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
  const selectionMode = body?.selectionMode === 'manual' || body?.selectionMode === 'automatic'
    ? body.selectionMode
    : body?.preferred === true
      ? 'manual'
      : null;

  if (selectionMode !== 'automatic' && !offerId) {
    return NextResponse.json({ error: 'offerId é obrigatório' }, { status: 422 });
  }

  const service = createServiceClient();
  const { data: product, error: productError } = await service
    .from('produtos')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }
  if (!product?.id) {
    return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 });
  }

  let offer: any = null;
  if (offerId) {
    const result = await service
      .from('produto_fornecedor_ofertas')
      .select('id,produto_id,dslite_fornecedor_id,payment_mode,custo,estoque,ativo')
      .eq('id', offerId)
      .eq('produto_id', params.id)
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    if (!result.data?.id) {
      return NextResponse.json({ error: 'Oferta não encontrada' }, { status: 404 });
    }
    offer = result.data;
  }

  const now = new Date().toISOString();
  if (selectionMode === 'manual') {
    if (offer.ativo === false || !(Number(offer.custo) > 0)) {
      return NextResponse.json({
        error: 'A escolha manual exige uma oferta ativa e com custo válido.',
      }, { status: 409 });
    }
    const { error: updateProductError } = await service
      .from('produtos')
      .update({
        oferta_preferencial_id: offer.id,
        fornecedor_preferencial_manual: true,
        updated_at: now,
      })
      .eq('id', params.id);
    if (updateProductError) {
      return NextResponse.json({ error: updateProductError.message }, { status: 500 });
    }
  } else if (selectionMode === 'automatic') {
    const { error: updateProductError } = await service
      .from('produtos')
      .update({
        fornecedor_preferencial_manual: false,
        updated_at: now,
      })
      .eq('id', params.id);
    if (updateProductError) {
      return NextResponse.json({ error: updateProductError.message }, { status: 500 });
    }
  } else {
    const patch: Record<string, unknown> = { updated_at: now };
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
    const { error: updateError } = await service
      .from('produto_fornecedor_ofertas')
      .update(patch as any)
      .eq('id', offerId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  const snapshots = await syncPreferredProductSnapshot(service, [params.id]);
  const automaticPricing = await enqueueAutomaticPricesForCostChanges(service, snapshots);

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
    .select('oferta_preferencial_id,fornecedor_preferencial_manual,dslite_fornecedor_id,dslite_produto_id')
    .eq('id', params.id)
    .maybeSingle();

  const currentPreferredOfferId = String((currentProduct as any)?.oferta_preferencial_id || '').trim();
  const manualSelection = Boolean(currentProduct?.fornecedor_preferencial_manual);
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
      preferred_manual: manualSelection && currentPreferredOfferId === String(row.id || '').trim(),
    })),
    selection_mode: manualSelection ? 'manual' : 'automatic',
    preferred_offer_id: currentPreferredOfferId || null,
    automatic_pricing: automaticPricing,
  }, { status: automaticPricing.errors.length > 0 ? 207 : 200 });
}
