import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('empresa')
    .select('id,nome,nickname,cnpj,endereco,email,telefone,uf_fiscal,cod_municipio_fiscal')
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

  const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : null;
  const nome = String(body?.nome || '').trim();
  const nickname = String(body?.nickname || '').trim();
  const cnpj = String(body?.cnpj || '').trim();
  const endereco = String(body?.endereco || '').trim();
  const email = String(body?.email || '').trim();
  const telefone = String(body?.telefone || '').trim();
  const ufFiscal = String(body?.uf_fiscal || '').trim().toUpperCase();
  const codMunicipioFiscalRaw = String(body?.cod_municipio_fiscal || '').replace(/\D/g, '');
  const codMunicipioFiscal = codMunicipioFiscalRaw || null;

  if (!/^[A-Z]{2}$/.test(ufFiscal)) {
    return NextResponse.json({ erro: 'UF Fiscal inválida. Use 2 letras (ex.: RS).' }, { status: 422 });
  }

  if (codMunicipioFiscal && !/^\d{7}$/.test(codMunicipioFiscal)) {
    return NextResponse.json({ erro: 'Código Município (IBGE) inválido. Use 7 dígitos.' }, { status: 422 });
  }

  const payload = {
    nome,
    nickname,
    cnpj,
    endereco,
    email,
    telefone,
    uf_fiscal: ufFiscal,
    cod_municipio_fiscal: codMunicipioFiscal,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { data, error } = await serviceClient
      .from('empresa')
      .update(payload)
      .eq('id', id)
      .select('id,nome,nickname,cnpj,endereco,email,telefone,uf_fiscal,cod_municipio_fiscal')
      .single();

    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await serviceClient
    .from('empresa')
    .insert(payload)
    .select('id,nome,nickname,cnpj,endereco,email,telefone,uf_fiscal,cod_municipio_fiscal')
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
