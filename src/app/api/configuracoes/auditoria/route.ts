import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  configurationAuditQuerySchema,
  configurationValidationMessage,
} from "@/lib/configuracoes/contracts";
import { createClient, createServiceClient } from "@/lib/supabase";
import { toConfigurationAuditDto } from "@/services/configuration-audit";

const AUDIT_FIELDS =
  "id,dominio,chave,acao,alvo_id,autor_id,autor_nome,valor_anterior,valor_novo,created_at" as const;

export async function GET(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const parsed = configurationAuditQuerySchema.safeParse({
    dominio: url.searchParams.get("dominio") || undefined,
    acao: url.searchParams.get("acao") || undefined,
    page: url.searchParams.get("page") || undefined,
    pageSize: url.searchParams.get("pageSize") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { erro: configurationValidationMessage(parsed.error, "Filtros inválidos") },
      { status: 422 },
    );
  }

  const { dominio, acao, page, pageSize } = parsed.data;
  const serviceClient = createServiceClient();
  let query = serviceClient
    .from("configuracoes_auditoria")
    .select(AUDIT_FIELDS, { count: "exact" });
  if (dominio) query = query.eq("dominio", dominio);
  if (acao) query = query.eq("acao", acao);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(
    {
      items: (data || []).map(toConfigurationAuditDto),
      pagination: { page, pageSize, total: count || 0 },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
