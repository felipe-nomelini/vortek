import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { loadProductMlListings, type ProductMlListing } from '@/lib/ml/product-listings';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import {
  classifySupplierOffer,
  findBntD09VisualReviewOffer,
  listBntD09VisualReview,
  supplierFallbackName,
  type SupplierOfferListRow,
} from '@/lib/products/supplier-offers';

type SupplierRecord = {
  id: string;
  apelido: string;
  nome: string;
  dslite_id: string | null;
  ativo: boolean;
  status_dslite: string;
  dropshipping: string;
  crossdocking: string;
  dslite_ultima_sync: string | null;
};

const SOURCES = {
  synchronized: 'DSLite · sincronizado',
  operational: 'Bentevi · configuração',
  derived: 'Bentevi · calculado',
  master: 'Bentevi · cadastro mestre',
} as const;

function nullableString(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function imageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function isPreferredOffer(product: Record<string, any>, offer: Record<string, any>) {
  const preferredId = String(product.oferta_preferencial_id || '').trim();
  if (preferredId) return preferredId === String(offer.id || '').trim();
  return String(product.dslite_fornecedor_id || '').trim() === String(offer.dslite_fornecedor_id || '').trim()
    && String(product.dslite_produto_id || '').trim() === String(offer.dslite_produto_id || '').trim();
}

function classifyRow(
  offer: Record<string, any>,
  product: Record<string, any>,
  supplier: SupplierRecord | undefined,
) {
  return classifySupplierOffer({
    supplierActive: supplier?.ativo === true,
    supplierDsliteId: String(offer.dslite_fornecedor_id || '').trim(),
    paymentMode: String(offer.payment_mode || 'postpaid'),
    offerActive: offer.ativo !== false,
    productActive: product.ativo !== false,
    cost: Number(offer.custo || 0),
    stock: Number(offer.estoque || 0),
  });
}

function buildComparisonRows(params: {
  offers: Array<Record<string, any>>;
  product: Record<string, any>;
  suppliersByDsliteId: Map<string, SupplierRecord>;
}) {
  const eligibleCosts = params.offers.flatMap((offer) => {
    const supplier = params.suppliersByDsliteId.get(String(offer.dslite_fornecedor_id || '').trim());
    return classifyRow(offer, params.product, supplier) === 'eligible' ? [Number(offer.custo || 0)] : [];
  });
  const lowestEligibleCost = eligibleCosts.length > 0 ? Math.min(...eligibleCosts) : null;

  return params.offers.map((offer): SupplierOfferListRow => {
    const supplierDsliteId = String(offer.dslite_fornecedor_id || '').trim();
    const supplier = params.suppliersByDsliteId.get(supplierDsliteId);
    const paymentMode = String(offer.payment_mode || 'postpaid');
    const cost = Number(offer.custo || 0);
    const costDeltaAmount = lowestEligibleCost === null
      ? null
      : Math.round((cost - lowestEligibleCost) * 100) / 100;
    return {
      offerId: String(offer.id || ''),
      productId: String(params.product.id || ''),
      productSku: String(params.product.sku || ''),
      productName: String(params.product.nome || ''),
      offerName: String(offer.nome || params.product.nome || ''),
      supplierSku: String(offer.sku_oferta || offer.sku_fornecedor || offer.dslite_produto_id || ''),
      supplierDsliteId,
      supplierName: supplier?.apelido || supplierFallbackName(offer.fornecedor_nome, supplierDsliteId),
      paymentMode,
      stock: Number(offer.estoque || 0),
      leadTimeDays: offer.lead_time_dias == null ? null : Number(offer.lead_time_dias),
      cost,
      lowestEligibleCost,
      costDeltaAmount,
      costDeltaPercent: lowestEligibleCost && costDeltaAmount !== null
        ? Math.round((costDeltaAmount / lowestEligibleCost) * 10000) / 100
        : null,
      status: classifyRow(offer, params.product, supplier),
      preferred: isPreferredOffer(params.product, offer),
      preferenceMode: params.product.fornecedor_preferencial_manual === true ? 'manual' : 'automatic',
      eligibleOfferCount: eligibleCosts.length,
      lastSyncAt: nullableString(offer.last_sync_at),
    };
  });
}

function sortRelatedOffers(rows: SupplierOfferListRow[], currentOfferId: string) {
  return [...rows].sort((left, right) => {
    if (left.offerId === currentOfferId) return -1;
    if (right.offerId === currentOfferId) return 1;
    if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
    if (left.status === 'eligible' && right.status !== 'eligible') return -1;
    if (right.status === 'eligible' && left.status !== 'eligible') return 1;
    return (left.cost - right.cost) || left.supplierName.localeCompare(right.supplierName, 'pt-BR');
  });
}

function normalizeFixtureListings(value: unknown): ProductMlListing[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: Record<string, any>) => {
    const itemId = String(entry.itemId || entry.ml_item_id || '').trim().toUpperCase();
    if (!itemId) return [];
    return [{
      itemId,
      type: entry.type === 'catalog' || entry.catalog_listing === true ? 'catalog' as const : 'standard' as const,
      status: String(entry.status || ''),
      price: Number(entry.price ?? entry.preco_ml ?? 0),
      permalink: nullableString(entry.permalink),
      catalogProductId: nullableString(entry.catalogProductId ?? entry.catalog_product_id),
      catalogStatus: entry.catalogStatus || undefined,
      priceToWin: entry.priceToWin == null && entry.price_to_win == null
        ? null
        : Number(entry.priceToWin ?? entry.price_to_win),
      relatedItemId: nullableString(entry.relatedItemId ?? entry.related_item_id),
    }];
  });
}

