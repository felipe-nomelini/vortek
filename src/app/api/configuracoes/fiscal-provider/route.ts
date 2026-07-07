import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";

const CONFIG_ROW_ID = "00000000-0000-0000-0000-000000000001";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const serviceClient = createServiceClient();

  const body = await req.json().catch(() => ({}));
  const provider = String(body?.defaultProvider || "")
    .trim()
    .toLowerCase();
  if (provider !== "brasilnfe") {
    return NextResponse.json(
      { erro: "defaultProvider inválido. Use brasilnfe." },
      { status: 422 },
    );
  }

  const { data, error } = await serviceClient
    .from("configuracoes")
    .upsert({ id: CONFIG_ROW_ID, nfe_provider_default: provider } as any)
    .select("id, nfe_provider_default")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({
    success: true,
    defaultProvider: (data as any)?.nfe_provider_default || provider,
  });
}
