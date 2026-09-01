import { createServiceClient } from '@/lib/supabase';
import {
  buildFiscalReturnPayload,
  parseOriginalNfeItems,
  resolveFiscalReturnEnvironment,
  resolveOriginalItemReference,
  type CreateFiscalReturnInput,
} from '@/lib/fiscal/nfe-return';
import { isHomologationFixtureSource } from '@/lib/homologation-fixture';
import { normalizeNfeTechnicalStatus } from '@/lib/fiscal/nfe-status';
import {
  getFiscalProvider,
  preVisualizarNotaBrasilNfe,
} from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

type ServiceClient = ReturnType<typeof createServiceClient>;

const ORIGIN_SELECT = [
  'id', 'numero', 'ml_order_id', 'ml_pack_id', 'contato_nome', 'contato_documento',
  'billing_nome', 'billing_documento', 'billing_ie', 'billing_endereco', 'snapshot_incompleto',
  'snapshot_source', 'nfe_status', 'nfe_chave', 'nfe_xml', 'nota_fiscal_numero', 'total',
].join(',');

function extractXmlTag(xml: string | null | undefined, tag: string): string | null {
  if (!xml) return null;
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() || null;
}

function publicReturnRow(row: any) {
  const items = Array.isArray(row.itens_snapshot) ? row.itens_snapshot : [];
  return {
    id: row.id,
    pedido_id: row.pedido_id,
    tipo_retorno: row.tipo_retorno,
    escopo: row.escopo,
    motivo: row.motivo,
    status: normalizeNfeTechnicalStatus(row.status),
    status_persistido: row.status,
    created_at: row.created_at,
    valor_total: Number(row.valor_total || 0),
    quantidade_itens: items.length,
    quantidade_total: items.reduce(
      (total: number, item: any) => total + Number(item.quantidade_retorno || 0),
      0,
    ),
    nfe_original_chave: row.nfe_original_chave,
    nfe_original_numero: row.nfe_original_numero,
    nfe_numero: row.nfe_numero,
    nfe_serie: row.nfe_serie,
    nfe_chave: row.nfe_chave,
    nfe_protocolo: row.nfe_protocolo,
    nfe_external_id: row.nfe_external_id,
    nfe_danfe_url: row.nfe_danfe_url,
    xml_available: Boolean(String(row.nfe_xml || '').trim()),
    erro: row.erro,
    itens: items,
    pedido: row.pedidos
      ? {
          numero: row.pedidos.numero,
          ml_order_id: row.pedidos.ml_order_id,
          ml_pack_id: row.pedidos.ml_pack_id,
          cliente: row.pedidos.contato_nome,
        }
      : null,
  };
}

