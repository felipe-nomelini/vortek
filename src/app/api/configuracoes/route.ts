import { PRICING_POLICY, validatePricingPolicy } from '@/services/pricing-policy';
import { pricingFingerprint } from '@/services/pricing-context';
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";

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
  return NextResponse.json({ ...(data || {}), pricing_policy: (data as any)?.pricing_policy ?? PRICING_POLICY });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const body = await request.json().catch(() => ({}));

  if (body?.pricing_policy) {
    try {
      const requested = validatePricingPolicy(body.pricing_policy);
      const { version: ignoredVersion, ...content } = requested;
      const policy = { ...content, version: `M2M-${pricingFingerprint({ policy:content, tax:body.pricing_tax_config ?? {} }).slice(0,16)}` };
      const tax = body.pricing_tax_config ?? {};
      if (tax.activityStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(tax.activityStartDate)) throw new Error('Data de início inválida');
      if (tax.confirmed && (!/^\d{4}-\d{2}$/.test(tax.confirmed.month) || !Number.isFinite(tax.confirmed.rate) || tax.confirmed.rate < 0 || tax.confirmed.rate >= 1 || !String(tax.confirmed.evidence || '').trim())) throw new Error('Confirmação fiscal exige competência, alíquota e evidência');
      if (Object.values(tax.variableCosts ?? {}).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Custos variáveis inválidos');
      if (!body.reason?.trim()) throw new Error('Informe a razão da alteração');
      const result = await (serviceClient as any).rpc('update_canonical_pricing_config', { p_policy:policy,p_tax:tax,p_expected_version:body.expectedVersion,p_actor:admin.user.id,p_reason:body.reason.trim() });
      if (result.error) return NextResponse.json({ erro:result.error.message }, { status:409 });
      return NextResponse.json(result.data);
    } catch (error: any) { return NextResponse.json({ erro:error.message }, { status:422 }); }
  }

  const payload = {
    id: CONFIG_ROW_ID,
    notificacoes_push: Boolean(body?.notificacoes_push),
    nfe_provider_default:
      String(body?.nfe_provider_default || "brasilnfe")
        .trim()
        .toLowerCase() || "brasilnfe",
    updated_at: new Date().toISOString(),
  };


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
  return NextResponse.json(data);
}