function buildResponse(params: {
  offer: Record<string, any>;
  product: Record<string, any>;
  currentRow: SupplierOfferListRow;
  relatedOffers: SupplierOfferListRow[];
  supplier: SupplierRecord | null;
  mlListings: ProductMlListing[];
  fixture: boolean;
  visualReview?: Record<string, unknown> | null;
}) {
  const historical = params.currentRow.status === 'historical';
  const supplierName = params.supplier?.apelido || params.currentRow.supplierName;

  return {
    offer: {
      id: params.currentRow.offerId,
      productId: params.currentRow.productId,
      name: String(params.offer.nome || params.product.nome || ''),
      supplierSku: String(params.offer.sku_oferta || ''),
      supplierInternalSku: nullableString(params.offer.sku_fornecedor),
      supplierProductId: String(params.offer.dslite_produto_id || ''),
      supplierDsliteId: params.currentRow.supplierDsliteId,
      supplierName,
      cost: params.currentRow.cost,
      stock: params.currentRow.stock,
      leadTimeDays: params.currentRow.leadTimeDays,
      paymentMode: params.currentRow.paymentMode,
      active: params.offer.ativo !== false,
      priority: Number(params.offer.prioridade ?? 100),
      lastSyncAt: params.currentRow.lastSyncAt,
      images: imageList(params.offer.imagens),
      description: String(params.offer.descricao || ''),
      brand: nullableString(params.offer.marca),
      gtin: nullableString(params.offer.gtin),
      ncm: nullableString(params.offer.ncm),
      cest: nullableString(params.offer.cest),
      status: params.currentRow.status,
      preferred: params.currentRow.preferred,
      preferenceMode: params.currentRow.preferenceMode,
      lowestEligibleCost: params.currentRow.lowestEligibleCost,
      costDeltaAmount: params.currentRow.costDeltaAmount,
      costDeltaPercent: params.currentRow.costDeltaPercent,
    },
    supplier: {
      id: params.fixture ? null : params.supplier?.id || null,
      name: supplierName,
      legalName: params.supplier?.nome || nullableString(params.offer.fornecedor_nome),
      dsliteId: params.currentRow.supplierDsliteId,
      active: params.supplier?.ativo === true,
      statusDslite: params.supplier?.status_dslite || null,
      dropshipping: params.supplier?.dropshipping || null,
      crossdocking: params.supplier?.crossdocking || null,
      lastSyncAt: params.supplier?.dslite_ultima_sync || null,
    },
    product: {
      id: String(params.product.id || ''),
      sku: String(params.product.sku || ''),
      name: String(params.product.nome || ''),
      active: params.product.ativo !== false,
      brand: nullableString(params.product.marca),
      gtin: nullableString(params.product.gtin),
      ncm: nullableString(params.product.ncm),
      cest: nullableString(params.product.cest),
      csosn: nullableString(params.product.csosn),
      fiscalOrigin: nullableString(params.product.origem_fiscal),
      originState: nullableString(params.product.origem_uf),
      preferredOfferId: nullableString(params.product.oferta_preferencial_id),
      preferenceMode: params.product.fornecedor_preferencial_manual === true ? 'manual' : 'automatic',
      mlListings: params.mlListings,
    },
    relatedOffers: sortRelatedOffers(params.relatedOffers, params.currentRow.offerId),
    sources: SOURCES,
    readOnly: params.fixture || historical,
    readOnlyReason: params.fixture
      ? 'Amostra real protegida de homologação'
      : historical
        ? 'Fornecedor ou modalidade de pagamento mantidos somente para histórico'
        : null,
    visualReview: params.visualReview || null,
  };
}

