import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import {
  companyConfigurationSchema,
  configurationValidationMessage,
} from '@/lib/configuracoes/contracts';
import { recordConfigurationAudit } from '@/services/configuration-audit';

const COMPANY_FIELDS =
  'id,nome,nickname,cnpj,endereco,email,telefone,uf_fiscal,cod_municipio_fiscal' as const;

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('empresa')
    .select(COMPANY_FIELDS)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data || null);
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
      { erro: configurationValidationMessage(parsed.error, 'Dados da empresa inválidos') },
      { status: 422 },
    );
  }

  const { id = null, ...values } = parsed.data;
  const { data: previous, error: previousError } = id
    ? await serviceClient.from('empresa').select(COMPANY_FIELDS).eq('id', id).maybeSingle()
    : { data: null, error: null };
  if (previousError) return NextResponse.json({ erro: previousError.message }, { status: 500 });

  const payload = {
    ...values,
    uf_fiscal: values.uf_fiscal.toUpperCase(),
    cod_municipio_fiscal: values.cod_municipio_fiscal || null,
    updated_at: new Date().toISOString(),
  };

  let saved;
  if (id) {
    const { data, error } = await serviceClient
      .from('empresa')
      .update(payload)
      .eq('id', id)
      .select(COMPANY_FIELDS)
      .single();

    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    saved = data;
  } else {
    const { data, error } = await serviceClient
      .from('empresa')
      .insert(payload)
      .select(COMPANY_FIELDS)
      .single();

    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    saved = data;
  }

  try {
    await recordConfigurationAudit(
      serviceClient,
      { id: admin.user.id, name: admin.nome },
      [
        { key: 'empresa.nome', targetId: saved.id, before: previous?.nome, after: saved.nome },
        { key: 'empresa.nickname', targetId: saved.id, before: previous?.nickname, after: saved.nickname },
        { key: 'empresa.cnpj', targetId: saved.id, before: previous?.cnpj, after: saved.cnpj },
        { key: 'empresa.endereco', targetId: saved.id, before: previous?.endereco, after: saved.endereco },
        { key: 'empresa.email', targetId: saved.id, before: previous?.email, after: saved.email },
        { key: 'empresa.telefone', targetId: saved.id, before: previous?.telefone, after: saved.telefone },
        { key: 'empresa.uf_fiscal', targetId: saved.id, before: previous?.uf_fiscal, after: saved.uf_fiscal },
        { key: 'empresa.cod_municipio_fiscal', targetId: saved.id, before: previous?.cod_municipio_fiscal, after: saved.cod_municipio_fiscal },
      ],
    );
  } catch {
    return NextResponse.json(
      { erro: 'Empresa salva, mas o histórico administrativo não pôde ser registrado', persisted: true },
      { status: 500 },
    );
  }
  return NextResponse.json(saved);
}
