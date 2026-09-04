import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  configurationValidationMessage,
  integrationConfigurationSchema,
  type ConfigurationKey,
} from "@/lib/configuracoes/contracts";
import { toIntegrationConfigDto } from "@/lib/integration-config-dto";
import { recordConfigurationAudit } from "@/services/configuration-audit";

const SELECTED_FIELDS =
  "tipo,client_id,client_secret,redirect_uri,url,access_token,refresh_token,conectado,last_refresh_error,last_refresh_error_code,token_expires_at,updated_at" as const;

const AUDIT_KEYS = {
  client_id: "integracoes.client_id",
  client_secret: "integracoes.client_secret",
  url: "integracoes.url",
  access_token: "integracoes.access_token",
  refresh_token: "integracoes.refresh_token",
  conectado: "integracoes.conectado",
} as const satisfies Record<string, ConfigurationKey>;

const SECRET_FIELDS = new Set(["client_secret", "access_token", "refresh_token"]);

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("integracoes")
    .select(SELECTED_FIELDS)
    .neq("tipo", "mercadolivre")
    .order("tipo");

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({
    integracoes: (data || []).map((row) =>
      toIntegrationConfigDto(row as Record<string, unknown>),
    ),
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const parsed = integrationConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: configurationValidationMessage(parsed.error, "Configuração da integração inválida") },
      { status: 422 },
    );
  }
  const { tipo, values: payload } = parsed.data;

  const serviceClient = createServiceClient();
  const { data: previous, error: previousError } = await serviceClient
    .from("integracoes")
    .select(SELECTED_FIELDS)
    .eq("tipo", tipo)
    .single();
  if (previousError) {
    return NextResponse.json({ erro: previousError.message }, { status: 500 });
  }

  const { data, error } = await serviceClient
    .from("integracoes")
    .update(payload)
    .eq("tipo", tipo)
    .select(SELECTED_FIELDS)
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      Object.entries(payload).map(([field, value]) => ({
        key: AUDIT_KEYS[field as keyof typeof AUDIT_KEYS],
        targetId: tipo,
        before: previous[field as keyof typeof previous],
        after: value,
        action: field === "conectado"
          ? (value ? "enabled" : "disabled")
          : undefined,
        force: SECRET_FIELDS.has(field),
      })),
    );
  } catch {
    return NextResponse.json(
      { erro: "Integração salva, mas o histórico administrativo não pôde ser registrado", persisted: true },
      { status: 500 },
    );
  }
  return NextResponse.json({
    integracao: toIntegrationConfigDto(data as Record<string, unknown>),
  });
}
