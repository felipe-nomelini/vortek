import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  configurationValidationMessage,
  preferencesConfigurationSchema,
} from "@/lib/configuracoes/contracts";
import { recordConfigurationAudit } from "@/services/configuration-audit";

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
  return NextResponse.json(data || null, {
    headers: { "Cache-Control": "no-store" },
  });
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
    .select("id,margem_lucro,notificacoes_push")
    .eq("id", CONFIG_ROW_ID)
    .maybeSingle();
  if (previousError) {
    return NextResponse.json({ erro: previousError.message }, { status: 500 });
  }

  const payload = {
    id: CONFIG_ROW_ID,
    margem_lucro: parsed.data.margem_lucro,
    notificacoes_push: parsed.data.notificacoes_push,
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
      ],
    );
  } catch {
    return NextResponse.json(
      { erro: "Preferências salvas, mas o histórico administrativo não pôde ser registrado", persisted: true },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
