import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { acquireDomainLock, releaseDomainLock } from "@/lib/sync/domain-lock";
import { cancelarNotaBrasilNfePorChave } from "@/services/fiscal-provider";
import { registrarEventoNfAuditoria } from "@/services/nf-auditoria";
import { normalizeWhatsappChatId, sendWahaText } from "@/services/waha";

export const maxDuration = 300;

const DOMAIN = "pedidos:cancelamentos_pos_nfe";
const TASK_KEY = "sync_ml_cancelamentos_pos_nfe";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const NFE_CANCEL_JUSTIFICATIVA =
  "Cancelamento automático: pedido Mercado Livre cancelado pelo cliente.";

const NFE_CANCEL_SUCCESS_EVENT = "ml_cancel_auto_nfe_cancel_success";
const WHATSAPP_SENT_EVENT = "ml_cancel_auto_supplier_whatsapp_sent";

function normalizeNfeStatus(status: unknown): string {
  return String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isNfeAlreadyCancelled(status: unknown): boolean {
  const normalized = normalizeNfeStatus(status);
  return (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "cancelada" ||
    normalized === "cancelado"
  );
}

function isTerminalNfeCancelRejection(status: unknown): boolean {
  const normalized = normalizeNfeStatus(status);
  return normalized === "cancel_rejected_deadline";
}

function isDeadlineCancelRejection(result: {
  error?: string;
  raw?: any;
}): boolean {
  const code = Number(result?.raw?.CodStatusRespostaSefaz || 0);
  const text = String(
    result?.error || result?.raw?.DsMotivo || result?.raw?.Error || "",
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return code === 501 || text.includes("prazo de cancelamento superior");
}

function maskPhoneSuffix(value: unknown): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function buildSupplierCancellationMessage(input: {
  dsid: string;
  clienteNome: string | null;
  mlOrderId: string | null;
  pedidoNumero: number | null;
  notaFiscalNumero: string | null;
  nfeChave: string | null;
}) {
  return [
    "*Pedido cancelado no Mercado Livre*",
    "",
    "O cliente cancelou a venda.",
    "",
    `Pedido DSLite: #${input.dsid || "—"}`,
    `Cliente: ${input.clienteNome || "—"}`,
    input.mlOrderId ? `Pedido Mercado Livre: #${input.mlOrderId}` : null,
    input.pedidoNumero ? `Pedido Vortek: #${input.pedidoNumero}` : null,
    input.notaFiscalNumero
      ? `NF-e: ${input.notaFiscalNumero}`
      : input.nfeChave
        ? `NF-e chave: ${input.nfeChave}`
        : null,
    "",
    "A NF-e já foi cancelada no sistema fiscal.",
    "Por favor, não envie/expedie este pedido.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function hasAuditSuccess(input: {
  client: ReturnType<typeof createServiceClient>;
  pedidoId: string;
  evento: string;
}) {
  const { data, error } = await input.client
    .from("nf_auditoria_eventos")
    .select("id")
    .eq("pedido_id", input.pedidoId)
    .eq("evento", input.evento)
    .eq("status_resultante", "success")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

async function processPedido(input: {
  client: ReturnType<typeof createServiceClient>;
  pedido: any;
  dryRun: boolean;
}) {
  const { client, pedido, dryRun } = input;
  const pedidoId = String(pedido.id);
  const mlOrderId = pedido.ml_order_id ? String(pedido.ml_order_id) : null;
  const dsid = String(pedido.dslite_id || "").trim();
  const nfeChave = String(pedido.nfe_chave || "").trim();
  const nfeProtocolo = String(pedido.nfe_protocolo || "").trim() || null;

  if (!dsid || !nfeChave) {
    return { status: "skipped", reason: "missing_dslite_or_nfe_key" };
  }

  const [
    { data: compra, error: compraError },
    cancelAlreadyDone,
    whatsappAlreadySent,
  ] = await Promise.all([
    client
      .from("compras")
      .select(
        "id,dsid,fornecedor_id,fornecedor_nome,destinatario_nome,status,status_dslite,nf_chave,nf_numero",
      )
      .eq("dsid", dsid)
      .maybeSingle(),
    hasAuditSuccess({ client, pedidoId, evento: NFE_CANCEL_SUCCESS_EVENT }),
    hasAuditSuccess({ client, pedidoId, evento: WHATSAPP_SENT_EVENT }),
  ]);

  if (compraError) throw compraError;
  if (!compra?.id) {
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: "ml_cancel_auto_detected",
      respostaMl: { dsid, reason: "compra_dslite_nao_encontrada" },
      statusResultante: "skipped",
    });
    return { status: "skipped", reason: "purchase_not_found" };
  }

  await registrarEventoNfAuditoria({
    pedidoId,
    mlOrderId,
    evento: "ml_cancel_auto_detected",
    respostaMl: {
      dsid,
      compra_id: compra.id,
      fornecedor_id: (compra as any).fornecedor_id || null,
      nfe_chave: nfeChave,
      nfe_status: pedido.nfe_status || null,
      dry_run: dryRun,
    },
    statusResultante: "detected",
  });

  const nfeAlreadyCancelled =
    isNfeAlreadyCancelled(pedido.nfe_status) || cancelAlreadyDone;
  const nfeCancelTerminalRejected = isTerminalNfeCancelRejection(
    pedido.nfe_status,
  );
  let cancelledNow = false;

  if (nfeCancelTerminalRejected) {
    return {
      status: "skipped",
      reason: "nfe_cancel_rejected_deadline",
    };
  }

  if (!nfeAlreadyCancelled) {
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: "nota_fiscal_cancelamento_start",
      payloadEnviado: {
        chave: nfeChave,
        protocolo: nfeProtocolo,
        justificativa: NFE_CANCEL_JUSTIFICATIVA,
        source: TASK_KEY,
        dry_run: dryRun,
      },
      statusResultante: "started",
    });

    if (dryRun) {
      return {
        status: "dry_run",
        reason: "would_cancel_nfe_and_notify_supplier",
        dsid,
      };
    }

    const cancelResult = await cancelarNotaBrasilNfePorChave({
      chave: nfeChave,
      protocolo: nfeProtocolo,
      justificativa: NFE_CANCEL_JUSTIFICATIVA,
    });

    if (!cancelResult.ok) {
      const deadlineRejected = isDeadlineCancelRejection(cancelResult);
      if (deadlineRejected) {
        const now = new Date().toISOString();
        const { error: deadlineUpdateError } = await client
          .from("pedidos")
          .update({
            nfe_status: "cancel_rejected_deadline",
            nfe_last_sync_at: now,
            updated_at: now,
          } as any)
          .eq("id", pedidoId);

        if (deadlineUpdateError) {
          await registrarEventoNfAuditoria({
            pedidoId,
            mlOrderId,
            evento: "ml_cancel_auto_nfe_cancel_failed",
            respostaMl: {
              dsid,
              nfe_chave: nfeChave,
              error: deadlineUpdateError.message,
              raw: cancelResult.raw || null,
              step: "deadline_status_update_failed",
            },
            statusResultante: "failed",
          });
          return {
            status: "failed",
            reason: "local_nfe_status_update_failed",
            error: deadlineUpdateError.message,
          };
        }
      }

      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId,
        evento: deadlineRejected
          ? "ml_cancel_auto_nfe_cancel_rejected_deadline"
          : "ml_cancel_auto_nfe_cancel_failed",
        respostaMl: {
          dsid,
          nfe_chave: nfeChave,
          error: cancelResult.error || null,
          raw: cancelResult.raw || null,
        },
        statusResultante: deadlineRejected ? "terminal" : "failed",
      });

      if (deadlineRejected) {
        return {
          status: "processed",
          reason: "nfe_cancel_rejected_deadline",
          error:
            cancelResult.error ||
            "Prazo legal de cancelamento da NF-e excedido",
        };
      }

      return {
        status: "failed",
        reason: "nfe_cancel_failed",
        error: cancelResult.error || "Falha ao cancelar NF-e",
      };
    }

    const now = new Date().toISOString();
    const { error: updateError } = await client
      .from("pedidos")
      .update({
        nfe_status: "cancelled",
        nfe_last_sync_at: now,
        updated_at: now,
      } as any)
      .eq("id", pedidoId);

    if (updateError) {
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId,
        evento: "ml_cancel_auto_nfe_cancel_failed",
        respostaMl: {
          dsid,
          nfe_chave: nfeChave,
          error: updateError.message,
          raw: cancelResult.raw || null,
          step: "local_status_update_failed",
        },
        statusResultante: "failed",
      });
      return {
        status: "failed",
        reason: "local_nfe_status_update_failed",
        error: updateError.message,
      };
    }

    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: "ml_cancel_auto_nfe_cancel_success",
      respostaMl: {
        dsid,
        nfe_chave: nfeChave,
        raw: cancelResult.raw || null,
      },
      statusResultante: "success",
    });
    cancelledNow = true;
  }

  if (whatsappAlreadySent) {
    return {
      status: "processed",
      reason: "whatsapp_already_sent",
      nfe_cancelled_now: cancelledNow,
    };
  }

  if (dryRun) {
    return {
      status: "dry_run",
      reason: "would_notify_supplier",
      nfe_already_cancelled: nfeAlreadyCancelled,
      nfe_cancelled_now: cancelledNow,
    };
  }

  const fornecedorId = String((compra as any).fornecedor_id || "").trim();
  const { data: fornecedor, error: fornecedorError } = fornecedorId
    ? await client
        .from("fornecedores")
        .select("telefone,nome,apelido")
        .eq("dslite_id", fornecedorId)
        .maybeSingle()
    : ({ data: null, error: null } as any);

  if (fornecedorError) throw fornecedorError;

  const telefone = String((fornecedor as any)?.telefone || "").replace(
    /\D/g,
    "",
  );
  if (!telefone) {
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: "ml_cancel_auto_supplier_whatsapp_skipped",
      respostaMl: {
        dsid,
        fornecedor_id: fornecedorId || null,
        reason: "supplier_phone_missing",
      },
      statusResultante: "skipped",
    });
    return {
      status: "processed",
      reason: "supplier_phone_missing",
      nfe_cancelled_now: cancelledNow,
    };
  }

  const text = buildSupplierCancellationMessage({
    dsid,
    clienteNome:
      pedido.contato_nome || (compra as any).destinatario_nome || null,
    mlOrderId,
    pedidoNumero: Number.isFinite(Number(pedido.numero))
      ? Number(pedido.numero)
      : null,
    notaFiscalNumero:
      pedido.nota_fiscal_numero || (compra as any).nf_numero || null,
    nfeChave,
  });

  try {
    const chatId = normalizeWhatsappChatId(telefone);
    if (!dryRun) await sendWahaText({ chatId, text });
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: "ml_cancel_auto_supplier_whatsapp_sent",
      payloadEnviado: { chat_id_suffix: chatId.slice(-9), text },
      respostaMl: {
        dsid,
        fornecedor_id: fornecedorId || null,
        fornecedor_phone_suffix: maskPhoneSuffix(telefone),
        dry_run: dryRun,
      },
      statusResultante: "success",
    });
    return {
      status: "processed",
      reason: dryRun ? "dry_run_whatsapp" : "ok",
      nfe_cancelled_now: cancelledNow,
    };
  } catch (err: any) {
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: "ml_cancel_auto_supplier_whatsapp_failed",
      respostaMl: {
        dsid,
        fornecedor_id: fornecedorId || null,
        fornecedor_phone_suffix: maskPhoneSuffix(telefone),
        error: err?.message || "Erro ao enviar WhatsApp ao fornecedor",
      },
      statusResultante: "failed",
    });
    return {
      status: "failed",
      reason: "whatsapp_failed",
      error: err?.message || "Erro ao enviar WhatsApp ao fornecedor",
    };
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get("x-api-key") || "";
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  let lockOwnerToken = "";
  let lockAcquired = false;
  const errors: Array<{
    code: string;
    message: string;
    context?: Record<string, unknown>;
  }> = [];

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(Number(body?.limit || DEFAULT_LIMIT))),
    );
    const scanLimit = Math.min(200, Math.max(limit, limit * 20));
    const dryRun = Boolean(body?.dryRun);

    const lock = await acquireDomainLock({
      domain: DOMAIN,
      ownerTask: TASK_KEY,
      ttlSeconds: 20 * 60,
      metadata: { source: "api/sync/pedidos/cancelamentos-pos-nfe" },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json(
        {
          success: false,
          domain: DOMAIN,
          job: {
            key: TASK_KEY,
            started_at: new Date(startedAt).toISOString(),
            finished_at: new Date().toISOString(),
            lock_acquired: false,
          },
          records: { seen: 0, processed: 0, skipped: 0, failed: 0 },
          errors: [
            {
              code: "domain_lock_conflict",
              message: `Domínio ${DOMAIN} já está em execução`,
            },
          ],
          duration: { ms: Date.now() - startedAt },
        },
        { status: 409 },
      );
    }

    const client = createServiceClient();
    const { data: pedidos, error: pedidosError } = await client
      .from("pedidos")
      .select(
        "id,numero,ml_order_id,dslite_id,situacao,contato_nome,nfe_chave,nfe_protocolo,nfe_status,nota_fiscal_emitida,nota_fiscal_numero",
      )
      .eq("situacao", "cancelado")
      .not("dslite_id", "is", null)
      .not("nfe_chave", "is", null)
      .eq("nota_fiscal_emitida", true)
      .order("updated_at", { ascending: false })
      .limit(scanLimit);

    if (pedidosError) throw pedidosError;

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const pedido of pedidos || []) {
      if (processed + failed >= limit) break;
      const pedidoId = String((pedido as any).id);
      try {
        const result = await processPedido({ client, pedido, dryRun });
        results.push({ pedido_id: pedidoId, ...result });
        if (result.status === "failed") failed += 1;
        else if (result.status === "skipped" || result.status === "dry_run")
          skipped += 1;
        else if (result.reason !== "whatsapp_already_sent") processed += 1;
        else skipped += 1;
      } catch (err: any) {
        failed += 1;
        errors.push({
          code: "ml_cancelamento_pos_nfe_processing_failed",
          message: err?.message || "Falha ao processar cancelamento pós-NF",
          context: { pedido_id: pedidoId },
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0 && failed === 0,
      domain: DOMAIN,
      job: {
        key: TASK_KEY,
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
        dry_run: dryRun,
      },
      records: {
        seen: pedidos?.length || 0,
        scanned: results.length,
        processed,
        skipped,
        failed,
      },
      results,
      errors,
      duration: { ms: Date.now() - startedAt },
    });
  } catch (err: any) {
    errors.push({
      code: "ml_cancelamentos_pos_nfe_unexpected_error",
      message: err?.message || "Erro inesperado no job de cancelamentos pós-NF",
    });
    return NextResponse.json(
      {
        success: false,
        domain: DOMAIN,
        job: {
          key: TASK_KEY,
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: lockAcquired,
        },
        records: { seen: 0, processed: 0, skipped: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      },
      { status: 500 },
    );
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain: DOMAIN,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
