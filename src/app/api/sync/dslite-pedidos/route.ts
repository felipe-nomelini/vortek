import { NextResponse } from 'next/server';
import { fetchDslite } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 300;

interface DslitePedidoItem {
  item: number;
  nf_produtoid: string;
  nf_descricao: string;
  nf_preco_unitario: number;
  nf_preco_total: number;
  quantidade: number;
}

interface DslitePedido {
  dsid: number;
  nf_chave: string;
  nf_numero: string;
  nf_serie: string;
  valor_frete: number;
  valor_total: number;
  status: string;
  status_mensagem: string | null;
  data_criacao: string;
  rastreamento: string | null;
  items: DslitePedidoItem[];
  destinatario: {
    nome: string;
    cpfcnpj: string;
  };
  fornecedor: {
    fornecedorid: number;
    apelido: string;
    nome: string;
  };
}

interface DslitePedidosResponse {
  detalhesConsulta: {
    page: number;
    offset: number;
    limit: number;
    registrosRetornados: number;
    totalRegistros: number;
  };
  pedidos: DslitePedido[];
}

function parseDataCriacao(dataStr: string): string | undefined {
  // Formato: "DD/MM/YYYY HH:mm:ss"
  try {
    const [datePart, timePart] = dataStr.split(' ');
    const [day, month, year] = datePart.split('/');
    return `${year}-${month}-${day}T${timePart}`;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  try {
    const client = createServiceClient();
    const body = await request.json().catch(() => ({}));
    const rawWindowDays = Number(body?.windowDays);
    const hasExplicitRange = Boolean(body?.dataInicial || body?.dataFinal);
    const windowDays = Number.isFinite(rawWindowDays)
      ? Math.min(365, Math.max(1, Math.trunc(rawWindowDays)))
      : 60;

    const hoje = new Date();
    const defaultInicial = new Date(hoje.getTime() - windowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const defaultFinal = hoje.toISOString().split('T')[0];

    const dataInicial = String(body?.dataInicial || defaultInicial).trim();
    const dataFinal = String(body?.dataFinal || defaultFinal).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal)) {
      return NextResponse.json({ error: 'dataInicial/dataFinal devem estar no formato YYYY-MM-DD' }, { status: 422 });
    }
    if (dataInicial > dataFinal) {
      return NextResponse.json({ error: 'dataInicial não pode ser maior que dataFinal' }, { status: 422 });
    }

    let page = 1;
    let totalPedidos = 0;
    let inseridos = 0;
    let atualizados = 0;
    let erros = 0;
    let pedidosVinculadosPorNfe = 0;
    let pedidosSemNfeChave = 0;
    let vinculoNaoEncontradoNoPedidos = 0;

    while (true) {
      const data = await fetchDslite<DslitePedidosResponse>(
        `/v1/DropShipping?data_criacao_inicial=${dataInicial}&data_criacao_final=${dataFinal}&limit=100&page=${page}`
      );

      if (!data?.pedidos?.length) {
        if (page === 1) {
          return NextResponse.json({
            success: true,
            total: 0,
            inseridos: 0,
            atualizados: 0,
            erros: 0,
            pedidos_vinculados_por_nfe: 0,
            pedidos_sem_nfe_chave: 0,
            vinculo_nao_encontrado_no_pedidos: 0,
            data_inicial_usada: dataInicial,
            data_final_usada: dataFinal,
            window_days: hasExplicitRange ? null : windowDays,
            message: hasExplicitRange
              ? 'Nenhum pedido encontrado no período informado'
              : `Nenhum pedido encontrado nos últimos ${windowDays} dias`,
          });
        }
        break;
      }

      for (const pedido of data.pedidos) {
        totalPedidos++;

        try {
          const item = pedido.items?.[0];

          const payload = {
            dsid: String(pedido.dsid),
            status: pedido.status,
            status_dslite: pedido.status,
            nf_chave: pedido.nf_chave,
            nf_numero: pedido.nf_numero,
            nf_serie: pedido.nf_serie,
            valor_total: pedido.valor_total || 0,
            valor_frete: pedido.valor_frete || 0,
            data_criacao: parseDataCriacao(pedido.data_criacao),
            rastreio: pedido.rastreamento ?? undefined,
            fornecedor_id: pedido.fornecedor?.fornecedorid ? String(pedido.fornecedor.fornecedorid) : undefined,
            fornecedor_nome: pedido.fornecedor?.nome || pedido.fornecedor?.apelido || undefined,
            destinatario_nome: pedido.destinatario?.nome || undefined,
            destinatario_documento: pedido.destinatario?.cpfcnpj || undefined,
            produto_descricao: item?.nf_descricao || undefined,
            produto_sku: item?.nf_produtoid || undefined,
            quantidade: item?.quantidade || 1,
          };

          const { data: existente } = await client
            .from('compras')
            .select('id')
            .eq('dsid', String(pedido.dsid))
            .maybeSingle();

          if (existente?.id) {
            const { error } = await client
              .from('compras')
              .update(payload)
              .eq('id', existente.id);
            if (error) {
              console.error(`[sync-dslite-pedidos] Erro ao atualizar compra ${pedido.dsid}:`, error);
              erros++;
            } else {
              atualizados++;
            }
          } else {
            const { error } = await client
              .from('compras')
              .insert(payload);
            if (error) {
              console.error(`[sync-dslite-pedidos] Erro ao inserir compra ${pedido.dsid}:`, error);
              erros++;
            } else {
              inseridos++;
            }
          }

          // Vincula dsid na tabela pedidos (vendas) pela chave da NF-e
          if (pedido.nf_chave) {
            const { data: vinculados, error: vinculoError } = await client
              .from('pedidos')
              .update({
                dslite_id: String(pedido.dsid),
                dslite_status: pedido.status,
              })
              .eq('nfe_chave', pedido.nf_chave)
              .select('id');

            if (vinculoError) {
              console.error(`[sync-dslite-pedidos] Erro ao vincular pedido venda para dsid ${pedido.dsid}:`, vinculoError);
            } else {
              if (Array.isArray(vinculados) && vinculados.length > 0) {
                pedidosVinculadosPorNfe += vinculados.length;
              } else {
                vinculoNaoEncontradoNoPedidos++;
              }
              console.log(`[sync-dslite-pedidos] Vinculado pedido venda com NF ${pedido.nf_chave} ao dsid ${pedido.dsid}`);
            }
          } else {
            pedidosSemNfeChave++;
          }
        } catch (err: any) {
          console.error(`[sync-dslite-pedidos] Erro no pedido ${pedido.dsid}:`, err);
          erros++;
        }
      }

      const totalPaginas = Math.ceil((data.detalhesConsulta?.totalRegistros || 0) / (data.detalhesConsulta?.limit || 100));
      if (page >= totalPaginas) break;
      page++;
    }

    return NextResponse.json({
      success: true,
      total: totalPedidos,
      inseridos,
      atualizados,
      erros,
      pedidos_vinculados_por_nfe: pedidosVinculadosPorNfe,
      pedidos_sem_nfe_chave: pedidosSemNfeChave,
      vinculo_nao_encontrado_no_pedidos: vinculoNaoEncontradoNoPedidos,
      data_inicial_usada: dataInicial,
      data_final_usada: dataFinal,
      window_days: hasExplicitRange ? null : windowDays,
    });
  } catch (err: any) {
    console.error(`[sync-dslite-pedidos] Erro geral:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
