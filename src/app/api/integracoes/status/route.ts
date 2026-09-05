import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { integrationSummaries, INTEGRATION_STATE_LABELS } from "@/lib/integration-configuration";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient.from("integracoes")
    .select("tipo,url,client_id,client_secret,access_token,refresh_token,conectado,token_expires_at,last_refresh_error_code")
    .in("tipo", ["mercadolivre", "dslite", "brasilnfe", "mercadopago"]);
  if (error) return NextResponse.json({ erro: "Falha ao consultar integrações" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({
    integracoes: integrationSummaries(data || [], process.env).slice(0, 4).map((item) => ({
      label: item.name, status: INTEGRATION_STATE_LABELS[item.state], on: item.state === "validated",
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
