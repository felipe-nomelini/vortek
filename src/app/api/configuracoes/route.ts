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
  return NextResponse.json(data || {});
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const body = await request.json().catch(() => ({}));

  const payload = {
    id: CONFIG_ROW_ID,
    margem_lucro: Number(body?.margem_lucro ?? 30),
    notificacoes_email: Boolean(body?.notificacoes_email),
    notificacoes_push: Boolean(body?.notificacoes_push),
    nfe_provider_default:
      String(body?.nfe_provider_default || "brasilnfe")
        .trim()
        .toLowerCase() || "brasilnfe",
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
