import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchAllRowsPaginated } from '@/lib/produto-filtering';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

export const maxDuration = 300;

type ImpactProduct = {
  id: string;
  sku: string | null;
  ml_item_id: string | null;
  ativo: boolean | null;
};

type ImpactOffer = {
  id: string;
  ativo: boolean | null;
};

const SUPABASE_IN_FILTER_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toPublicError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function loadFornecedor(client: any, id: string) {
  const { data, error } = await client
    .from('fornecedores')
    .select('id,dslite_id,apelido,ativo')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function loadImpactedProducts(client: any, dsliteFornecedorId: string): Promise<ImpactProduct[]> {
  if (!dsliteFornecedorId) return [];

  const offers = await fetchAllRowsPaginated<{ produto_id: string | null }>((from, to) => (
    client
      .from('produto_fornecedor_ofertas')
      .select('produto_id')
      .eq('dslite_fornecedor_id', dsliteFornecedorId)
      .not('produto_id', 'is', null)
      .range(from, to)
  ));

  const productIds = new Set<string>();
  for (const offer of offers) {
    const productId = String(offer.produto_id || '').trim();
    if (productId) productIds.add(productId);
  }

  const legacyProducts = await fetchAllRowsPaginated<ImpactProduct>((from, to) => (
    client
      .from('produtos')
      .select('id,sku,ml_item_id,ativo,ml_status')
      .eq('dslite_fornecedor_id', dsliteFornecedorId)
      .range(from, to)
  ));

  for (const product of legacyProducts) {
    const productId = String(product.id || '').trim();
    if (productId) productIds.add(productId);
  }

  const ids = Array.from(productIds);
  if (ids.length === 0) return [];

  const products: ImpactProduct[] = [];
  for (const idsChunk of chunk(ids, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await client
      .from('produtos')
      .select('id,sku,ml_item_id,ativo,ml_status')
      .in('id', idsChunk);

    if (error) throw new Error(error.message);
    products.push(...((data || []) as ImpactProduct[]));
  }

  return products;
}

async function loadImpactedOffers(client: any, dsliteFornecedorId: string): Promise<ImpactOffer[]> {
  if (!dsliteFornecedorId) return [];

  return fetchAllRowsPaginated<ImpactOffer>((from, to) => (
    client
      .from('produto_fornecedor_ofertas')
      .select('id,ativo')
      .eq('dslite_fornecedor_id', dsliteFornecedorId)
      .range(from, to)
  ));
}

function buildImpact(products: ImpactProduct[], offers: ImpactOffer[]) {
  const activeProducts = products.filter((product) => product.ativo !== false);
  const activeOffers = offers.filter((offer) => offer.ativo !== false);
  return {
    products_found: products.length,
    products_active: activeProducts.length,
    products_already_inactive: products.length - activeProducts.length,
    supplier_offers_found: offers.length,
    supplier_offers_active: activeOffers.length,
    supplier_offers_already_inactive: offers.length - activeOffers.length,
    ml_pause_candidates: products.filter((product) => String(product.ml_item_id || '').trim()).length,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  try {
    const client = createServiceClient();
    const fornecedor = await loadFornecedor(client, params.id);
    if (!fornecedor) {
      return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    const dsliteFornecedorId = String(fornecedor.dslite_id || '').trim();
    const [products, offers] = await Promise.all([
      loadImpactedProducts(client, dsliteFornecedorId),
      loadImpactedOffers(client, dsliteFornecedorId),
    ]);
    return NextResponse.json({
      fornecedor,
      impact: buildImpact(products, offers),
    });
  } catch (err: any) {
    return NextResponse.json({ error: toPublicError(err, 'Erro ao calcular impacto do fornecedor') }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.ativo !== 'boolean') {
      return NextResponse.json({ error: 'Campo ativo deve ser booleano' }, { status: 422 });
    }

    const client = createServiceClient();
    const fornecedor = await loadFornecedor(client, params.id);
    if (!fornecedor) {
      return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    const { error: updateFornecedorError } = await client
      .from('fornecedores')
      .update({ ativo: body.ativo } as any)
      .eq('id', params.id);

    if (updateFornecedorError) {
      return NextResponse.json({ error: updateFornecedorError.message }, { status: 500 });
    }

    if (body.ativo) {
      return NextResponse.json({
        success: true,
        fornecedor_id: params.id,
        ativo: true,
        records: {
          products_found: 0,
          products_inactivated: 0,
          ml_pause_enqueued: 0,
          ml_pause_updated_existing: 0,
          ml_pause_skipped_no_item: 0,
          ml_pause_failed: 0,
          supplier_offers_found: 0,
          supplier_offers_inactivated: 0,
        },
      });
    }

    const dsliteFornecedorId = String(fornecedor.dslite_id || '').trim();
    const [products, offers] = await Promise.all([
      loadImpactedProducts(client, dsliteFornecedorId),
      loadImpactedOffers(client, dsliteFornecedorId),
    ]);
    const activeProducts = products.filter((product) => product.ativo !== false);
    const activeProductIds = activeProducts.map((product) => product.id);
    const mlProductIds = products
      .filter((product) => String(product.ml_item_id || '').trim())
      .map((product) => product.id);
    const activeOfferIds = offers
      .filter((offer) => offer.ativo !== false)
      .map((offer) => offer.id);

    let productsInactivated = 0;
    for (const idsChunk of chunk(activeProductIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produtos')
        .update({ ativo: false, estoque: 0 } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      productsInactivated += idsChunk.length;
    }

    let productsMlMarkedPaused = 0;
    for (const idsChunk of chunk(mlProductIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produtos')
        .update({ ml_status: 'pausado', estoque: 0 } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      productsMlMarkedPaused += idsChunk.length;
    }

    let supplierOffersInactivated = 0;
    for (const idsChunk of chunk(activeOfferIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
      const { error } = await client
        .from('produto_fornecedor_ofertas')
        .update({ ativo: false, estoque: 0 } as any)
        .in('id', idsChunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      supplierOffersInactivated += idsChunk.length;
    }

    let mlPauseEnqueued = 0;
    let mlPauseUpdatedExisting = 0;
    let mlPauseReopenedFailed = 0;
    let mlPauseSkippedNoItem = 0;
    let mlPauseFailed = 0;
    const errors: Array<{ product_id: string; sku: string; ml_item_id: string; error: string }> = [];

    for (const product of products) {
      const mlItemId = String(product.ml_item_id || '').trim();
      const sku = String(product.sku || '').trim();
      if (!mlItemId) {
        mlPauseSkippedNoItem += 1;
        continue;
      }

      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: product.id,
        mlItemId,
        desiredStatus: 'pausado',
        desiredQuantity: 0,
        desiredPrice: null,
        source: 'fornecedor_inativo',
        dedupePending: true,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: true,
          fornecedor_id: params.id,
          fornecedor_dslite_id: String(fornecedor.dslite_id || ''),
          fornecedor_apelido: String(fornecedor.apelido || ''),
          sku,
          origin: 'api/fornecedores/[id]/status',
        },
      });

      if (!outbox.ok) {
        mlPauseFailed += 1;
        errors.push({ product_id: product.id, sku, ml_item_id: mlItemId, error: outbox.error });
      } else if (outbox.action === 'updated_existing') {
        mlPauseUpdatedExisting += 1;
      } else if (outbox.action === 'reopened_failed') {
        mlPauseReopenedFailed += 1;
      } else {
        mlPauseEnqueued += 1;
      }
    }

    return NextResponse.json({
      success: mlPauseFailed === 0,
      fornecedor_id: params.id,
      ativo: false,
      records: {
        products_found: products.length,
        products_inactivated: productsInactivated,
        products_ml_marked_paused: productsMlMarkedPaused,
        supplier_offers_found: offers.length,
        supplier_offers_inactivated: supplierOffersInactivated,
        ml_pause_enqueued: mlPauseEnqueued,
        ml_pause_updated_existing: mlPauseUpdatedExisting,
        ml_pause_reopened_failed: mlPauseReopenedFailed,
        ml_pause_skipped_no_item: mlPauseSkippedNoItem,
        ml_pause_failed: mlPauseFailed,
      },
      errors,
    }, { status: mlPauseFailed === 0 ? 200 : 207 });
  } catch (err: any) {
    return NextResponse.json({ error: toPublicError(err, 'Erro ao atualizar fornecedor') }, { status: 500 });
  }
}
