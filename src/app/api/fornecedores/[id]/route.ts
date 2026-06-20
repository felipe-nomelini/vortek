import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

const editableFields = new Set([
  'ativo',
  'apelido',
  'nome',
  'cnpj',
  'email',
  'telefone',
  'supplier_pix_key',
  'endereco',
  'status_dslite',
  'crossdocking',
  'dropshipping',
]);

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function normalizePatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!editableFields.has(key)) continue;
    if (key === 'ativo') {
      patch[key] = Boolean(value);
      continue;
    }
    patch[key] = String(value ?? '').trim();
  }
  return patch;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const id = String(params.id || '').trim();
  if (!id) {
    return NextResponse.json({ error: 'ID do fornecedor é obrigatório' }, { status: 422 });
  }

  const client = createServiceClient();
  const { data, error } = await client
    .from('fornecedores')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const id = String(params.id || '').trim();
  if (!id) {
    return NextResponse.json({ error: 'ID do fornecedor é obrigatório' }, { status: 422 });
  }

  const body = await request.json().catch(() => ({}));
  const patch = normalizePatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo válido para atualizar' }, { status: 422 });
  }

  const client = createServiceClient();
  const { data, error } = await client
    .from('fornecedores')
    .update(patch as any)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data });
}
