import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { BNT_D05_INVENTORY_FIXTURE_SOURCE } from '@/lib/homologation-fixture';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'fiscal.read');
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') || '').trim().toLocaleLowerCase('pt-BR');
  const fiscalStatus = url.searchParams.get('fiscalStatus') || '';
  const receiptStatus = url.searchParams.get('receiptStatus') || '';
  const manifestationType = Number(url.searchParams.get('manifestationType') || 0);

  const db = createServiceClient();
  const { data: receipts, error } = await (db as any)
    .from('estoque_recebimentos_nfe')
    .select('id,chave_nfe,tipo_ambiente,numero,serie,emitente_cnpj,emitente_nome,emitente_ie,destinatario_cnpj,emitida_em,recebida_em,valor_total,valor_icms,modelo_documento,provider_status,numero_protocolo,cfops,origem_xml,status,manifestacao_status,manifestacao_protocolo,manifestada_em,snapshot_source,created_at,updated_at,confirmado_em,estoque_recebimento_itens(id,numero_item,produto_id,codigo_fornecedor,gtin,descricao,quantidade_esperada,quantidade_liberada,quantidade_nao_aproveitavel,produtos(id,sku,nome))')
    .eq('modelo_documento', 55)
    .order('emitida_em', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (receipts || []).map((receipt: any) => receipt.id);
  const { data: manifestations, error: manifestationError } = ids.length
    ? await (db as any).from('estoque_manifestacoes_nfe')
        .select('id,recebimento_id,tipo_manifestacao,status,protocolo,motivo,justificativa,numero_sequencial,codigo_sefaz,provider_evento,requested_at,completed_at')
        .in('recebimento_id', ids)
        .order('requested_at', { ascending: false })
    : { data: [], error: null };
  if (manifestationError) return NextResponse.json({ error: manifestationError.message }, { status: 500 });

  const historyByReceipt = new Map<string, any[]>();
  for (const manifestation of manifestations || []) {
    const key = String(manifestation.recebimento_id);
    historyByReceipt.set(key, [...(historyByReceipt.get(key) || []), manifestation]);
  }
  const all = (receipts || []).map((receipt: any) => {
    const items = receipt.estoque_recebimento_itens || [];
    const expected = items.reduce((total: number, item: any) => total + Number(item.quantidade_esperada || 0), 0);
    const checked = items.reduce((total: number, item: any) => total + Number(item.quantidade_liberada || 0) + Number(item.quantidade_nao_aproveitavel || 0), 0);
    return {
      ...receipt,
      itens: items,
      estoque_recebimento_itens: undefined,
      itens_esperados: expected,
      itens_conferidos: checked,
      manifestacoes: historyByReceipt.get(String(receipt.id)) || [],
      is_homologation_fixture: receipt.snapshot_source === BNT_D05_INVENTORY_FIXTURE_SOURCE,
    };
  });
  const filtered = all.filter((receipt: any) => {
    const haystack = `${receipt.chave_nfe} ${receipt.numero || ''} ${receipt.emitente_nome} ${receipt.emitente_cnpj}`.toLocaleLowerCase('pt-BR');
    const latestType = Number(receipt.manifestacoes?.[0]?.tipo_manifestacao || 0);
    return (!search || haystack.includes(search))
      && (!fiscalStatus || String(receipt.provider_status || '') === fiscalStatus)
      && (!receiptStatus || receipt.status === receiptStatus)
      && (!manifestationType || latestType === manifestationType);
  });
  const summary = {
    detectadas: all.length,
    valorTotal: all.reduce((total: number, receipt: any) => total + Number(receipt.valor_total || 0), 0),
    aguardandoRecebimento: all.filter((receipt: any) => receipt.status === 'identificada').length,
    emConferencia: all.filter((receipt: any) => ['aguardando_conferencia', 'parcial'].includes(receipt.status)).length,
    conferidas: all.filter((receipt: any) => receipt.status === 'conferido').length,
    alertas: all.filter((receipt: any) => [2, 3].includes(Number(receipt.provider_status))).length,
  };
  return NextResponse.json({ data: filtered, total: filtered.length, summary }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
