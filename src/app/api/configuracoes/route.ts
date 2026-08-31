import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
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

  const confirmedPercent = body?.simples_aliquota_confirmada_percentual === null
    || body?.simples_aliquota_confirmada_percentual === ""
    || body?.simples_aliquota_confirmada_percentual === undefined
    ? null
    : Number(body.simples_aliquota_confirmada_percentual);
  const confirmedDate = String(body?.simples_aliquota_confirmada_em || "").trim() || null;
  const payload = {
    id: CONFIG_ROW_ID,
    margem_lucro: Number(body?.margem_lucro ?? 30),
    notificacoes_push: Boolean(body?.notificacoes_push),
    nfe_provider_default:
      String(body?.nfe_provider_default || "brasilnfe")
        .trim()
        .toLowerCase() || "brasilnfe",
    simples_inicio_atividade: "2026-03-23",
    simples_aliquota_confirmada: confirmedPercent === null ? null : confirmedPercent / 100,
    simples_aliquota_confirmada_em: confirmedDate,
    updated_at: new Date().toISOString(),
  };

  if (
    !Number.isFinite(payload.margem_lucro) ||
    payload.margem_lucro < 0 ||
    payload.margem_lucro > 1000
  ) {
    return NextResponse.json(
      { erro: "Margem de lucro inválida" },
      { status: 422 },
    );
  }

  if (
    confirmedPercent !== null
    && (!Number.isFinite(confirmedPercent) || confirmedPercent < 4 || confirmedPercent >= 100)
  ) {
    return NextResponse.json(
      { erro: "Alíquota confirmada deve estar entre 4% e menos de 100%" },
      { status: 422 },
    );
  }
  if ((confirmedPercent === null) !== (confirmedDate === null)) {
    return NextResponse.json(
      { erro: "Informe ou remova juntos a alíquota confirmada e a data do PGDAS" },
      { status: 422 },
    );
  }

  if (payload.nfe_provider_default !== "brasilnfe") {
    return NextResponse.json(
      { erro: "nfe_provider_default inválido. Use brasilnfe." },
      { status: 422 },
    );
  }

  const { data, error } = await serviceClient
    .from("configuracoes")
    .upsert(payload as any)
    .select()
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const pricingTaxContext = await loadPricingTaxContext(serviceClient);
  return NextResponse.json({ ...data, pricing_tax_context: pricingTaxContext });
}
