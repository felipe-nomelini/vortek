import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  companyConfigurationSchema,
  configurationValidationMessage,
} from "@/lib/configuracoes/contracts";
import { recordConfigurationAudit } from "@/services/configuration-audit";

const COMPANY_FIELDS = [
  "id",
  "nome",
  "cnpj",
  "endereco",
  "email",
  "telefone",
  "cep_fiscal",
  "logradouro_fiscal",
  "numero_fiscal",
  "complemento_fiscal",
  "bairro_fiscal",
  "municipio_fiscal",
  "uf_fiscal",
  "cod_municipio_fiscal",
].join(",");

type CompanyRow = {
  id: string;
  nome: string;
  cnpj: string;
  endereco: string;
  email: string;
  telefone: string;
  cep_fiscal: string | null;
  logradouro_fiscal: string | null;
  numero_fiscal: string | null;
  complemento_fiscal: string | null;
  bairro_fiscal: string | null;
  municipio_fiscal: string | null;
  uf_fiscal: string | null;
  cod_municipio_fiscal: string | null;
};

function addressSnapshot(row: CompanyRow | null | undefined) {
  return {
    cep: row?.cep_fiscal || "",
    logradouro: row?.logradouro_fiscal || "",
    numero: row?.numero_fiscal || "",
    complemento: row?.complemento_fiscal || "",
    bairro: row?.bairro_fiscal || "",
    municipio: row?.municipio_fiscal || "",
    uf: row?.uf_fiscal || "",
    codigo_ibge: row?.cod_municipio_fiscal || "",
  };
}

function toDto(row: CompanyRow | null) {
  if (!row) return null;
  const address = addressSnapshot(row);
  return {
    id: row.id,
    nome: row.nome,
    cnpj: row.cnpj,
    email: row.email,
    telefone: row.telefone,
    endereco_fiscal: address,
    endereco_legado: row.endereco || null,
    endereco_estruturado: [
      address.cep,
      address.logradouro,
      address.numero,
      address.bairro,
      address.municipio,
      address.uf,
      address.codigo_ibge,
    ].every(Boolean),
  };
}

function formatAddress(address: {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
}) {
  const firstLine = [address.logradouro, address.numero, address.complemento]
    .filter(Boolean)
    .join(", ");
  return `${firstLine} - ${address.bairro}, ${address.municipio} - ${address.uf}, CEP ${address.cep}`;
}

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("empresa")
    .select(COMPANY_FIELDS)
    .maybeSingle();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(toDto((data as CompanyRow | null) || null), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const parsed = companyConfigurationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        erro: configurationValidationMessage(
          parsed.error,
          "Dados da empresa inválidos",
        ),
      },
      { status: 422 },
    );
  }

  const { data: previousData, error: previousError } = await serviceClient
    .from("empresa")
    .select(COMPANY_FIELDS)
    .maybeSingle();
  if (previousError) {
    return NextResponse.json({ erro: previousError.message }, { status: 500 });
  }
  const previous = (previousData as CompanyRow | null) || null;
  const address = parsed.data.endereco_fiscal;
  const payload = {
    nome: parsed.data.nome,
    cnpj: parsed.data.cnpj,
    email: parsed.data.email,
    telefone: parsed.data.telefone,
    endereco: formatAddress(address),
    cep_fiscal: address.cep,
    logradouro_fiscal: address.logradouro,
    numero_fiscal: address.numero,
    complemento_fiscal: address.complemento || null,
    bairro_fiscal: address.bairro,
    municipio_fiscal: address.municipio,
    uf_fiscal: address.uf,
    cod_municipio_fiscal: address.codigo_ibge,
    updated_at: new Date().toISOString(),
  };

  const operation = previous
    ? serviceClient
        .from("empresa")
        .update(payload)
        .eq("id", previous.id)
    : serviceClient.from("empresa").insert(payload);
  const { data: savedData, error } = await operation
    .select(COMPANY_FIELDS)
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const saved = savedData as unknown as CompanyRow;

  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      [
        { key: "empresa.nome", targetId: saved.id, before: previous?.nome, after: saved.nome },
        { key: "empresa.cnpj", targetId: saved.id, before: previous?.cnpj, after: saved.cnpj },
        { key: "empresa.email", targetId: saved.id, before: previous?.email, after: saved.email },
        { key: "empresa.telefone", targetId: saved.id, before: previous?.telefone, after: saved.telefone },
        { key: "empresa.endereco_fiscal", targetId: saved.id, before: addressSnapshot(previous), after: addressSnapshot(saved) },
        { key: "empresa.uf_fiscal", targetId: saved.id, before: previous?.uf_fiscal, after: saved.uf_fiscal },
        { key: "empresa.cod_municipio_fiscal", targetId: saved.id, before: previous?.cod_municipio_fiscal, after: saved.cod_municipio_fiscal },
      ],
    );
  } catch {
    return NextResponse.json(
      {
        erro: "Empresa salva, mas o histórico administrativo não pôde ser registrado",
        persisted: true,
      },
      { status: 500 },
    );
  }
  return NextResponse.json(toDto(saved));
}
