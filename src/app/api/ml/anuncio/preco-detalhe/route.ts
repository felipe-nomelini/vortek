import { evaluateProductPricing, persistPricingEvaluation } from '@/services/pricing-context';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import {
  isWinningBuyBoxStatus,
  normalizeBuyBoxStatus,
  normalizePriceToWin,
  resolveCatalogCompetitionStatus,
} from '@/lib/catalogo/no-catalogo';

type QuantityPricingTier = {
  min_purchase_unit: number;
  amount: number;
  currency_id: string;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}


function extractQuantityPricingTiers(raw: any): QuantityPricingTier[] {
  const source = Array.isArray(raw?.prices) ? raw.prices : Array.isArray(raw) ? raw : [];
  const tiers: QuantityPricingTier[] = [];

  for (const entry of source) {
    const contexts = Array.isArray(entry?.conditions?.context_restrictions)
      ? entry.conditions.context_restrictions.map((value: unknown) => String(value || '').toLowerCase())
      : [];
    const amount = Number(entry?.amount);
    const minPurchaseUnit = Number(
      entry?.conditions?.min_purchase_unit
      ?? entry?.conditions?.min_purchase_quantity
      ?? entry?.min_purchase_unit
      ?? entry?.min_purchase_quantity,
    );
    if (!contexts.includes('user_type_business') || !Number.isFinite(amount) || !Number.isFinite(minPurchaseUnit) || minPurchaseUnit <= 0) continue;

    tiers.push({
      min_purchase_unit: Math.trunc(minPurchaseUnit),
      amount: round2(amount),
      currency_id: String(entry?.currency_id || 'BRL'),
    });
  }

  return tiers.sort((a, b) => a.min_purchase_unit - b.min_purchase_unit);
}

function normalizeReasons(payload: any): string[] {
  const source = Array.isArray(payload?.reason)
    ? payload.reason
    : Array.isArray(payload?.reasons)
      ? payload.reasons
      : payload?.reason
        ? [payload.reason]
        : [];
  return source
    .map((reason: any) => String(reason?.message || reason?.id || reason || '').trim())
    .filter(Boolean);
}

