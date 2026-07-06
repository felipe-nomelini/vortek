import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { saoPauloDateParamToUtcIso } from '@/lib/timezone';
import { normalizeNfeTechnicalStatus, type NfeTechnicalStatus } from '@/lib/fiscal/nfe-status';
import { reconcileLocalNfeSnapshotFromXml } from '@/lib/fiscal/nfe-local-reconciliation';

type NFStatus = NfeTechnicalStatus;

function normalizeSearch(value: string): string {
  return value.replace(/[,]/g, ' ').trim();
}

function mapStatus(row: { nfe_status: string | null }): NFStatus {
  return normalizeNfeTechnicalStatus(row.nfe_status);
}

async function reconcileRowsBestEffort(supabase: any, rows: any[]): Promise<any[]> {
  return Promise.all((rows || []).map(async (row) => {
    const reconciliation = reconcileLocalNfeSnapshotFromXml({
      nfe_status: row?.nfe_status || null,
      nfe_xml: row?.nfe_xml || null,
      nfe_chave: row?.nfe_chave || null,
      nota_fiscal_numero: row?.nota_fiscal_numero || null,
      nfe_protocolo: row?.nfe_protocolo || null,
      nfe_cfop: row?.nfe_cfop || null,
    });

    if (!reconciliation.shouldUpdate || !row?.id) {
      return row;
    }

    await supabase
      .from('pedidos')
      .update({
        ...reconciliation.updates,
        nfe_last_sync_at: new Date().toISOString(),
      } as any)
      .eq('id', row.id);

    return {
      ...row,
      ...reconciliation.updates,
    };
  }));
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }
  const serviceClient = createServiceClient();

  try {
    const { searchParams } = new URL(request.url);

    const search = normalizeSearch(searchParams.get('search') || '');
    const status = (searchParams.get('status') || '').trim() as NFStatus | '';
    const dateFrom = (searchParams.get('dateFrom') || '').trim();
    const dateTo = (searchParams.get('dateTo') || '').trim();
    const valorMin = searchParams.get('valorMin');
    const valorMax = searchParams.get('valorMax');

    let query = serviceClient
      .from('pedidos')
      .select('id, nota_fiscal_numero, nota_fiscal_emitida, nfe_status, nfe_chave, nfe_protocolo, nfe_cfop, nfe_xml, total, data, contato_nome, ml_order_id, ml_pack_id, numero');

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

    const startDateIso = dateFrom ? saoPauloDateParamToUtcIso(dateFrom, 'start') : null;
    const endDateIso = dateTo ? saoPauloDateParamToUtcIso(dateTo, 'end') : null;

    if (startDateIso) {
      query = query.gte('data', startDateIso);
    }

    if (endDateIso) {
      query = query.lte('data', endDateIso);
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

    let rows = await reconcileRowsBestEffort(serviceClient, data || []);
    if (status) {
      rows = rows.filter((row) => mapStatus(row) === status);
    }
    let emitidas = 0;
    let pendentes = 0;
    let valorTotal = 0;

    for (const row of rows) {
      const mapped = mapStatus(row);
      if (mapped === 'autorizada') emitidas++;
      if (mapped === 'pendente' || mapped === 'processando') pendentes++;
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
