import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

const allowedSortColumns = new Set([
  'dslite_id',
  'apelido',
  'status_dslite',
  'crossdocking',
  'dropshipping',
  'nome',
  'cnpj',
  'email',
  'telefone',
  'dslite_ultima_sync',
  'created_at',
  'ativo',
]);

function normalizeSearch(value: string): string {
  return value.replace(/[,]/g, ' ').trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limitRaw = parseInt(searchParams.get('limit') || String(PAGE_SIZE_DEFAULT), 10);
    const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, limitRaw));
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    const search = normalizeSearch(searchParams.get('search') || '');
    const statusDslite = (searchParams.get('status_dslite') || '').trim();
    const crossdocking = (searchParams.get('crossdocking') || '').trim();
    const dropshipping = (searchParams.get('dropshipping') || '').trim();

    const sortByParam = (searchParams.get('sortBy') || 'dslite_id').trim();
    const sortBy = allowedSortColumns.has(sortByParam) ? sortByParam : 'dslite_id';
    const sortOrder = (searchParams.get('sortOrder') || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

    const serviceClient = createServiceClient();

    let countQuery = serviceClient
      .from('fornecedores')
      .select('id', { count: 'exact', head: true });

    let dataQuery = serviceClient
      .from('fornecedores')
      .select('*')
      .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
      .range(start, end);

    if (search) {
      const filter = `dslite_id.ilike.%${search}%,apelido.ilike.%${search}%,nome.ilike.%${search}%,cnpj.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%`;
      countQuery = countQuery.or(filter);
      dataQuery = dataQuery.or(filter);
    }

    if (statusDslite) {
      countQuery = countQuery.eq('status_dslite', statusDslite);
      dataQuery = dataQuery.eq('status_dslite', statusDslite);
    }

    if (crossdocking) {
      countQuery = countQuery.eq('crossdocking', crossdocking);
      dataQuery = dataQuery.eq('crossdocking', crossdocking);
    }

    if (dropshipping) {
      countQuery = countQuery.eq('dropshipping', dropshipping);
      dataQuery = dataQuery.eq('dropshipping', dropshipping);
    }

    const [{ count, error: countError }, { data, error: dataError }] = await Promise.all([
      countQuery,
      dataQuery,
    ]);

    if (countError || dataError) {
      return NextResponse.json(
        { error: countError?.message || dataError?.message || 'Erro ao buscar fornecedores' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: data || [],
      total: count || 0,
      page,
      limit,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro inesperado' }, { status: 500 });
  }
}