function normalizeBoosts(payload: any) {
  return (Array.isArray(payload?.boosts) ? payload.boosts : [])
    .map((boost: any) => ({
      id: String(boost?.id || '').trim(),
      status: String(boost?.status || '').trim(),
      description: String(boost?.description || '').trim(),
    }))
    .filter((boost: any) => boost.id || boost.description);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const searchParams = new URL(request.url).searchParams;
  const produtoId = String(searchParams.get('produtoId') || '').trim();
  const requestedMlItemId = String(searchParams.get('mlItemId') || '').trim().toUpperCase();
  if (!produtoId) return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 422 });

  const service = createServiceClient();
  const { data: produto, error } = await service
    .from('produtos')
    .select('id,ml_item_id,custo,ml_fee,ml_shipping')
    .eq('id', produtoId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: `Falha ao buscar produto: ${error.message}` }, { status: 500 });
  if (!produto?.ml_item_id) return NextResponse.json({ error: 'Produto sem anúncio no Mercado Livre' }, { status: 422 });

  let catalogListing = false;
  let mlItemId = requestedMlItemId || String(produto.ml_item_id);
  if (requestedMlItemId) {
    const { data: anuncio, error: anuncioError } = await service
      .from('anuncios_ml')
      .select('ml_item_id,produto_id,catalogo')
      .eq('ml_item_id', requestedMlItemId)
      .eq('produto_id', produtoId)
      .maybeSingle();
    if (anuncioError) {
      return NextResponse.json({ error: `Falha ao validar anúncio: ${anuncioError.message}` }, { status: 500 });
    }
    if (!anuncio) {
      return NextResponse.json({ error: 'O anúncio informado não pertence a este produto' }, { status: 422 });
    }
    mlItemId = String(anuncio.ml_item_id);
    catalogListing = Boolean(anuncio.catalogo);
  }

  const itemResult = await fetchMLResult<any>(`/items/${encodeURIComponent(mlItemId)}`);
  if (!itemResult.ok || !itemResult.data) {
    return NextResponse.json({ error: itemResult.error?.message || 'Falha ao consultar preço atual no Mercado Livre' }, { status: itemResult.status || 502 });
  }
  catalogListing = Boolean(itemResult.data.catalog_listing ?? catalogListing);

  const price = Number(itemResult.data.price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'Mercado Livre retornou preço atual inválido' }, { status: 502 });
  }

  const quantityResult = await fetchMLResult<any>(`/items/${encodeURIComponent(mlItemId)}/prices`, {
    headers: { 'show-all-prices': 'TRUE' },
  });
  const cost = Number(produto.custo || 0);
  const shipping = Number(produto.ml_shipping || 0);
  const mlFee = Number(produto.ml_fee || 0.15);
  let catalog: any = null;

  if (catalogListing) {
    const { data: snapshot } = await service
      .from('catalogo_ml_snapshot')
      .select('buy_box_status,buy_box_winning,catalog_product_id,price_to_win,price,synced_at')
      .eq('ml_item_id', mlItemId)
      .maybeSingle();
    const competitionResult = await fetchMLResult<any>(
      `/items/${encodeURIComponent(mlItemId)}/price_to_win?version=v2`,
    );
    const competition = competitionResult.ok ? competitionResult.data : null;
    const rawStatus = normalizeBuyBoxStatus(competition) || snapshot?.buy_box_status || null;
    const rawPriceToWin = competition
      ? normalizePriceToWin(competition)
      : Number(snapshot?.price_to_win);
    const priceToWin = Number.isFinite(Number(rawPriceToWin)) && Number(rawPriceToWin) > 0
      ? round2(Number(rawPriceToWin))
      : null;
    const catalogProductId = String(
      competition?.catalog_product_id
      || itemResult.data?.catalog_product_id
      || snapshot?.catalog_product_id
      || '',
    ).trim() || null;
    const winner = competition?.winner && typeof competition.winner === 'object'
      ? {
          itemId: String(competition.winner.item_id || competition.winner.id || '').trim() || null,
          price: Number.isFinite(Number(competition.winner.price)) ? round2(Number(competition.winner.price)) : null,
          currencyId: String(competition.winner.currency_id || competition.currency_id || 'BRL'),
        }
      : null;

    catalog = {
      status: resolveCatalogCompetitionStatus({
        catalogListing: true,
        buyBoxStatus: rawStatus,
        buyBoxWinning: snapshot?.buy_box_winning,
      }),
      rawStatus,
      priceToWin,
      catalogProductId,
      currentPrice: round2(Number(competition?.current_price ?? price)),
      currencyId: String(competition?.currency_id || itemResult.data?.currency_id || 'BRL'),
      consistent: typeof competition?.consistent === 'boolean' ? competition.consistent : null,
      visitShare: String(competition?.visit_share || '').trim() || null,
      competitorsSharingFirstPlace: Number.isFinite(Number(competition?.competitors_sharing_first_place))
        ? Number(competition.competitors_sharing_first_place)
        : null,
      winner,
      boosts: normalizeBoosts(competition),
      reasons: normalizeReasons(competition),
      warning: competitionResult.ok
        ? null
        : (competitionResult.error?.message || 'Não foi possível atualizar a disputa do catálogo agora; exibindo o último estado sincronizado.'),
      syncedAt: competitionResult.ok ? new Date().toISOString() : (snapshot?.synced_at || null),
    };

    if (competitionResult.ok) {
      await service
        .from('catalogo_ml_snapshot')
        .update({
          buy_box_status: rawStatus,
          buy_box_winning: isWinningBuyBoxStatus(rawStatus),
          catalog_product_id: catalogProductId,
          price_to_win: priceToWin,
          price: round2(price),
          synced_at: new Date().toISOString(),
        } as any)
        .eq('ml_item_id', mlItemId);
    }
  }

  const evaluation = await evaluateProductPricing(service, { productId: produtoId, itemId: mlItemId, price, requireLive: true });
  if (evaluation.memory) await persistPricingEvaluation(service, { ...evaluation, memory: evaluation.memory, scenario: 'current', itemId: mlItemId });
  return NextResponse.json({
    success: true,
    mlItemId,
    currentPrice: round2(price),
    currentProfit: evaluation.memory?.result ?? null,
    memory: evaluation.memory,
    quantityPricing: quantityResult.ok ? extractQuantityPricingTiers(quantityResult.data) : [],
    quantityPricingWarning: quantityResult.ok ? null : (quantityResult.error?.message || 'Não foi possível consultar preços de atacado no ML.'),
    calculator: { cost, shipping, mlFee },
    catalog,
  });
}
