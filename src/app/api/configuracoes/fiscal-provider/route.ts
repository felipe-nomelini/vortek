import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  configurationValidationMessage,
  fiscalProviderConfigurationSchema,
} from "@/lib/configuracoes/contracts";
import { recordConfigurationAudit } from "@/services/configuration-audit";

const CONFIG_ROW_ID = "00000000-0000-0000-0000-000000000001";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const serviceClient = createServiceClient();

  const body = await req.json().catch(() => ({}));
  const parsed = fiscalProviderConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: configurationValidationMessage(parsed.error, "Provedor fiscal inválido") },
      { status: 422 },
    );
  }
  const provider = parsed.data.defaultProvider;

  const { data: previous, error: previousError } = await serviceClient
    .from("configuracoes")
    .select("nfe_provider_default")
    .eq("id", CONFIG_ROW_ID)
    .maybeSingle();
  if (previousError) {
    return NextResponse.json({ erro: previousError.message }, { status: 500 });
  }

  const { data, error } = await serviceClient
    .from("configuracoes")
    .upsert({ id: CONFIG_ROW_ID, nfe_provider_default: provider })
    .select("id, nfe_provider_default")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      [{
        key: "configuracoes.nfe_provider_default",
        targetId: data.id,
        before: previous?.nfe_provider_default,
        after: data.nfe_provider_default,
      }],
    );
  } catch {
    return NextResponse.json(
      { erro: "Provedor salvo, mas o histórico administrativo não pôde ser registrado", persisted: true },
      { status: 500 },
    );
  }
  return NextResponse.json({
    success: true,
    defaultProvider: data.nfe_provider_default || provider,
  });
}
