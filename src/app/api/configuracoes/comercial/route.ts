import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  commercialConfigurationSchema,
  configurationValidationMessage,
} from "@/lib/configuracoes/contracts";
import { loadCommercialPricingConfiguration } from "@/services/commercial-pricing-configuration";
import { loadPricingTaxContext } from "@/services/pricing-tax-context";
import { recordConfigurationAudit } from "@/services/configuration-audit";
import type { CommercialPricingConfiguration } from "@/lib/commercial-pricing";

import { FINAL_PRICE_POLICY } from "@/services/pricing-policy";

const CONFIG_ROW_ID = "00000000-0000-0000-0000-000000000001";

function toDto(
  configuration: CommercialPricingConfiguration,
  pricingTaxContext: Awaited<ReturnType<typeof loadPricingTaxContext>>,
) {
  return {
    mlFeeFallbackPercent: configuration.mlFeeFallbackRate * 100,
    unspecifiedShippingCost: configuration.unspecifiedShippingCost,
    inactiveCostThreshold: configuration.inactiveCostThreshold,
    finalPricePolicy: FINAL_PRICE_POLICY,
    quantityPricingTiers: configuration.quantityPricingRanges.map((tier) => ({
      position: tier.position,
      minPurchaseUnit: tier.minPurchaseUnit,
      discountPercent: tier.fallbackDiscountPercentage,
    })),
    pricingTaxContext,
  };
}

async function loadDto(serviceClient: ReturnType<typeof createServiceClient>) {
  const [configuration, pricingTaxContext] = await Promise.all([
    loadCommercialPricingConfiguration(serviceClient),
    loadPricingTaxContext(serviceClient),
  ]);
  return toDto(configuration, pricingTaxContext);
}

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  try {
    const data = await loadDto(createServiceClient());
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { erro: error instanceof Error ? error.message : "Falha ao carregar configuração comercial" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const parsed = commercialConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: configurationValidationMessage(parsed.error, "Configuração comercial inválida") },
      { status: 422 },
    );
  }

  const serviceClient = createServiceClient();
  try {
    const previous = await loadDto(serviceClient);
    const mlFeeRate = parsed.data.mlFeeFallbackPercent / 100;
    const quantityTiers = [...parsed.data.quantityPricingTiers]
      .sort((left, right) => left.position - right.position)
      .map((tier) => ({
        position: tier.position,
        minPurchaseUnit: tier.minPurchaseUnit,
        discountPercentage: tier.discountPercent,
      }));

    const { error } = await serviceClient.rpc(
      "save_commercial_pricing_configuration",
      {
        p_ml_fee_fallback_rate: mlFeeRate,
        p_unspecified_shipping_cost: parsed.data.unspecifiedShippingCost,
        p_inactive_cost_threshold: parsed.data.inactiveCostThreshold,
        p_quantity_tiers: quantityTiers,
      },
    );
    if (error) throw new Error(error.message);

    const saved = await loadDto(serviceClient);
    try {
      await recordConfigurationAudit(
        serviceClient,
        { id: admin.user.id, name: admin.nome },
        [
          { key: "configuracoes.pricing_ml_fee_fallback_rate", targetId: CONFIG_ROW_ID, before: previous.mlFeeFallbackPercent, after: saved.mlFeeFallbackPercent },
          { key: "configuracoes.pricing_unspecified_shipping_cost", targetId: CONFIG_ROW_ID, before: previous.unspecifiedShippingCost, after: saved.unspecifiedShippingCost },
          { key: "configuracoes.product_inactive_cost_threshold", targetId: CONFIG_ROW_ID, before: previous.inactiveCostThreshold, after: saved.inactiveCostThreshold },
          { key: "ml_quantity_pricing_tiers.policy", before: previous.quantityPricingTiers, after: saved.quantityPricingTiers },
        ],
      );
    } catch {
      return NextResponse.json(
        { erro: "Configuração salva, mas o histórico administrativo não pôde ser registrado", persisted: true },
        { status: 500 },
      );
    }

    return NextResponse.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { erro: error instanceof Error ? error.message : "Falha ao salvar configuração comercial" },
      { status: 500 },
    );
  }
}