export async function listFiscalReturns(params: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}) {
  const client = createServiceClient();
  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;
  let query = client
    .from('notas_fiscais_retorno')
    .select(
      '*,pedidos(numero,ml_order_id,ml_pack_id,contato_nome)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);
  if (params.status) query = query.eq('status', params.status);
  const search = String(params.search || '').replace(/[,]/g, ' ').trim();
  if (search) {
    query = query.or(
      `nfe_numero.ilike.%${search}%,nfe_original_numero.ilike.%${search}%,identificador_interno.ilike.%${search}%`,
    );
  }
  const { data, count, error } = await query;
  if (error) throw new Error(`Falha ao listar devoluções fiscais: ${error.message}`);
  return {
    data: (data || []).map(publicReturnRow),
    total: count || 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function loadFiscalReturnOrigin(pedidoId: string) {
  const client = createServiceClient();
  const [{ data: pedido, error: pedidoError }, { data: items, error: itemError }, { data: returns, error: returnError }] =
    await Promise.all([
      client.from('pedidos').select(ORIGIN_SELECT).eq('id', pedidoId).maybeSingle(),
      client.from('pedido_itens')
        .select('id,titulo,seller_sku,ml_item_id,quantidade,valor_unitario,valor_total_bruto,ncm,cest,gtin,origem_fiscal,csosn,cfop_sugerido,created_at')
        .eq('pedido_id', pedidoId)
        .order('created_at', { ascending: true }),
      client.from('notas_fiscais_retorno')
        .select('status,itens_snapshot')
        .eq('pedido_id', pedidoId)
        .in('status', ['pending', 'processing', 'authorized']),
    ]);
  if (pedidoError || itemError || returnError) {
    throw new Error(pedidoError?.message || itemError?.message || returnError?.message || 'Falha ao carregar a venda');
  }
  if (!pedido) throw new Error('Venda não encontrada');
  const pedidoRow = pedido as any;
  if (isHomologationFixtureSource((pedido as any).snapshot_source)) {
    throw new Error('Amostra de homologação é somente leitura');
  }
  if (normalizeNfeTechnicalStatus((pedido as any).nfe_status) !== 'autorizada') {
    throw new Error('Selecione uma venda com NF-e autorizada');
  }
  const xml = String((pedido as any).nfe_xml || '').trim();
  if (!xml || !/^\d{44}$/.test(String((pedido as any).nfe_chave || ''))) {
    throw new Error('A venda precisa possuir XML e chave da NF-e original');
  }
  const originalItems = parseOriginalNfeItems(xml);
  const reserved = new Map<string, number>();
  for (const row of returns || []) {
    for (const item of Array.isArray((row as any).itens_snapshot) ? (row as any).itens_snapshot : []) {
      const id = String(item.pedido_item_id || '');
      reserved.set(id, (reserved.get(id) || 0) + Number(item.quantidade_retorno || 0));
    }
  }
  const mappedItems = (items || []).map((item: any) => {
    const reference = resolveOriginalItemReference({
      originalItems,
      sellerSku: item.seller_sku,
      title: item.titulo,
    });
    const quantity = Number(item.quantidade || 0);
    const alreadyReserved = reserved.get(item.id) || 0;
    return {
      id: item.id,
      titulo: item.titulo,
      seller_sku: item.seller_sku,
      ml_item_id: item.ml_item_id,
      quantidade_vendida: quantity,
      quantidade_retornada: alreadyReserved,
      quantidade_disponivel: Math.max(0, quantity - alreadyReserved),
      valor_unitario: Number(item.valor_unitario || 0),
      nitem_original: reference?.nitem || null,
      cfop_original: reference?.cfop || item.cfop_sugerido || null,
      referencia_valida: Boolean(reference),
    };
  });
  if (mappedItems.some((item) => !item.referencia_valida)) {
    throw new Error('Não foi possível relacionar todos os itens ao XML original da NF-e');
  }
  return {
    pedido: {
      id: pedidoRow.id,
      numero: pedidoRow.numero,
      ml_order_id: pedidoRow.ml_order_id,
      ml_pack_id: pedidoRow.ml_pack_id,
      cliente: pedidoRow.contato_nome,
      nfe_numero: pedidoRow.nota_fiscal_numero,
      nfe_chave: pedidoRow.nfe_chave,
      total: Number(pedidoRow.total || 0),
    },
    itens: mappedItems,
  };
}

async function markReturn(
  client: ServiceClient,
  id: string,
  values: Record<string, unknown>,
) {
  const { data, error } = await client
    .from('notas_fiscais_retorno')
    .update(values as any)
    .eq('id', id)
    .select('*,pedidos(numero,ml_order_id,ml_pack_id,contato_nome)')
    .single();
  if (error) throw new Error(`Falha ao persistir retorno fiscal: ${error.message}`);
  return data;
}

export async function createAndIssueFiscalReturn(
  input: CreateFiscalReturnInput,
  userId: string,
) {
  const environment = resolveFiscalReturnEnvironment();
  if (!environment.ok) throw new Error(environment.error);
  const origin = await loadFiscalReturnOrigin(input.pedidoId);
  const selected = input.itens.map((selection) => {
    const item = origin.itens.find((candidate) => candidate.id === selection.pedidoItemId);
    if (!item || !item.nitem_original) throw new Error('Item fiscal não encontrado na venda selecionada');
    if (selection.quantidade > item.quantidade_disponivel) {
      throw new Error(`Quantidade de “${item.titulo}” excede o saldo disponível`);
    }
    return {
      pedido_item_id: selection.pedidoItemId,
      quantidade_retorno: selection.quantidade,
      nitem_original: item.nitem_original,
    };
  });
  const client = createServiceClient();
  const identifier = `BENTEVI-RET-${input.idempotencyKey}`;
  const { data: reserved, error: reserveError } = await client.rpc(
    'reserve_nota_fiscal_retorno',
    {
      p_pedido_id: input.pedidoId,
      p_tipo_retorno: input.tipoRetorno,
      p_motivo: input.motivo,
      p_itens: selected,
      p_identificador_interno: identifier,
      p_tipo_ambiente: environment.tipoAmbiente,
      p_created_by: userId,
    },
  );
  if (reserveError || !reserved) {
    throw new Error(reserveError?.message || 'Falha ao reservar os itens da devolução');
  }
  const returnRow = Array.isArray(reserved) ? reserved[0] : reserved;
  if (returnRow.status === 'authorized' || returnRow.status === 'processing') {
    return publicReturnRow(returnRow);
  }

  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    notaRetornoId: returnRow.id,
    evento: 'nota_fiscal_retorno_reservado',
    payloadEnviado: {
      tipo_retorno: input.tipoRetorno,
      escopo: returnRow.escopo,
      itens: selected.length,
      tipo_ambiente: environment.tipoAmbiente,
    },
    statusResultante: 'pending',
  });

  const { data: pedido, error: pedidoError } = await client
    .from('pedidos')
    .select(ORIGIN_SELECT)
    .eq('id', input.pedidoId)
    .single();
  if (pedidoError || !pedido) throw new Error('Venda original não encontrada após a reserva');
  const built = buildFiscalReturnPayload({ pedido, retorno: returnRow });
  if (!built.ok) {
    await markReturn(client, returnRow.id, { status: 'interrupted', erro: built.error });
    throw new Error(built.error);
  }

  const preview = await preVisualizarNotaBrasilNfe(built.payload);
  if (!preview.ok) {
    await markReturn(client, returnRow.id, { status: 'interrupted', erro: preview.error || 'Pré-visualização rejeitada' });
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      notaRetornoId: returnRow.id,
      evento: 'nota_fiscal_retorno_previsualizacao_failed',
      respostaMl: { error: preview.error || null },
      statusResultante: 'interrupted',
    });
    throw new Error(preview.error || 'Pré-visualização fiscal rejeitada');
  }
  await markReturn(client, returnRow.id, {
    status: 'processing',
    previsualizacao_validada_em: new Date().toISOString(),
    erro: null,
  });
  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    notaRetornoId: returnRow.id,
    evento: 'nota_fiscal_retorno_previsualizacao_success',
    statusResultante: 'processing',
  });
  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    notaRetornoId: returnRow.id,
    evento: 'nota_fiscal_retorno_envio_start',
    statusResultante: 'processing',
  });

  const emitted = await getFiscalProvider('brasilnfe').emitirNota({
    pedidoId: input.pedidoId,
    mlOrderId: origin.pedido.ml_order_id,
    nfePayload: built.payload,
  });
  if (!emitted.ok) {
    const failedStatus = emitted.temporary ? 'interrupted' : 'rejected';
    await markReturn(client, returnRow.id, {
      status: failedStatus,
      erro: emitted.error || 'Emissão rejeitada',
      nfe_external_id: emitted.externalId || null,
      nfe_last_sync_at: new Date().toISOString(),
    });
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      notaRetornoId: returnRow.id,
      evento: 'nota_fiscal_retorno_envio_failed',
      respostaMl: { error: emitted.error || null, temporary: Boolean(emitted.temporary) },
      statusResultante: failedStatus,
    });
    throw new Error(emitted.error || 'A emissão da nota de retorno foi rejeitada');
  }

  const persisted = await markReturn(client, returnRow.id, {
    status: 'authorized',
    erro: null,
    nfe_external_id: emitted.externalId || null,
    nfe_chave: emitted.chave || null,
    nfe_numero: emitted.numero || null,
    nfe_serie: extractXmlTag(emitted.xml, 'serie'),
    nfe_protocolo: emitted.protocolo || null,
    nfe_xml: emitted.xml || null,
    nfe_danfe_url: emitted.danfeUrl || null,
    nfe_last_sync_at: new Date().toISOString(),
  });
  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    notaRetornoId: returnRow.id,
    evento: 'nota_fiscal_retorno_envio_success',
    respostaMl: {
      chave_presente: Boolean(emitted.chave),
      numero: emitted.numero || null,
      protocolo_presente: Boolean(emitted.protocolo),
    },
    statusResultante: 'authorized',
  });
  return publicReturnRow(persisted);
}

export async function getFiscalReturn(id: string) {
  const client = createServiceClient();
  const [{ data, error }, { data: history, error: historyError }] = await Promise.all([
    client
      .from('notas_fiscais_retorno')
      .select('*,pedidos(numero,ml_order_id,ml_pack_id,contato_nome)')
      .eq('id', id)
      .maybeSingle(),
    client
      .from('nf_auditoria_eventos')
      .select('id,evento,status_resultante,created_at')
      .eq('nota_retorno_id', id)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);
  if (error || historyError) throw new Error(error?.message || historyError?.message);
  return data ? { ...publicReturnRow(data), history: history || [] } : null;
}
