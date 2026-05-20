import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const tipo = searchParams.get('tipo') || '';

    const supabase = createServiceClient();

    let baseQuery = supabase.from('clientes').select('*');

    if (search) {
      const filter = `nome.ilike.%${search}%,documento.ilike.%${search}%,nickname.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%,endereco.ilike.%${search}%`;
      baseQuery = baseQuery.or(filter);
    }

    if (tipo) {
      baseQuery = baseQuery.eq('tipo_pessoa', tipo);
    }

    const { data, error } = await baseQuery;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const total = data?.length || 0;
    const pf = data?.filter(c => c.tipo_pessoa === 'F').length || 0;
    const pj = data?.filter(c => c.tipo_pessoa === 'J').length || 0;

    return NextResponse.json({
      total,
      pf,
      pj,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
