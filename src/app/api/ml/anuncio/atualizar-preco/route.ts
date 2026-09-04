import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';
import { loadPricingTaxContext, requirePricingTaxRate } from '@/services/pricing-tax-context';
import { loadCommercialPricingConfiguration } from '@/services/commercial-pricing-configuration';
import { resolveMlFee } from '@/lib/commercial-pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';
import { fetchMLResult } from '@/services/integration';
import { setItemQuantityPricing } from '@/services/mercadolibre';
import { operationalMlStatus, selectOperationalMlListing } from '@/lib/ml/operational-listing';
import {
  isWinningBuyBoxStatus,
  normalizeBuyBoxStatus,
  normalizePriceToWin,
} from '@/lib/catalogo/no-catalogo';
import { hasMlAutomaticPrice } from '@/lib/ml/item-price-policy';

type PriceTarget = {
  mlItemId: string;
  localStatus: string;
  isCatalog: boolean;
};

type PriceUpdateResult = {
  success: boolean;
  mlItemId: string;
  type: 'standard' | 'catalog';
  basePrice: number;
  queued_publish: boolean;
  outboxId: string | null;
  price_updated: boolean;
  quantity_pricing_updated: boolean;
  quantity_pricing_queued: boolean;
  quantity_pricing_outbox_id: string | null;
  immediate_publish: {
    ok: boolean;
    status: number | null;
    error?: string;
    code?: string | null;
  };
  warnings: string[];
  errors: string[];
  error: string | null;
};

function isRetryableMlStatus(status: number | null): boolean {
  return [408, 409, 424, 429, 500, 502, 503, 504].includes(Number(status));
}

