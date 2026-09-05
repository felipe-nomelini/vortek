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
import { integrationSummaries, integrationUrlAllowed, resolveIntegrationConfiguration } from "@/lib/integration-configuration";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

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
    .order("tipo");

  if (error) return json({ erro: "Falha ao carregar integrações" }, 500);
  const rows = data || [];
  return json({
    integracoes: rows.filter((row) => row.tipo !== "mercadolivre").map((row) =>
      toIntegrationConfigDto(row as Record<string, unknown>, process.env),
    ),
    resumo: integrationSummaries(rows, process.env),
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
  if ("url" in payload && payload.url && !integrationUrlAllowed(tipo, payload.url)) {
    return json({ erro: "URL não permitida. Utilize o endereço oficial da integração, sem credenciais ou parâmetros." }, 422);
  }
  if (tipo === "mercadopago" && resolveIntegrationConfiguration(tipo, {}, process.env).token.origin === "runtime") {
    return json({ erro: "A credencial do servidor prevalece. Altere-a no runtime." }, 409);
  }

  const serviceClient = createServiceClient();
  const { data: previous, error: previousError } = await serviceClient
    .from("integracoes")
    .select(SELECTED_FIELDS)
    .eq("tipo", tipo)
    .maybeSingle();
  if (previousError) {
    return json({ erro: "Falha ao carregar a configuração atual" }, 500);
  }

  const updates = { ...payload, conectado: false, updated_at: new Date().toISOString() };
  const write = previous
    ? serviceClient.from("integracoes").update(updates).eq("tipo", tipo).eq("updated_at", previous.updated_at)
    : serviceClient.from("integracoes").insert({ tipo, ...updates });
  const { data, error } = await write.select(SELECTED_FIELDS).maybeSingle();

  if (error) return json({ erro: "Não foi possível salvar a integração. Atualize os dados antes de tentar novamente." }, 500);
  if (!data) return json({ erro: "A configuração mudou durante a edição. Atualize antes de salvar." }, 409);
  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      Object.entries(payload).map(([field, value]) => ({
        key: AUDIT_KEYS[field as keyof typeof AUDIT_KEYS],
        targetId: tipo,
        before: field === "url" && previous?.url && !integrationUrlAllowed(tipo, previous.url)
          ? "URL anterior fora dos destinos permitidos" : previous?.[field as keyof NonNullable<typeof previous>] ?? null,
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
  return json({
    integracao: toIntegrationConfigDto(data as Record<string, unknown>, process.env),
  });
}
