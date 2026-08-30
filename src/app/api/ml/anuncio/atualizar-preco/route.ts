import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';
import { fetchMLResult } from '@/services/integration';
import { setItemQuantityPricing } from '@/services/mercadolibre';
import { mapMlStatusToLocalStatus } from '@/lib/ml/status';
import {
  isWinningBuyBoxStatus,
  normalizeBuyBoxStatus,
  normalizePriceToWin,
} from '@/lib/catalogo/no-catalogo';

function isRetryableMlStatus(status: number | null): boolean {
  return [408, 409, 424, 429, 500, 502, 503, 504].includes(Number(status));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const produtoId = body?.produtoId as string | undefined;
    const requestedMlItemId = String(body?.mlItemId || '').trim().toUpperCase();
    const source = (body?.source as 'catalog_price_to_win' | 'default' | undefined) || 'default';
    const targetPriceRaw = body?.targetPrice;

    if (!produtoId) {
      return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 400 });
    }

    let targetPrice: number | null = null;
    if (targetPriceRaw !== undefined && targetPriceRaw !== null && String(targetPriceRaw).trim() !== '') {
      const parsed = Number(targetPriceRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'targetPrice inválido. Informe um número maior que zero.' }, { status: 422 });
      }
      targetPrice = Math.round(parsed * 100) / 100;
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase
      .from('produtos')
      .select('id, ml_item_id, ml_status, custom_price, custo, ml_fee, ml_shipping, estoque')
      .eq('id', produtoId)
      .single();

    if (error || !produto) {
      return NextResponse.json({ error: error?.message || 'Produto não encontrado' }, { status: 404 });
    }

    if (!produto.ml_item_id) {
      return NextResponse.json({ error: 'Produto sem anúncio no Mercado Livre' }, { status: 422 });
    }

    let targetMlItemId = requestedMlItemId || String(produto.ml_item_id);
    let targetLocalStatus = String(produto.ml_status || '');
    let targetIsCatalog = false;
    if (requestedMlItemId) {
      const { data: anuncio, error: anuncioError } = await supabase
        .from('anuncios_ml')
        .select('ml_item_id,produto_id,status,catalogo')
        .eq('ml_item_id', requestedMlItemId)
        .eq('produto_id', produto.id)
        .maybeSingle();
      if (anuncioError) {
        return NextResponse.json({ error: `Falha ao validar anúncio: ${anuncioError.message}` }, { status: 500 });
      }
      if (!anuncio) {
        return NextResponse.json({ error: 'O anúncio informado não pertence a este produto' }, { status: 422 });
      }
      targetMlItemId = String(anuncio.ml_item_id);
      targetLocalStatus = String(anuncio.status || '');
      targetIsCatalog = Boolean(anuncio.catalogo);
    }

    if (!['ativo', 'pausado'].includes(targetLocalStatus)) {
      return NextResponse.json({ error: 'A atualização de preço só é permitida para anúncio ativo ou pausado' }, { status: 422 });
    }

    let basePrice: number;
    if (targetPrice !== null) {
      basePrice = targetPrice;
    } else {
      if (typeof produto.custom_price === 'number' && Number.isFinite(produto.custom_price)) {
        basePrice = produto.custom_price;
      } else {
        const calc = calculateSuggestedPrice({
          cost: Number(produto.custo || 0),
          shipping: Number(produto.ml_shipping || 0),
          mlFee: Number(produto.ml_fee || 0.15),
        });
        basePrice = calc.suggestedPrice;
      }
    }

    basePrice = Math.round(basePrice * 100) / 100;

    const { error: persistError } = await supabase
      .from('produtos')
      .update({ custom_price: basePrice } as any)
      .eq('id', produto.id);

    if (persistError) {
      return NextResponse.json({ error: `Falha ao salvar preço desejado local: ${persistError.message}` }, { status: 500 });
    }

    await (supabase
      .from('anuncios_ml_outbox' as any)
      .update({
        status: 'cancelled',
        last_error: 'Cancelado: preço manual mais recente publicado direto no Mercado Livre',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('ml_item_id', targetMlItemId)
      .eq('source', 'ml_anuncio_atualizar_preco')
      .in('status', ['pending', 'retry']) as any);

    const priceResult = await fetchMLResult<any>(`/items/${targetMlItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: basePrice }),
    });

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!priceResult.ok) {
      if (!isRetryableMlStatus(priceResult.status)) {
        return NextResponse.json({
          success: false,
          produtoId: produto.id,
          mlItemId: targetMlItemId,
          basePrice,
          source,
          target_price_received: targetPrice,
          queued_publish: false,
          immediate_publish: {
            ok: false,
            status: priceResult.status,
            error: priceResult.error?.message || 'Falha ao atualizar preço no Mercado Livre',
            code: priceResult.error?.code || null,
          },
          price_updated: false,
          quantity_pricing_updated: false,
          quantity_pricing_queued: false,
          errors: [priceResult.error?.message || 'Falha ao atualizar preço no Mercado Livre'],
        }, { status: 502 });
      }

      const outbox = await enqueueMlPublishOutbox(supabase, {
        produtoId: String(produto.id),
        mlItemId: targetMlItemId,
        desiredStatus: (targetLocalStatus || null) as any,
        desiredPrice: basePrice,
        desiredQuantity: typeof produto.estoque === 'number' ? produto.estoque : null,
        source: 'ml_anuncio_atualizar_preco',
        payload: {
          source,
          target_price_received: targetPrice,
          fallback_reason: priceResult.error?.code || `HTTP ${priceResult.status}`,
          apply_status: false,
          apply_price: true,
          apply_quantity: false,
          apply_quantity_pricing: true,
          update_quantity_pricing: true,
        },
      });

      if (!outbox.ok) {
        errors.push(`Falha ao enfileirar publicação no ML: ${outbox.error}`);
      } else if (outbox.action === 'skipped_ineligible') {
        errors.push(`Anúncio não aceita publicação: ${outbox.reason}`);
      }
      const queuedPublish = outbox.ok && outbox.action !== 'skipped_ineligible';

      console.log(JSON.stringify({
        event: 'ml_anuncio_atualizar_preco',
        timestamp_utc: new Date().toISOString(),
        produto_id: produto.id,
        ml_item_id: targetMlItemId,
        source,
        target_price_received: targetPrice,
        base_price: basePrice,
        price_updated: false,
        queued_publish: queuedPublish,
        outbox_id: queuedPublish ? outbox.outboxId : null,
        fallback_reason: priceResult.error?.code || priceResult.status,
        success: queuedPublish,
      }));

      return NextResponse.json({
        success: queuedPublish,
        produtoId: produto.id,
        mlItemId: targetMlItemId,
        basePrice,
        source,
        target_price_received: targetPrice,
        queued_publish: queuedPublish,
        immediate_publish: {
          ok: false,
          status: priceResult.status,
          error: priceResult.error?.message || 'Falha transitória ao atualizar preço no Mercado Livre',
          code: priceResult.error?.code || null,
        },
        quantity_pricing_queued: queuedPublish,
        outboxId: queuedPublish ? outbox.outboxId : null,
        price_updated: false,
        quantity_pricing_updated: false,
        message: queuedPublish
          ? 'Mercado Livre retornou erro transitório; atualização ficou em fila para retry'
          : 'Mercado Livre retornou erro, mas o anúncio não foi enfileirado',
        errors,
      }, { status: queuedPublish ? 200 : (outbox.ok ? 422 : 500) });
    }

    const itemState = await fetchMLResult<any>(`/items/${targetMlItemId}`, { method: 'GET' });
    if (itemState.ok && itemState.data) {
      const resolvedLocalStatus = mapMlStatusToLocalStatus(itemState.data?.status);
      const produtoUpdate = await supabase
        .from('produtos')
        .update({ ml_status: resolvedLocalStatus } as any)
        .eq('id', produto.id);
      if (produtoUpdate.error) {
        warnings.push(`Preço atualizado, mas falhou ao reconciliar produto: ${produtoUpdate.error.message}`);
      }

      const anuncioReconcile = await reconcileAnuncioMlFromItem(
        supabase,
        itemState.data,
        'publish_reconcile',
      );
      if (!anuncioReconcile.ok) {
        warnings.push(`Preço atualizado, mas falhou ao reconciliar anúncio: ${anuncioReconcile.error}`);
      }
    } else {
      warnings.push(itemState.error?.message || 'Preço atualizado, mas não foi possível conferir estado final do anúncio.');
    }

    const quantityPricingResult = await setItemQuantityPricing(targetMlItemId, basePrice);
    let quantityPricingQueued = false;
    let quantityPricingOutboxId: string | null = null;
    if (!quantityPricingResult.ok) {
      warnings.push(quantityPricingResult.error || 'Preço atualizado, mas atacado não foi confirmado.');
      if (isRetryableMlStatus(quantityPricingResult.httpStatus || null)) {
        const quantityOutbox = await enqueueMlPublishOutbox(supabase, {
          produtoId: String(produto.id),
          mlItemId: targetMlItemId,
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
        quantityPricingOutboxId = quantityOutbox.ok && quantityOutbox.action !== 'skipped_ineligible'
          ? quantityOutbox.outboxId
          : null;
        if (!quantityOutbox.ok) {
          warnings.push(`Falha ao enfileirar retry de atacado: ${quantityOutbox.error}`);
        } else if (quantityOutbox.action === 'skipped_ineligible') {
          warnings.push(`Retry de atacado não enfileirado: ${quantityOutbox.reason}`);
        }
      }
    }

    if (targetIsCatalog || Boolean(itemState.data?.catalog_listing)) {
      const competitionResult = await fetchMLResult<any>(
        `/items/${encodeURIComponent(targetMlItemId)}/price_to_win?version=v2`,
      );
      if (competitionResult.ok && competitionResult.data) {
        const rawStatus = normalizeBuyBoxStatus(competitionResult.data);
        const rawPriceToWin = normalizePriceToWin(competitionResult.data);
        const priceToWin = Number.isFinite(Number(rawPriceToWin)) && Number(rawPriceToWin) > 0
          ? Math.round(Number(rawPriceToWin) * 100) / 100
          : null;
        const snapshotUpdate = await supabase
          .from('catalogo_ml_snapshot')
          .update({
            buy_box_status: rawStatus,
            buy_box_winning: isWinningBuyBoxStatus(rawStatus),
            price_to_win: priceToWin,
            price: basePrice,
            synced_at: new Date().toISOString(),
          } as any)
          .eq('ml_item_id', targetMlItemId);
        if (snapshotUpdate.error) {
          warnings.push(`Preço atualizado, mas falhou ao atualizar disputa do catálogo: ${snapshotUpdate.error.message}`);
        }
      } else {
        warnings.push(
          competitionResult.error?.message
          || 'Preço atualizado, mas não foi possível atualizar a disputa do catálogo.',
        );
      }
    }

    console.log(JSON.stringify({
      event: 'ml_anuncio_atualizar_preco',
      timestamp_utc: new Date().toISOString(),
      produto_id: produto.id,
      ml_item_id: targetMlItemId,
      source,
      target_price_received: targetPrice,
      base_price: basePrice,
      queued_publish: false,
      immediate_publish: true,
      quantity_pricing_updated: quantityPricingResult.ok,
      quantity_pricing_queued: quantityPricingQueued,
      quantity_pricing_outbox_id: quantityPricingOutboxId,
      success: true,
    }));

    return NextResponse.json({
      success: true,
      produtoId: produto.id,
      mlItemId: targetMlItemId,
      basePrice,
      source,
      target_price_received: targetPrice,
      queued_publish: false,
      immediate_publish: {
        ok: true,
        status: priceResult.status,
      },
      quantity_pricing_queued: quantityPricingQueued,
      quantity_pricing_outbox_id: quantityPricingOutboxId,
      outboxId: quantityPricingQueued ? quantityPricingOutboxId : null,
      price_updated: true,
      quantity_pricing_updated: quantityPricingResult.ok,
      message: quantityPricingResult.ok
        ? 'Preço e atacado atualizados no Mercado Livre'
        : 'Preço atualizado no Mercado Livre; atacado ficou pendente',
      warnings,
      errors,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro interno' }, { status: 500 });
  }
}
