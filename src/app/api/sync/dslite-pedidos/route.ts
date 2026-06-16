import { NextResponse } from 'next/server';
import { fetchDslite } from '@/services/dslite';
import { createServiceClient } from '@/lib/supabase';
import { inferSupplierPaymentMode, resolveCompraStatus } from '@/lib/produto-fornecedor';
import { recordSupplierPurchaseDebit, resolveSupplierPurchaseDebitAmount } from '@/lib/supplier-balance';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

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
  try {
    const [datePart, timePart] = String(dataStr || '').trim().split(' ');
    const [day, month, year] = datePart.split('/');
    if (!day || !month || !year || !timePart) return undefined;

    // A DSLite retorna data/hora em horario local do Brasil sem offset.
    // Persistimos com -03:00 para evitar que o banco trate a string como UTC.
    return `${year}-${month}-${day}T${timePart}-03:00`;
  } catch {
    return undefined;
  }
}

function normalizeNfeKey(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  let lockOwnerToken = '';
  let lockAcquired = false;
  const domain = 'compras:dslite';
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_dslite_pedidos_compra',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/dslite-pedidos' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_dslite_pedidos_compra',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { seen: 0, inserted: 0, updated: 0, failed: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

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
    let recordsSeen = 0;
    let inserted = 0;
    let updated = 0;
    let failed = 0;
    let linkedByNfe = 0;
    let linkedByNfeFallback = 0;
    let withoutNfe = 0;
    let linkNotFound = 0;

    const fallbackNfeMap = new Map<string, string[]>();
    const { data: pedidosComNfe } = await client
      .from('pedidos')
      .select('id, nfe_chave, dslite_id')
      .not('nfe_chave', 'is', null)
      .or('dslite_id.is.null,dslite_id.eq.');

    for (const row of pedidosComNfe || []) {
      const normalized = normalizeNfeKey((row as any)?.nfe_chave);
      if (!normalized) continue;
      const list = fallbackNfeMap.get(normalized) || [];
      list.push(String((row as any).id));
      fallbackNfeMap.set(normalized, list);
    }

    while (true) {
      const data = await fetchDslite<DslitePedidosResponse>(
        `/v1/DropShipping?data_criacao_inicial=${dataInicial}&data_criacao_final=${dataFinal}&limit=100&page=${page}`,
      );

      if (!data?.pedidos?.length) {
        break;
      }

      for (const pedido of data.pedidos) {
        recordsSeen += 1;
        try {
          const item = pedido.items?.[0];
          const supplierPaymentMode = inferSupplierPaymentMode(pedido.fornecedor?.fornecedorid ? String(pedido.fornecedor.fornecedorid) : '');
          const resolvedSupplierPaymentAmount = supplierPaymentMode === 'balance_account'
            ? await resolveSupplierPurchaseDebitAmount({
              client,
              fornecedorId: pedido.fornecedor?.fornecedorid ? String(pedido.fornecedor.fornecedorid) : '',
              dsliteProdutoId: item?.nf_produtoid || null,
              sku: item?.nf_produtoid || null,
              quantity: item?.quantidade || 1,
            })
            : { amount: Number(pedido.valor_total || 0) || null, offerId: null, reason: 'not_balance_account' as const };

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
            supplier_payment_mode: supplierPaymentMode,
            supplier_payment_status: supplierPaymentMode === 'prepaid_pix' ? 'pending' : null,
            supplier_payment_amount: resolvedSupplierPaymentAmount.amount,
          };

          const { data: existente } = await client
            .from('compras')
            .select('id,supplier_payment_mode,supplier_payment_status')
            .eq('dsid', String(pedido.dsid))
            .maybeSingle();

          if (existente?.id) {
            const existingPaymentMode = String((existente as any)?.supplier_payment_mode || '').trim() || null;
            const existingPaymentStatus = String((existente as any)?.supplier_payment_status || '').trim() || null;
            const updatePayload = {
              ...payload,
              status: resolveCompraStatus({
                baseStatus: pedido.status,
                supplierPaymentMode: existingPaymentMode || supplierPaymentMode,
                supplierPaymentStatus: existingPaymentStatus || (supplierPaymentMode === 'prepaid_pix' ? 'pending' : null),
              }),
              supplier_payment_mode: existingPaymentMode || supplierPaymentMode,
              supplier_payment_status: existingPaymentStatus || (supplierPaymentMode === 'prepaid_pix' ? 'pending' : null),
            };
            const { error: updateError } = await client
              .from('compras')
              .update(updatePayload as any)
              .eq('id', existente.id);
            if (updateError) {
              failed += 1;
              errors.push({
                code: 'dslite_purchase_update_failed',
                message: updateError.message,
                context: { dsid: pedido.dsid },
              });
            } else {
              updated += 1;
            }
          } else {
            const insertPayload = {
              ...payload,
              status: resolveCompraStatus({
                baseStatus: pedido.status,
                supplierPaymentMode,
                supplierPaymentStatus: supplierPaymentMode === 'prepaid_pix' ? 'pending' : null,
              }),
            };
            const { error: insertError } = await client
              .from('compras')
              .insert(insertPayload as any);
            if (insertError) {
              failed += 1;
              errors.push({
                code: 'dslite_purchase_insert_failed',
                message: insertError.message,
                context: { dsid: pedido.dsid },
              });
            } else {
              inserted += 1;
            }
          }

          if (supplierPaymentMode === 'balance_account') {
            const { data: compraBalance } = await client
              .from('compras')
              .select('id,dsid')
              .eq('dsid', String(pedido.dsid))
              .maybeSingle();

            if (compraBalance?.id) {
              await recordSupplierPurchaseDebit({
                client,
                fornecedorId: pedido.fornecedor?.fornecedorid ? String(pedido.fornecedor.fornecedorid) : '',
                fornecedorNome: pedido.fornecedor?.nome || pedido.fornecedor?.apelido || null,
                compraId: String(compraBalance.id),
                dsid: String(pedido.dsid),
                amount: Number(resolvedSupplierPaymentAmount.amount || 0) || 0,
                reference: `Compra DSLite ${pedido.dsid}`,
                notes: resolvedSupplierPaymentAmount.amount
                  ? 'Débito automático por sync de compras DSLite usando custo da oferta'
                  : `Débito não registrado: custo da oferta não encontrado (${resolvedSupplierPaymentAmount.reason})`,
              });
            }
          }

          if (pedido.nf_chave) {
            const { data: vinculados, error: vinculoError } = await client
              .from('pedidos')
              .update({
                dslite_id: String(pedido.dsid),
                dslite_status: pedido.status,
              } as any)
              .eq('nfe_chave', pedido.nf_chave)
              .select('id');

            if (vinculoError) {
              errors.push({
                code: 'dslite_link_by_nfe_failed',
                message: vinculoError.message,
                context: { dsid: pedido.dsid, nf_chave: pedido.nf_chave },
              });
            } else if (Array.isArray(vinculados) && vinculados.length > 0) {
              linkedByNfe += vinculados.length;
            } else {
              const normalizedNfe = normalizeNfeKey(pedido.nf_chave);
              const fallbackIds = normalizedNfe ? (fallbackNfeMap.get(normalizedNfe) || []) : [];

              if (fallbackIds.length > 0) {
                const { data: fallbackUpdated, error: fallbackError } = await client
                  .from('pedidos')
                  .update({
                    dslite_id: String(pedido.dsid),
                    dslite_status: pedido.status,
                  } as any)
                  .in('id', fallbackIds as any)
                  .is('dslite_id', null)
                  .select('id');

                if (fallbackError) {
                  errors.push({
                    code: 'dslite_link_by_nfe_fallback_failed',
                    message: fallbackError.message,
                    context: { dsid: pedido.dsid, nf_chave: pedido.nf_chave, fallback_ids: fallbackIds },
                  });
                  linkNotFound += 1;
                } else if (Array.isArray(fallbackUpdated) && fallbackUpdated.length > 0) {
                  linkedByNfe += fallbackUpdated.length;
                  linkedByNfeFallback += fallbackUpdated.length;
                  const updatedIds = new Set(fallbackUpdated.map((row: any) => String(row.id)));
                  fallbackNfeMap.set(
                    normalizedNfe,
                    fallbackIds.filter((id) => !updatedIds.has(String(id))),
                  );
                } else {
                  linkNotFound += 1;
                }
              } else {
                linkNotFound += 1;
              }
            }
          } else {
            withoutNfe += 1;
          }
        } catch (err: any) {
          failed += 1;
          errors.push({
            code: 'dslite_purchase_processing_failed',
            message: err?.message || 'Falha ao processar pedido DSLite',
            context: { dsid: pedido.dsid },
          });
        }
      }

      const totalPaginas = Math.ceil((data.detalhesConsulta?.totalRegistros || 0) / (data.detalhesConsulta?.limit || 100));
      if (page >= totalPaginas) break;
      page += 1;
    }

    return NextResponse.json({
      success: errors.length === 0,
      domain,
      job: {
        key: 'sync_dslite_pedidos_compra',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: null,
      records: {
        seen: recordsSeen,
        inserted,
        updated,
        linked_by_nfe: linkedByNfe,
        linked_by_nfe_fallback: linkedByNfeFallback,
        without_nfe: withoutNfe,
        link_not_found: linkNotFound,
        failed,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
      // Compatibilidade
      total: recordsSeen,
      inseridos: inserted,
      atualizados: updated,
      erros: failed,
      pedidos_vinculados_por_nfe: linkedByNfe,
      pedidos_vinculados_por_nfe_fallback: linkedByNfeFallback,
      pedidos_sem_nfe_chave: withoutNfe,
      vinculo_nao_encontrado_no_pedidos: linkNotFound,
      data_inicial_usada: dataInicial,
      data_final_usada: dataFinal,
      window_days: hasExplicitRange ? null : windowDays,
    });
  } catch (err: any) {
    errors.push({
      code: 'dslite_pedidos_sync_unexpected_error',
      message: err?.message || 'Erro inesperado no sync DSLite de pedidos de compra',
    });
    return NextResponse.json({
      success: false,
      domain,
      job: {
        key: 'sync_dslite_pedidos_compra',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      records: { seen: 0, inserted: 0, updated: 0, failed: 0 },
      errors,
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
