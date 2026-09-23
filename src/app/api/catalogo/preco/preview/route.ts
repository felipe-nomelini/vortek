import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { evaluateEconomicMemory } from '@/services/pricing-economy';
import { evaluateProductPricing, loadPricingRequestContext, loadProductPricing } from '@/services/pricing-context';
import { marketContextKey, observedMarketContext, quoteMoney, readMarketQuote } from '@/services/pricing-market-quote';
import { hasMlAutomaticPrice } from '@/lib/ml/item-price-policy';
import type { EconomicInput } from '@/types/pricing';

const input = z.object({ produtoId: z.string().uuid(), mlItemId: z.string().regex(/^MLB\d+$/),
  priceCents: z.number().int().positive().safe() }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { 'Cache-Control': 'no-store' } });

/** Prévia de um único preço. Não grava avaliação, alerta, operação ou preço. */
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Informe um preço válido para este anúncio.' }, 422);
  const { produtoId, mlItemId, priceCents } = parsed.data;
  try {
    const client = createServiceClient();
    const [product, listing, snapshot] = await Promise.all([
      client.from('produtos').select('*').eq('id', produtoId).maybeSingle(),
      client.from('anuncios_ml').select('produto_id').eq('ml_item_id', mlItemId).maybeSingle(),
      client.from('catalogo_ml_snapshot').select('produto_id').eq('ml_item_id', mlItemId).maybeSingle(),
    ]);
    if (product.error || listing.error || snapshot.error) return json({ error: 'Falha ao conferir o anúncio.' }, 503);
    if (!product.data) return json({ error: 'Produto não encontrado.' }, 404);
    const owners = [listing.data?.produto_id, snapshot.data?.produto_id].filter(Boolean);
    if ((product.data.ml_item_id !== mlItemId && !owners.includes(produtoId))
      || owners.some(owner => owner !== produtoId)) return json({ error: 'Anúncio não pertence ao produto.' }, 422);
    const [me, remote] = await Promise.all([
      fetchMLResult<any>('/users/me'),
      fetchMLResult<any>('/items/' + encodeURIComponent(mlItemId)),
    ]);
    if (!me.ok || !me.data?.id || me.data.site_id !== 'MLB' || !remote.ok || !remote.data)
      return json({ error: 'Mercado Livre indisponível para calcular este preço.' }, 503);
    const context = observedMarketContext(remote.data, String(me.data.id));
    const currentPriceCents = quoteMoney(remote.data.price);
    if (!context || remote.data.id !== mlItemId || !currentPriceCents || remote.data.catalog_listing !== true)
      return json({ error: 'Anúncio de catálogo não confirmado no Mercado Livre.' }, 409);

    const pricingContext = await loadPricingRequestContext(client);
    const captured: { base?: Omit<EconomicInput, 'priceCents' | 'fee'> } = {};
    await loadProductPricing(client, [product.data], { requestContext: pricingContext,
      evidence: new Map([[produtoId, { mlItemId, currentPriceCents: priceCents,
        marketContextKey: marketContextKey(context) }]]),
      evaluate: (source, price, fee, observed) => {
        captured.base = source;
        return evaluateProductPricing(source, price, fee, observed);
      },
    });
    if (!captured.base) return json({ error: 'Fontes econômicas indisponíveis.' }, 503);
    const quote = await readMarketQuote({ fetch: fetchMLResult, context, priceCents,
      fallbackRate: pricingContext.commercial.mlFeeFallbackRate,
      unspecifiedShippingCost: pricingContext.commercial.unspecifiedShippingCost });
    const evaluated = evaluateEconomicMemory({ ...captured.base, evaluatedAt: new Date().toISOString(),
      priceCents, fee: quote.fee, shipping: quote.shipping });
    const conclusive = quote.fee.source === 'ml_live' && quote.shipping.amountCents !== null
      && evaluated.status !== 'inconclusive';
    const memory = conclusive ? evaluated.memory : null;
    const warnings = [
      ...(memory && memory.margin < memory.band.floor ? ['PRECO_ABAIXO_DO_PISO'] : []),
      ...(memory && memory.resultCents < 0 ? ['PREJUIZO_PREVISTO'] : []),
      ...(priceCents === currentPriceCents ? ['PRECO_JA_APLICADO'] : []),
      ...(!conclusive ? ['ECONOMIA_INCONCLUSIVA'] : []),
    ];
    return json({ currentPriceCents, priceCents, status: conclusive ? evaluated.status : 'inconclusive',
      resultCents: memory?.resultCents ?? null, marginPercent: memory ? memory.margin * 100 : null,
      warnings, automaticPricingActive: hasMlAutomaticPrice(remote.data), observedAt: new Date().toISOString() });
  } catch {
    return json({ error: 'Não foi possível calcular este preço agora.' }, 503);
  }
}
