import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PENDING_STATUSES = new Set([
  'Aguardando Informações',
  'Iniciado',
  'Aguardando Etiqueta',
  'Solicitado',
  'Confirmado',
]);

function normalizeStatus(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';

    const client = createServiceClient();
    let query = client
      .from('compras')
      .select('status, valor_total, valor_frete');

    if (status) query = query.eq('status', status);
    if (search) query = query.or(`destinatario_nome.ilike.%${search}%,produto_descricao.ilike.%${search}%,dsid.ilike.%${search}%`);
    if (dateFrom) query = query.gte('data_criacao', dateFrom);
    if (dateTo) query = query.lte('data_criacao', `${dateTo}T23:59:59`);

    const { data, error } = await query;

    if (error) {
      console.error('[api/compras/resumo] Erro:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data || [];
    let pendentes = 0;
    let faturado = 0;
    let aguardandoInformacoes = 0;
    let cancelado = 0;
    let revisao = 0;
    let valorTotal = 0;

    for (const row of rows) {
      const rowStatus = String(row.status || '');
      const normalizedStatus = normalizeStatus(rowStatus);
      if (PENDING_STATUSES.has(rowStatus)) pendentes++;
      if (rowStatus === 'Faturado') faturado++;
      if (rowStatus === 'Aguardando Informações') aguardandoInformacoes++;
      if (rowStatus === 'Cancelado') cancelado++;
      if (normalizedStatus === 'revisao') revisao++;
      valorTotal += Number(row.valor_total || 0);
    }

    return NextResponse.json({
      total: rows.length,
      pendentes,
      faturado,
      aguardando_informacoes: aguardandoInformacoes,
      cancelado,
      revisao,
      valor_total: valorTotal,
    });
  } catch (err: any) {
    console.error('[api/compras/resumo] Erro geral:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
