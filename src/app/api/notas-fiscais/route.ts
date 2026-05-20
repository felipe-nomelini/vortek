import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

type NFStatus = 'emitida' | 'cancelada' | 'pendente';
type SortOrder = 'asc' | 'desc';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

const sortColumnMap: Record<string, string> = {
  pedido: 'numero',
  numero: 'nota_fiscal_numero',
  cliente: 'contato_nome',
  data: 'data',
  valor: 'total',
  status: 'nfe_status',
};

function normalizeSearch(value: string): string {
  return value.replace(/[,]/g, ' ').trim();
}

function isNfeCanceled(value: string | null | undefined): boolean {
  const v = String(value || '').toLowerCase();
  return v === 'cancelada' || v === 'cancelled' || v === 'canceled';
}

function mapStatus(row: { nota_fiscal_emitida: boolean; nota_fiscal_numero: string | null; nfe_status: string | null }): NFStatus {
  if (isNfeCanceled(row.nfe_status)) return 'cancelada';
  if (row.nota_fiscal_emitida || !!row.nota_fiscal_numero) return 'emitida';
  return 'pendente';
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSizeRaw = parseInt(searchParams.get('pageSize') || String(PAGE_SIZE_DEFAULT), 10);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, pageSizeRaw));

    const search = normalizeSearch(searchParams.get('search') || '');
    const status = (searchParams.get('status') || '').trim() as NFStatus | '';
    const dateFrom = (searchParams.get('dateFrom') || '').trim();
    const dateTo = (searchParams.get('dateTo') || '').trim();
    const valorMin = searchParams.get('valorMin');
    const valorMax = searchParams.get('valorMax');

    const sortByParam = (searchParams.get('sortBy') || 'data').trim();
    const sortBy = sortColumnMap[sortByParam] || 'data';
    const sortOrder: SortOrder = (searchParams.get('sortOrder') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let countQuery = supabase.from('pedidos').select('id', { count: 'exact', head: true });
    let dataQuery = supabase
      .from('pedidos')
      .select('id, numero, ml_order_id, contato_nome, data, nota_fiscal_numero, nota_fiscal_emitida, nfe_status, total')
      .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
      .range(from, to);

    if (search) {
      const filters = [
        `contato_nome.ilike.%${search}%`,
        `nota_fiscal_numero.ilike.%${search}%`,
        `ml_order_id.ilike.%${search}%`,
      ];

      if (/^\d+$/.test(search)) {
        filters.push(`numero.eq.${search}`);
      }

      const orFilter = filters.join(',');
      countQuery = countQuery.or(orFilter);
      dataQuery = dataQuery.or(orFilter);
    }

    if (status === 'cancelada') {
      countQuery = countQuery.or('nfe_status.eq.cancelada,nfe_status.eq.cancelled,nfe_status.eq.canceled');
      dataQuery = dataQuery.or('nfe_status.eq.cancelada,nfe_status.eq.cancelled,nfe_status.eq.canceled');
    } else if (status === 'emitida') {
      countQuery = countQuery.eq('nota_fiscal_emitida', true).not('nfe_status', 'in', '("cancelada","cancelled","canceled")');
      dataQuery = dataQuery.eq('nota_fiscal_emitida', true).not('nfe_status', 'in', '("cancelada","cancelled","canceled")');
    } else if (status === 'pendente') {
      countQuery = countQuery.eq('nota_fiscal_emitida', false);
      dataQuery = dataQuery.eq('nota_fiscal_emitida', false);
    }

    if (dateFrom) {
      countQuery = countQuery.gte('data', dateFrom);
      dataQuery = dataQuery.gte('data', dateFrom);
    }

    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      const endIso = end.toISOString();
      countQuery = countQuery.lte('data', endIso);
      dataQuery = dataQuery.lte('data', endIso);
    }

    if (valorMin) {
      const min = Number(valorMin);
      if (!Number.isNaN(min)) {
        countQuery = countQuery.gte('total', min);
        dataQuery = dataQuery.gte('total', min);
      }
    }

    if (valorMax) {
      const max = Number(valorMax);
      if (!Number.isNaN(max)) {
        countQuery = countQuery.lte('total', max);
        dataQuery = dataQuery.lte('total', max);
      }
    }

    const [{ count, error: countError }, { data, error: dataError }] = await Promise.all([countQuery, dataQuery]);

    if (countError || dataError) {
      return NextResponse.json(
        { erro: countError?.message || dataError?.message || 'Erro ao buscar notas fiscais' },
        { status: 500 },
      );
    }

    const rows = (data || []).map((row) => ({
      id: row.id,
      pedido: row.numero,
      cliente: row.contato_nome || '—',
      data: row.data,
      numero: row.nota_fiscal_numero || '—',
      valor: Number(row.total || 0),
      status: mapStatus(row),
      ml_order_id: row.ml_order_id,
    }));

    return NextResponse.json({
      data: rows,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    return NextResponse.json({ erro: error?.message || 'Erro inesperado' }, { status: 500 });
  }
}
