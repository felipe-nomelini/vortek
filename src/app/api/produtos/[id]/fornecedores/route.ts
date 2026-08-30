import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { inferSupplierPaymentMode, syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { obterSaldoEstoqueInternoProduto } from '@/lib/estoque-interno';
import { enqueueAutomaticPricesForCostChanges } from '@/lib/ml/automatic-pricing';
import { isBlockedDropshippingDsliteSupplier } from '@/lib/dslite/supplier-policy';

type KitComponentDetail = {
  sku: string;
  nome: string;
  sku_fornecedor: string;
  quantidade: number;
  estoque: number;
  custo: number;
  oferta_encontrada: boolean;
};

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
      .select('id,fornecedor,custo,estoque,oferta_preferencial_id,fornecedor_preferencial_manual,dslite_fornecedor_id,dslite_produto_id')
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

  let kitSupplierOffer: Record<string, unknown> | null = null;
  if ((offers || []).length === 0) {
    const { data: kit, error: kitError } = await (service as any)
      .from('produto_kits')
      .select('produto_id,fornecedor_dslite_id,sku_origem,ativo')
      .eq('produto_id', params.id)
      .maybeSingle();
    if (kitError) {
      return NextResponse.json({ error: kitError.message }, { status: 500 });
    }

    if (kit?.produto_id) {
      const { data: componentLinks, error: componentLinksError } = await (service as any)
        .from('produto_kit_componentes')
        .select('componente_produto_id,quantidade')
        .eq('kit_produto_id', params.id);
      if (componentLinksError) {
        return NextResponse.json({ error: componentLinksError.message }, { status: 500 });
      }

      const componentIds: string[] = Array.from(new Set<string>(
        (componentLinks || [])
          .map((row: any) => String(row.componente_produto_id || '').trim())
          .filter(Boolean),
      ));
      const [{ data: components, error: componentsError }, { data: componentOffers, error: componentOffersError }] = componentIds.length > 0
        ? await Promise.all([
            service
              .from('produtos')
              .select('id,sku,nome,custo,estoque,ativo,dslite_fornecedor_id,dslite_produto_id')
              .in('id', componentIds),
            service
              .from('produto_fornecedor_ofertas')
              .select('*')
              .in('produto_id', componentIds)
              .eq('dslite_fornecedor_id', String(kit.fornecedor_dslite_id || '')),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (componentsError || componentOffersError) {
        return NextResponse.json({
          error: componentsError?.message || componentOffersError?.message,
        }, { status: 500 });
      }

      const componentById = new Map(
        (components || []).map((row: any) => [String(row.id), row]),
      );
      const offerByProductId = new Map(
        (componentOffers || []).map((row: any) => [String(row.produto_id), row]),
      );
      const componentDetails: KitComponentDetail[] = (componentLinks || []).map((link: any) => {
        const componentId = String(link.componente_produto_id || '');
        const component = componentById.get(componentId) as any;
        const offer = offerByProductId.get(componentId) as any;
        const quantity = Math.max(1, Math.trunc(Number(link.quantidade || 0)));
        return {
          sku: String(component?.sku || ''),
          nome: String(component?.nome || ''),
          sku_fornecedor: String(
            offer?.sku_oferta ||
            offer?.sku_fornecedor ||
            offer?.dslite_produto_id ||
            component?.dslite_produto_id ||
            '',
          ),
          quantidade: quantity,
          estoque: Number(offer?.estoque ?? component?.estoque ?? 0),
          custo: Number(offer?.custo ?? component?.custo ?? 0),
          oferta_encontrada: Boolean(offer?.id),
        };
      });
      const completeMapping = componentDetails.length > 0
        && componentDetails.every((row: KitComponentDetail) => row.oferta_encontrada);
      const derivedStock = completeMapping
        ? Math.min(...componentDetails.map((row: KitComponentDetail) => Math.floor(Math.max(0, row.estoque) / row.quantidade)))
        : Number(product.estoque || 0);
      const derivedCost = completeMapping
        ? componentDetails.reduce((sum: number, row: KitComponentDetail) => sum + Math.max(0, row.custo) * row.quantidade, 0)
        : Number(product.custo || 0);
      const supplierName = String(
        (componentOffers || [])[0]?.fornecedor_nome || product.fornecedor || `Fornecedor DSLite ${kit.fornecedor_dslite_id}`,
      );

      kitSupplierOffer = {
        id: `kit-fornecedor-${product.id}`,
        produto_id: product.id,
        fornecedor_nome: supplierName,
        dslite_fornecedor_id: String(kit.fornecedor_dslite_id || ''),
        dslite_produto_id: null,
        sku_oferta: String(kit.sku_origem || ''),
        sku_fornecedor: String(kit.sku_origem || ''),
        custo: Math.round(derivedCost * 100) / 100,
        estoque: Math.max(0, derivedStock),
        ativo: kit.ativo !== false,
        prioridade: 0,
        preferred: true,
        preferred_manual: false,
        is_kit_supplier: true,
        kit_sku_origem: String(kit.sku_origem || ''),
        kit_components: componentDetails,
        kit_mapping_complete: completeMapping,
      };
    }
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

  if (kitSupplierOffer) fornecedores.push(kitSupplierOffer);

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
  const blockedSupplierOperation = offer &&
    isBlockedDropshippingDsliteSupplier(offer.dslite_fornecedor_id) &&
    (selectionMode === 'manual' || ('ativo' in body && Boolean(body.ativo)));
  if (blockedSupplierOperation) {
    return NextResponse.json({
      error: 'Fornecedor bloqueado pela política de dropshipping não pode ser ativado nem selecionado.',
    }, { status: 422 });
  }

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
      if (value === 'balance_account') {
        return NextResponse.json({
          error: 'A conta-saldo foi aposentada e não aceita novas configurações.',
        }, { status: 422 });
      }
      patch.payment_mode = value === 'prepaid_pix' || value === 'postpaid'
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
