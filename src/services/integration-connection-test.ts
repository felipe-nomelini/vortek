import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
import { probeIntegration } from "@/lib/integration-configuration";
import { recordConfigurationAudit } from "@/services/configuration-audit";

export async function testSavedIntegration(tipo: "dslite" | "brasilnfe") {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const client = createServiceClient();
  const { data: previous, error } = await client.from("integracoes")
    .select("tipo,url,access_token,refresh_token,conectado,updated_at").eq("tipo", tipo).maybeSingle();
  if (error) return json({ erro: "Falha ao carregar a configuração salva." }, 500);
  const result = await probeIntegration(tipo, previous || {}, process.env);
  // A diagnostic must not create a registration when only runtime credentials exist.
  if (!previous || ["missing", "blocked"].includes(result.code)) return json(result, result.ok ? 200 : 422);
  const { data: saved, error: writeError } = await client.from("integracoes")
    .update({ conectado: result.ok, updated_at: new Date().toISOString() })
    .eq("tipo", tipo).eq("updated_at", previous.updated_at).select("tipo").maybeSingle();
  if (writeError) return json({ erro: "Consulta realizada, mas seu resultado não pôde ser registrado." }, 500);
  if (!saved) return json({ erro: "A configuração mudou durante o teste. O resultado foi descartado." }, 409);
  try {
    await recordConfigurationAudit(client, { id: admin.user.id, name: admin.nome }, [{
      key: "integracoes.conectado", targetId: tipo, before: previous.conectado, after: result.ok,
    }]);
  } catch { return json({ erro: "Resultado registrado, mas a auditoria não pôde ser concluída.", persisted: true }, 500); }
  return json(result, result.ok ? 200 : 422);
}