export async function GET(_request: Request, context: RouteContext<'/api/produtos/ofertas/[id]'>) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const visualReview = await loadBntD07VisualReview();
  const fixture = visualReview ? findBntD09VisualReviewOffer(visualReview, id) : null;
  if (fixture && visualReview) {
    const listed = listBntD09VisualReview({
      review: visualReview,
      page: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
      search: '',
      supplierDsliteIds: [],
      view: 'all',
      stockStatus: 'todos',
      preference: 'todos',
      sortBy: 'cost',
      sortOrder: 'asc',
    }).data.filter((row) => row.productId === String(fixture.item.product.id || ''));
    const currentRow = listed.find((row) => row.offerId === id);
    if (!currentRow) return NextResponse.json({ error: 'Oferta da amostra não encontrada' }, { status: 404 });
    const supplierOption = visualReview.suppliers.find((supplier) => (
      String(supplier.dsliteId) === currentRow.supplierDsliteId
    ));
    const supplier = supplierOption ? {
      id: supplierOption.id,
      apelido: supplierOption.apelido || supplierOption.label,
      nome: supplierOption.label,
      dslite_id: supplierOption.dsliteId,
      ativo: true,
      status_dslite: 'Ativo',
      dropshipping: '',
      crossdocking: '',
      dslite_ultima_sync: null,
    } : null;

    return NextResponse.json({
      data: buildResponse({
        offer: fixture.offer,
        product: fixture.item.product,
        currentRow,
        relatedOffers: listed,
        supplier,
        mlListings: normalizeFixtureListings(fixture.item.mlListings),
        fixture: true,
        visualReview: visualReview.metadata,
      }),
    });
  }
  if (id.startsWith('bnt-d09-review-')) {
    return NextResponse.json({ error: 'Oferta da amostra não encontrada' }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: offer, error: offerError } = await service
    .from('produto_fornecedor_ofertas')
    .select('id,produto_id,nome,fornecedor_nome,dslite_fornecedor_id,dslite_produto_id,sku_oferta,sku_fornecedor,custo,estoque,ativo,prioridade,payment_mode,lead_time_dias,last_sync_at,imagens,descricao,marca,gtin,ncm,cest')
    .eq('id', id)
    .maybeSingle();

  if (offerError) return NextResponse.json({ error: offerError.message }, { status: 500 });
  if (!offer?.id) return NextResponse.json({ error: 'Oferta não encontrada' }, { status: 404 });

  const productId = String(offer.produto_id || '');
  const [productResult, offersResult, mlListingsResult] = await Promise.all([
    service
      .from('produtos')
      .select('id,sku,nome,ativo,marca,gtin,ncm,cest,csosn,origem_fiscal,origem_uf,oferta_preferencial_id,fornecedor_preferencial_manual,dslite_fornecedor_id,dslite_produto_id')
      .eq('id', productId)
      .maybeSingle(),
    service
      .from('produto_fornecedor_ofertas')
      .select('id,produto_id,nome,fornecedor_nome,dslite_fornecedor_id,dslite_produto_id,sku_oferta,sku_fornecedor,custo,estoque,ativo,prioridade,payment_mode,lead_time_dias,last_sync_at')
      .eq('produto_id', productId),
    loadProductMlListings(service, [productId]),
  ]);

  if (productResult.error) return NextResponse.json({ error: productResult.error.message }, { status: 500 });
  if (!productResult.data?.id) return NextResponse.json({ error: 'Produto principal não encontrado' }, { status: 404 });
  if (offersResult.error) return NextResponse.json({ error: offersResult.error.message }, { status: 500 });

  const supplierDsliteIds = Array.from(new Set((offersResult.data || [])
    .map((row) => String(row.dslite_fornecedor_id || '').trim())
    .filter(Boolean)));
  const suppliersResult = supplierDsliteIds.length > 0
    ? await service
        .from('fornecedores')
        .select('id,apelido,nome,dslite_id,ativo,status_dslite,dropshipping,crossdocking,dslite_ultima_sync')
        .in('dslite_id', supplierDsliteIds)
    : { data: [], error: null };
  if (suppliersResult.error) return NextResponse.json({ error: suppliersResult.error.message }, { status: 500 });

  const suppliersByDsliteId = new Map<string, SupplierRecord>(
    (suppliersResult.data || []).map((supplier) => [String(supplier.dslite_id || ''), supplier]),
  );
  const comparisonRows = buildComparisonRows({
    offers: (offersResult.data || []) as Array<Record<string, any>>,
    product: productResult.data,
    suppliersByDsliteId,
  });
  const currentRow = comparisonRows.find((row) => row.offerId === String(offer.id));
  if (!currentRow) return NextResponse.json({ error: 'Oferta não encontrada na comparação do produto' }, { status: 404 });

  return NextResponse.json({
    data: buildResponse({
      offer,
      product: productResult.data,
      currentRow,
      relatedOffers: comparisonRows,
      supplier: suppliersByDsliteId.get(String(offer.dslite_fornecedor_id || '')) || null,
      mlListings: mlListingsResult.get(productId) || [],
      fixture: false,
    }),
  });
}
