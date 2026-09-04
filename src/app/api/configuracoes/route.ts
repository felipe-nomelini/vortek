import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  configurationValidationMessage,
  preferencesConfigurationSchema,
} from "@/lib/configuracoes/contracts";
import { recordConfigurationAudit } from "@/services/configuration-audit";
import { loadPricingTaxContext } from "@/services/pricing-tax-context";

const CONFIG_ROW_ID = "00000000-0000-0000-0000-000000000001";

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("configuracoes")
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116")
    return NextResponse.json({ erro: error.message }, { status: 500 });
  try {
    const pricingTaxContext = await loadPricingTaxContext(serviceClient);
    return NextResponse.json({ ...(data || {}), pricing_tax_context: pricingTaxContext });
  } catch (contextError: any) {
    return NextResponse.json(
      { erro: contextError?.message || "Falha ao calcular contexto tributário" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const parsed = preferencesConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: configurationValidationMessage(parsed.error, "Preferências inválidas") },
      { status: 422 },
    );
  }

  const { data: previous, error: previousError } = await serviceClient
    .from("configuracoes")
    .select(
      "id,margem_lucro,notificacoes_push,nfe_provider_default,simples_aliquota_confirmada,simples_aliquota_confirmada_em",
    )
    .eq("id", CONFIG_ROW_ID)
    .maybeSingle();
  if (previousError) {
    return NextResponse.json({ erro: previousError.message }, { status: 500 });
  }

  const confirmedPercent = parsed.data.simples_aliquota_confirmada_percentual;
  const confirmedDate = parsed.data.simples_aliquota_confirmada_em || null;
  const payload = {
    id: CONFIG_ROW_ID,
    margem_lucro: parsed.data.margem_lucro,
    notificacoes_push: parsed.data.notificacoes_push,
    nfe_provider_default: parsed.data.nfe_provider_default,
    simples_inicio_atividade: "2026-03-23",
    simples_aliquota_confirmada: confirmedPercent === null ? null : confirmedPercent / 100,
    simples_aliquota_confirmada_em: confirmedDate,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await serviceClient
    .from("configuracoes")
    .upsert(payload)
    .select()
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      [
        { key: "configuracoes.margem_lucro", targetId: data.id, before: previous?.margem_lucro, after: data.margem_lucro },
        { key: "configuracoes.notificacoes_push", targetId: data.id, before: previous?.notificacoes_push, after: data.notificacoes_push },
        { key: "configuracoes.nfe_provider_default", targetId: data.id, before: previous?.nfe_provider_default, after: data.nfe_provider_default },
        { key: "configuracoes.simples_aliquota_confirmada", targetId: data.id, before: previous?.simples_aliquota_confirmada, after: data.simples_aliquota_confirmada },
        { key: "configuracoes.simples_aliquota_confirmada_em", targetId: data.id, before: previous?.simples_aliquota_confirmada_em, after: data.simples_aliquota_confirmada_em },
      ],
    );
  } catch {
    return NextResponse.json(
      { erro: "Preferências salvas, mas o histórico administrativo não pôde ser registrado", persisted: true },
      { status: 500 },
    );
  }
  const pricingTaxContext = await loadPricingTaxContext(serviceClient);
  return NextResponse.json({ ...data, pricing_tax_context: pricingTaxContext });
}
