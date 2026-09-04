import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  configurationValidationMessage,
  fiscalConfigurationSchema,
} from "@/lib/configuracoes/contracts";
import { ALLOWED_CFOP_DSLITE } from "@/lib/fiscal/cfop";
import { createClient, createServiceClient } from "@/lib/supabase";
import { recordConfigurationAudit } from "@/services/configuration-audit";
import { loadPricingTaxContext } from "@/services/pricing-tax-context";

const CONFIG_ROW_ID = "00000000-0000-0000-0000-000000000001";
const FISCAL_FIELDS = [
  "id",
  "simples_inicio_atividade",
  "simples_aliquota_confirmada",
  "simples_aliquota_confirmada_em",
].join(",");

type FiscalRow = {
  id: string;
  simples_inicio_atividade: string;
  simples_aliquota_confirmada: number | null;
  simples_aliquota_confirmada_em: string | null;
};

function environmentStatus(value: string | undefined, expected: 1 | 2) {
  const code = Number(String(value || "").trim());
  if (code === 1) {
    return {
      code: 1 as const,
      label: "Produção fiscal",
      valid: code === expected,
    };
  }
  if (code === 2) {
    return {
      code: 2 as const,
      label: "Homologação fiscal",
      valid: code === expected,
    };
  }
  return { code: null, label: "Não configurado", valid: false };
}

function runtimeStatus() {
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "")
    .trim()
    .toLowerCase();
  const returnEnvironment = /^https:\/\/app\.bentevi\.shop(?:\/|$)/.test(appUrl)
    ? 1
    : 2;
  return {
    provider: "Brasil NFe",
    emission_environment: environmentStatus(
      process.env.BRASILNFE_TIPO_AMBIENTE,
      1,
    ),
    return_environment: environmentStatus(
      process.env.BRASILNFE_RETURN_TIPO_AMBIENTE,
      returnEnvironment,
    ),
    strict_validation:
      String(process.env.STRICT_NFE_VALIDATION || "true").toLowerCase() === "true",
    allowed_cfops: [...ALLOWED_CFOP_DSLITE],
  };
}

async function responseDto(
  serviceClient: ReturnType<typeof createServiceClient>,
  row: FiscalRow,
) {
  return {
    simples_inicio_atividade: row.simples_inicio_atividade,
    simples_aliquota_confirmada_percentual:
      row.simples_aliquota_confirmada === null
        ? null
        : Number(row.simples_aliquota_confirmada) * 100,
    simples_aliquota_confirmada_em: row.simples_aliquota_confirmada_em,
    pricing_tax_context: await loadPricingTaxContext(serviceClient),
    emissor: runtimeStatus(),
  };
}

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("configuracoes")
    .select(FISCAL_FIELDS)
    .eq("id", CONFIG_ROW_ID)
    .maybeSingle();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { erro: "Configuração fiscal não inicializada" },
      { status: 409 },
    );
  }

  return NextResponse.json(
    await responseDto(serviceClient, data as unknown as FiscalRow),
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const parsed = fiscalConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        erro: configurationValidationMessage(
          parsed.error,
          "Configuração fiscal inválida",
        ),
      },
      { status: 422 },
    );
  }

  const serviceClient = createServiceClient();
  const { data: previousData, error: previousError } = await serviceClient
    .from("configuracoes")
    .select(FISCAL_FIELDS)
    .eq("id", CONFIG_ROW_ID)
    .maybeSingle();
  if (previousError) {
    return NextResponse.json({ erro: previousError.message }, { status: 500 });
  }
  const previous = (previousData as FiscalRow | null) || null;
  const confirmedPercent = parsed.data.simples_aliquota_confirmada_percentual;
  const payload = {
    id: CONFIG_ROW_ID,
    nfe_provider_default: "brasilnfe",
    simples_inicio_atividade: parsed.data.simples_inicio_atividade,
    simples_aliquota_confirmada:
      confirmedPercent === null ? null : confirmedPercent / 100,
    simples_aliquota_confirmada_em:
      parsed.data.simples_aliquota_confirmada_em || null,
    updated_at: new Date().toISOString(),
  };
  const { data: savedData, error } = await serviceClient
    .from("configuracoes")
    .upsert(payload)
    .select(FISCAL_FIELDS)
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const saved = savedData as unknown as FiscalRow;

  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      [
        {
          key: "configuracoes.simples_inicio_atividade",
          targetId: saved.id,
          before: previous?.simples_inicio_atividade,
          after: saved.simples_inicio_atividade,
        },
        {
          key: "configuracoes.simples_aliquota_confirmada",
          targetId: saved.id,
          before: previous?.simples_aliquota_confirmada,
          after: saved.simples_aliquota_confirmada,
        },
        {
          key: "configuracoes.simples_aliquota_confirmada_em",
          targetId: saved.id,
          before: previous?.simples_aliquota_confirmada_em,
          after: saved.simples_aliquota_confirmada_em,
        },
      ],
    );
  } catch {
    return NextResponse.json(
      {
        erro: "Tributação salva, mas o histórico administrativo não pôde ser registrado",
        persisted: true,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(await responseDto(serviceClient, saved));
}
