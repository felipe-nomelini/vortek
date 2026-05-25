import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

type NFStatus = 'emitida' | 'cancelada' | 'pendente';

function normalizeSearch(value: string): string {
  return value.replace(/[,]/g, ' ').trim();
}

function isNfeCanceled(value: string | null | undefined): boolean {
  const v = String(value || '').toLowerCase();
  return v === 'cancelada' || v === 'cancelled' || v === 'canceled';
}

function mapStatus(row: { nota_fiscal_emitida: boolean; nota_fiscal_numero: string | null; nfe_status: string | null }): NFStatus {
  if (isNfeCanceled(row.nfe_status)) return 'cancelada';
  const nfe = String(row.nfe_status || '').toLowerCase();
  if (row.nota_fiscal_emitida && (nfe === 'authorized' || nfe === 'autorizada')) return 'emitida';
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

    const search = normalizeSearch(searchParams.get('search') || '');
    const status = (searchParams.get('status') || '').trim() as NFStatus | '';
    const dateFrom = (searchParams.get('dateFrom') || '').trim();
    const dateTo = (searchParams.get('dateTo') || '').trim();
    const valorMin = searchParams.get('valorMin');
    const valorMax = searchParams.get('valorMax');

    let query = supabase
      .from('pedidos')
      .select('nota_fiscal_numero, nota_fiscal_emitida, nfe_status, total, data, contato_nome, ml_order_id, ml_pack_id, numero');

    if (search) {
      const filters = [
        `contato_nome.ilike.%${search}%`,
        `nota_fiscal_numero.ilike.%${search}%`,
        `ml_order_id.ilike.%${search}%`,
        `ml_pack_id.ilike.%${search}%`,
      ];

      if (/^\d+$/.test(search)) {
        filters.push(`numero.eq.${search}`);
      }
      query = query.or(filters.join(','));
    }

    if (status === 'cancelada') {
      query = query.or('nfe_status.eq.cancelada,nfe_status.eq.cancelled,nfe_status.eq.canceled');
    } else if (status === 'emitida') {
      query = query.eq('nota_fiscal_emitida', true).or('nfe_status.eq.authorized,nfe_status.eq.autorizada');
    } else if (status === 'pendente') {
      query = query.eq('nota_fiscal_emitida', false);
    }

    if (dateFrom) {
      query = query.gte('data', dateFrom);
    }

    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      query = query.lte('data', end.toISOString());
    }

    if (valorMin) {
      const min = Number(valorMin);
      if (!Number.isNaN(min)) query = query.gte('total', min);
    }

    if (valorMax) {
      const max = Number(valorMax);
      if (!Number.isNaN(max)) query = query.lte('total', max);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }

    const rows = data || [];
    let emitidas = 0;
    let pendentes = 0;
    let valorTotal = 0;

    for (const row of rows) {
      const mapped = mapStatus(row);
      if (mapped === 'emitida') emitidas++;
      if (mapped === 'pendente') pendentes++;
      valorTotal += Number(row.total || 0);
    }

    return NextResponse.json({
      total: rows.length,
      emitidas,
      pendentes,
      valor_total: valorTotal,
      imposto_total: valorTotal * 0.04,
    });
  } catch (error: any) {
    return NextResponse.json({ erro: error?.message || 'Erro inesperado' }, { status: 500 });
  }
}