async function resolveTargets(params: {
  service: ReturnType<typeof createServiceClient>;
  produto: any;
  requestedMlItemId: string;
  linkedScope: boolean;
}): Promise<PriceTarget[]> {
  const { service, produto, requestedMlItemId, linkedScope } = params;
  let candidates: Array<{ ml_item_id: string; status: string; catalogo: boolean }> = [];

  if (linkedScope) {
    const { data, error } = await service
      .from('anuncios_ml')
      .select('ml_item_id,status,catalogo')
      .eq('produto_id', produto.id)
      .in('status', ['ativo', 'pausado']);
    if (error) throw new Error(`Falha ao buscar anúncios vinculados: ${error.message}`);
    candidates = (data || []).map((listing) => ({
      ml_item_id: String(listing.ml_item_id || '').trim().toUpperCase(),
      status: String(listing.status || ''),
      catalogo: Boolean(listing.catalogo),
    }));
  } else if (requestedMlItemId) {
    const { data: listing, error } = await service
      .from('anuncios_ml')
      .select('ml_item_id,status,catalogo')
      .eq('ml_item_id', requestedMlItemId)
      .eq('produto_id', produto.id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao validar anúncio: ${error.message}`);
    if (!listing) throw new Error('O anúncio informado não pertence a este produto');
    candidates = [{
      ml_item_id: String(listing.ml_item_id || '').trim().toUpperCase(),
      status: String(listing.status || ''),
      catalogo: Boolean(listing.catalogo),
    }];
  } else {
    candidates = [{
      ml_item_id: String(produto.ml_item_id || '').trim().toUpperCase(),
      status: String(produto.ml_status || ''),
      catalogo: false,
    }];
  }

  const uniqueCandidates = [...new Map(
    candidates
      .filter((candidate) => candidate.ml_item_id)
      .map((candidate) => [candidate.ml_item_id, candidate]),
  ).values()];
  if (uniqueCandidates.length === 0) throw new Error('Produto sem anúncio ativo ou pausado no Mercado Livre');

  for (const candidate of uniqueCandidates) {
    if (!['ativo', 'pausado'].includes(candidate.status)) {
      throw new Error(`O anúncio ${candidate.ml_item_id} não aceita atualização de preço no estado atual`);
    }
  }

  const itemResults = await Promise.all(uniqueCandidates.map(async (candidate) => ({
    candidate,
    result: await fetchMLResult<any>(`/items/${encodeURIComponent(candidate.ml_item_id)}`, { method: 'GET' }),
  })));
  const unavailable = itemResults.find(({ result }) => !result.ok || !result.data);
  if (unavailable) {
    throw new Error(
      unavailable.result.error?.message
      || `Não foi possível conferir o anúncio ${unavailable.candidate.ml_item_id} antes da alteração`,
    );
  }

  const automated = itemResults
    .filter(({ result }) => hasMlAutomaticPrice(result.data))
    .map(({ candidate }) => candidate.ml_item_id);
  if (automated.length > 0) {
    const error = new Error(`Automatização de preço ativa no Mercado Livre: ${automated.join(', ')}`);
    (error as any).code = 'dynamic_standard_price';
    (error as any).items = automated;
    throw error;
  }

  return itemResults.map(({ candidate, result }) => ({
    mlItemId: candidate.ml_item_id,
    localStatus: candidate.status,
    isCatalog: Boolean(result.data?.catalog_listing ?? candidate.catalogo),
  })).sort((left, right) => Number(left.isCatalog) - Number(right.isCatalog));
}

async function publishTargetPrice(params: {
  service: ReturnType<typeof createServiceClient>;
  produto: any;
  target: PriceTarget;
  basePrice: number;
  source: 'catalog_price_to_win' | 'default';
}): Promise<PriceUpdateResult> {
  const { service, produto, target, basePrice, source } = params;
  const warnings: string[] = [];
  const errors: string[] = [];

  await (service
    .from('anuncios_ml_outbox' as any)
    .update({
      status: 'cancelled',
      last_error: 'Cancelado: preço manual mais recente publicado direto no Mercado Livre',
      updated_at: new Date().toISOString(),
    } as any)
    .eq('ml_item_id', target.mlItemId)
    .eq('source', 'ml_anuncio_atualizar_preco')
    .in('status', ['pending', 'retry']) as any);

  const priceResult = await fetchMLResult<any>(`/items/${encodeURIComponent(target.mlItemId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: basePrice }),
  });

  if (!priceResult.ok) {
    const errorMessage = priceResult.error?.message || 'Falha ao atualizar preço no Mercado Livre';
    if (!isRetryableMlStatus(priceResult.status)) {
      return {
        success: false,
        mlItemId: target.mlItemId,
        type: target.isCatalog ? 'catalog' : 'standard',
        basePrice,
        queued_publish: false,
        outboxId: null,
        immediate_publish: { ok: false, status: priceResult.status, error: errorMessage, code: priceResult.error?.code || null },
        price_updated: false,
        quantity_pricing_updated: false,
        quantity_pricing_queued: false,
        quantity_pricing_outbox_id: null,
        warnings,
        errors: [errorMessage],
        error: errorMessage,
      };
    }

    const outbox = await enqueueMlPublishOutbox(service, {
      produtoId: String(produto.id),
      mlItemId: target.mlItemId,
      desiredStatus: (target.localStatus || null) as any,
      desiredPrice: basePrice,
      desiredQuantity: typeof produto.estoque === 'number' ? produto.estoque : null,
      source: 'ml_anuncio_atualizar_preco',
      payload: {
        source,
        fallback_reason: priceResult.error?.code || `HTTP ${priceResult.status}`,
        apply_status: false,
        apply_price: true,
        apply_quantity: false,
        apply_quantity_pricing: true,
        update_quantity_pricing: true,
      },
    });
    const queued = outbox.ok && outbox.action !== 'skipped_ineligible';
    if (!outbox.ok) errors.push(`Falha ao enfileirar publicação no ML: ${outbox.error}`);
    if (outbox.ok && outbox.action === 'skipped_ineligible') errors.push(`Anúncio não aceita publicação: ${outbox.reason}`);

    return {
      success: queued,
      mlItemId: target.mlItemId,
      type: target.isCatalog ? 'catalog' : 'standard',
      basePrice,
      queued_publish: queued,
      outboxId: queued ? outbox.outboxId : null,
      immediate_publish: { ok: false, status: priceResult.status, error: errorMessage, code: priceResult.error?.code || null },
      price_updated: false,
      quantity_pricing_updated: false,
      quantity_pricing_queued: queued,
      quantity_pricing_outbox_id: queued ? outbox.outboxId : null,
      warnings,
      errors,
      error: queued ? null : (errors[0] || errorMessage),
    };
  }

  const itemState = await fetchMLResult<any>(`/items/${encodeURIComponent(target.mlItemId)}`, { method: 'GET' });
  if (itemState.ok && itemState.data) {
    const listingReconcile = await reconcileAnuncioMlFromItem(service, itemState.data, 'observed_sync');
    if (!listingReconcile.ok) warnings.push(`Preço atualizado, mas falhou ao reconciliar anúncio: ${listingReconcile.error}`);
  } else {
    warnings.push(itemState.error?.message || 'Preço atualizado, mas não foi possível conferir o estado final do anúncio.');
  }

  const quantityPricingResult = await setItemQuantityPricing(target.mlItemId, basePrice);
  let quantityPricingQueued = false;
  let quantityPricingOutboxId: string | null = null;
  if (!quantityPricingResult.ok) {
    warnings.push(quantityPricingResult.error || 'Preço atualizado, mas atacado não foi confirmado.');
    if (isRetryableMlStatus(quantityPricingResult.httpStatus || null)) {
      const quantityOutbox = await enqueueMlPublishOutbox(service, {
        produtoId: String(produto.id),
        mlItemId: target.mlItemId,
        desiredStatus: null,
        desiredPrice: null,
        desiredQuantity: null,
        source: 'ml_anuncio_atualizar_preco_atacado_retry',
        payload: {
          source,
          apply_price: false,
          apply_status: false,
          apply_quantity: false,
          apply_quantity_pricing: true,
          update_quantity_pricing: true,
          base_price_for_quantity_pricing: basePrice,
          fallback_reason: quantityPricingResult.code || quantityPricingResult.httpStatus || 'quantity_pricing_retry',
        },
      });
      quantityPricingQueued = quantityOutbox.ok && quantityOutbox.action !== 'skipped_ineligible';
      quantityPricingOutboxId = quantityPricingQueued
        && quantityOutbox.ok
        && quantityOutbox.action !== 'skipped_ineligible'
        ? quantityOutbox.outboxId
        : null;
      if (!quantityOutbox.ok) warnings.push(`Falha ao enfileirar retry de atacado: ${quantityOutbox.error}`);
      if (quantityOutbox.ok && quantityOutbox.action === 'skipped_ineligible') warnings.push(`Retry de atacado não enfileirado: ${quantityOutbox.reason}`);
    }
  }

  if (target.isCatalog || Boolean(itemState.data?.catalog_listing)) {
    const competitionResult = await fetchMLResult<any>(`/items/${encodeURIComponent(target.mlItemId)}/price_to_win?version=v2`);
    if (competitionResult.ok && competitionResult.data) {
      const rawStatus = normalizeBuyBoxStatus(competitionResult.data);
      const rawPriceToWin = normalizePriceToWin(competitionResult.data);
      const priceToWin = Number.isFinite(Number(rawPriceToWin)) && Number(rawPriceToWin) > 0
        ? Math.round(Number(rawPriceToWin) * 100) / 100
        : null;
      const snapshotUpdate = await service.from('catalogo_ml_snapshot').update({
        buy_box_status: rawStatus,
        buy_box_winning: isWinningBuyBoxStatus(rawStatus),
        price_to_win: priceToWin,
        price: basePrice,
        synced_at: new Date().toISOString(),
      } as any).eq('ml_item_id', target.mlItemId);
      if (snapshotUpdate.error) warnings.push(`Preço atualizado, mas falhou ao atualizar disputa do catálogo: ${snapshotUpdate.error.message}`);
    } else {
      warnings.push(competitionResult.error?.message || 'Preço atualizado, mas não foi possível atualizar a disputa do catálogo.');
    }
  }

  return {
    success: true,
    mlItemId: target.mlItemId,
    type: target.isCatalog ? 'catalog' : 'standard',
    basePrice,
    queued_publish: false,
    outboxId: quantityPricingQueued ? quantityPricingOutboxId : null,
    immediate_publish: { ok: true, status: priceResult.status },
    price_updated: true,
    quantity_pricing_updated: quantityPricingResult.ok,
    quantity_pricing_queued: quantityPricingQueued,
    quantity_pricing_outbox_id: quantityPricingOutboxId,
    warnings,
    errors,
    error: null,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const produtoId = String(body?.produtoId || '').trim();
    const requestedMlItemId = String(body?.mlItemId || '').trim().toUpperCase();
    const source = (body?.source as 'catalog_price_to_win' | 'default' | undefined) || 'default';
    const linkedScope = body?.scope === 'linked';
    if (!produtoId) return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 400 });

    let targetPrice: number | null = null;
    if (body?.targetPrice !== undefined && body?.targetPrice !== null && String(body.targetPrice).trim() !== '') {
      const parsed = Number(body.targetPrice);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'targetPrice inválido. Informe um número maior que zero.' }, { status: 422 });
      }
      targetPrice = Math.round(parsed * 100) / 100;
    }

    const service = createServiceClient();
    const [pricingTaxContext, commercial] = await Promise.all([
      loadPricingTaxContext(service),
      loadCommercialPricingConfiguration(service),
    ]);
    const taxRate = requirePricingTaxRate(pricingTaxContext);
    const { data: produto, error } = await service
      .from('produtos')
      .select('id,ml_item_id,ml_status,custom_price,custo,ml_fee,ml_shipping,estoque')
      .eq('id', produtoId)
      .single();
    if (error || !produto) return NextResponse.json({ error: error?.message || 'Produto não encontrado' }, { status: 404 });
    if (!produto.ml_item_id) return NextResponse.json({ error: 'Produto sem anúncio no Mercado Livre' }, { status: 422 });

    const targets = await resolveTargets({ service, produto, requestedMlItemId, linkedScope });
    let basePrice = targetPrice;
    if (basePrice === null) {
      basePrice = typeof produto.custom_price === 'number' && Number.isFinite(produto.custom_price)
        ? produto.custom_price
        : calculateSuggestedPrice({
            cost: Number(produto.custo || 0),
            shipping: Number(produto.ml_shipping || 0),
            mlFee: resolveMlFee(produto.ml_fee, commercial.mlFeeFallbackRate),
            taxRate,
            costTiers: commercial.costTiers,
          }).suggestedPrice;
    }
    basePrice = Math.round(basePrice * 100) / 100;

    const { error: persistError } = await service.from('produtos').update({ custom_price: basePrice } as any).eq('id', produto.id);
    if (persistError) return NextResponse.json({ error: `Falha ao salvar preço desejado local: ${persistError.message}` }, { status: 500 });

    const results: PriceUpdateResult[] = [];
    for (const target of targets) results.push(await publishTargetPrice({ service, produto, target, basePrice, source }));

    const { data: reconciledListings, error: reconciledListingsError } = await service
      .from('anuncios_ml')
      .select('ml_item_id,status,catalogo')
      .eq('produto_id', produto.id);
    if (!reconciledListingsError && reconciledListings && reconciledListings.length > 0) {
      const operational = selectOperationalMlListing(reconciledListings.map((listing) => ({
        ...listing,
        catalog_listing: Boolean(listing.catalogo),
      })));
      if (operational) {
        const operationalUpdate = await service.from('produtos').update({
          ml_item_id: operational.ml_item_id,
          ml_status: operationalMlStatus(operational),
        } as any).eq('id', produto.id);
        if (operationalUpdate.error) {
          for (const result of results) {
            result.warnings.push(`Preço processado, mas falhou ao reconciliar o anúncio operacional: ${operationalUpdate.error.message}`);
          }
        }
      }
    } else if (reconciledListingsError) {
      for (const result of results) {
        result.warnings.push(`Preço processado, mas falhou ao conferir os anúncios vinculados: ${reconciledListingsError.message}`);
      }
    }

    console.log(JSON.stringify({
      event: 'ml_anuncio_atualizar_preco',
      timestamp_utc: new Date().toISOString(),
      produto_id: produto.id,
      scope: linkedScope ? 'linked' : 'single',
      target_price_received: targetPrice,
      base_price: basePrice,
      results: results.map((result) => ({
        ml_item_id: result.mlItemId,
        type: result.type,
        price_updated: result.price_updated,
        queued_publish: result.queued_publish,
        success: result.success,
      })),
    }));

    if (!linkedScope) {
      const result = results[0];
      return NextResponse.json({
        ...result,
        produtoId: produto.id,
        source,
        target_price_received: targetPrice,
        message: result.price_updated
          ? (result.quantity_pricing_updated ? 'Preço e atacado atualizados no Mercado Livre' : 'Preço atualizado no Mercado Livre; atacado ficou pendente')
          : (result.queued_publish ? 'Mercado Livre retornou erro transitório; atualização ficou em fila para retry' : result.error),
      }, { status: result.success ? 200 : 502 });
    }

    const accepted = results.filter((result) => result.price_updated || result.queued_publish).length;
    const failed = results.length - accepted;
    const status = failed === 0 ? 200 : accepted > 0 ? 207 : 502;
    return NextResponse.json({
      success: failed === 0,
      partial: accepted > 0 && failed > 0,
      produtoId: produto.id,
      basePrice,
      target_price_received: targetPrice,
      price_updated: results.every((result) => result.price_updated),
      queued_publish: results.some((result) => result.queued_publish),
      outboxIds: results.map((result) => result.outboxId).filter(Boolean),
      results,
      error: failed > 0 ? `${failed} anúncio${failed === 1 ? '' : 's'} não recebeu${failed === 1 ? '' : 'ram'} o novo preço` : null,
    }, { status });
  } catch (error: any) {
    const status = error?.code === 'dynamic_standard_price' ? 409 : 422;
    return NextResponse.json({
      error: error?.message || 'Erro interno',
      code: error?.code || null,
      blockedItems: Array.isArray(error?.items) ? error.items : undefined,
    }, { status });
  }
}
