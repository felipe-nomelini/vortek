import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';

type QuantityPricingTier = {
  min_purchase_unit: number;
  amount: number;
  currency_id: string;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function calculateProfit(input: {
  price: number;
  cost: number;
  shipping: number;
  mlFee: number;
}) {
  return round2(
    input.price
      - input.cost
      - input.shipping
      - (input.price * 0.04)
      - (input.price * input.mlFee),
  );
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

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const produtoId = String(new URL(request.url).searchParams.get('produtoId') || '').trim();
  if (!produtoId) return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 422 });

  const service = createServiceClient();
  const { data: produto, error } = await service
    .from('produtos')
    .select('id,ml_item_id,custo,ml_fee,ml_shipping')
    .eq('id', produtoId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: `Falha ao buscar produto: ${error.message}` }, { status: 500 });
  if (!produto?.ml_item_id) return NextResponse.json({ error: 'Produto sem anúncio no Mercado Livre' }, { status: 422 });

  const itemResult = await fetchMLResult<any>(`/items/${encodeURIComponent(String(produto.ml_item_id))}`);
  if (!itemResult.ok || !itemResult.data) {
    return NextResponse.json({ error: itemResult.error?.message || 'Falha ao consultar preço atual no Mercado Livre' }, { status: itemResult.status || 502 });
  }

  const price = Number(itemResult.data.price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'Mercado Livre retornou preço atual inválido' }, { status: 502 });
  }

  const quantityResult = await fetchMLResult<any>(`/items/${encodeURIComponent(String(produto.ml_item_id))}/prices`, {
    headers: { 'show-all-prices': 'TRUE' },
  });
  const cost = Number(produto.custo || 0);
  const shipping = Number(produto.ml_shipping || 0);
  const mlFee = Number(produto.ml_fee || 0.15);

  return NextResponse.json({
    success: true,
    mlItemId: produto.ml_item_id,
    currentPrice: round2(price),
    currentProfit: calculateProfit({ price, cost, shipping, mlFee }),
    quantityPricing: quantityResult.ok ? extractQuantityPricingTiers(quantityResult.data) : [],
    quantityPricingWarning: quantityResult.ok ? null : (quantityResult.error?.message || 'Não foi possível consultar preços de atacado no ML.'),
    calculator: { cost, shipping, mlFee },
  });
}
