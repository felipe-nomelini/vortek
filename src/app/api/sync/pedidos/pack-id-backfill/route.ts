import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchML } from "@/services/integration";
import { registrarEventoNfAuditoria } from "@/services/nf-auditoria";
import { acquireDomainLock, releaseDomainLock } from "@/lib/sync/domain-lock";

function isMissingSaleDateColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "42703" &&
    String(error?.message || "").includes("data_venda")
  );
}

async function resolvePackIdFromMl(orderId: string): Promise<string | null> {
  try {
    const detail = await fetchML<any>(`/orders/${orderId}`);
    if (detail?.pack_id) return String(detail.pack_id);
  } catch {
    // ignora
  }

  try {
    const detailAlt = await fetchML<any>(`/orders/${orderId}`, {
      headers: { "x-format-new": "true" },
    });
    if (detailAlt?.pack_id) return String(detailAlt.pack_id);
  } catch {
    // ignora
  }

  return null;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json(
      { erro: "Chave de API inválida" },
      { status: 401 },
    );
  }

  const domain = "pedidos:pack";
  let lockOwnerToken = "";
  let lockAcquired = false;

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: "sync_pack_id_backfill",
      ttlSeconds: 20 * 60,
      metadata: { source: "api/sync/pedidos/pack-id-backfill" },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json(
        {
          success: false,
          domain,
          errors: [
            {
              code: "domain_lock_conflict",
              message: `Domínio ${domain} já está em execução`,
            },
          ],
          records: { processed: 0, updated: 0, not_found: 0, failed: 0 },
          duration: { ms: Date.now() - startedAt },
        },
        { status: 409 },
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10)),
    );

    const client = createServiceClient();

    function buildQuery(useSaleDate: boolean) {
      let query = client
        .from("pedidos")
        .select("id, ml_order_id, ml_pack_id")
        .is("ml_pack_id", null)
        .not("ml_order_id", "is", null)
        .limit(limit);

      query = useSaleDate
        ? query
            .order("data_venda", { ascending: false, nullsFirst: false })
            .order("data", { ascending: false })
        : query.order("data", { ascending: false });

      return query;
    }

    let { data: pedidos, error } = await buildQuery(true);
    if (isMissingSaleDateColumnError(error)) {
      ({ data: pedidos, error } = await buildQuery(false));
    }

    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }

    let atualizados = 0;
    let naoEncontrados = 0;
    let erros = 0;

    for (const pedido of pedidos || []) {
      try {
        const mlOrderId = String(pedido.ml_order_id || "").trim();
        if (!mlOrderId) continue;

        const packId = await resolvePackIdFromMl(mlOrderId);
        if (!packId) {
          naoEncontrados += 1;
          await registrarEventoNfAuditoria({
            pedidoId: pedido.id,
            mlOrderId,
            evento: "pack_id_backfill",
            respostaMl: { motivo: "pack_id_nao_encontrado" },
            statusResultante: "warning",
          });
          continue;
        }

        const { error: updateError } = await client
          .from("pedidos")
          .update({ ml_pack_id: packId } as any)
          .eq("id", pedido.id)
          .is("ml_pack_id", null);

        if (updateError) {
          erros += 1;
          await registrarEventoNfAuditoria({
            pedidoId: pedido.id,
            mlOrderId,
            mlPackId: packId,
            evento: "pack_id_backfill",
            respostaMl: { motivo: "erro_update", erro: updateError.message },
            statusResultante: "failed",
          });
          continue;
        }

        atualizados += 1;
        await registrarEventoNfAuditoria({
          pedidoId: pedido.id,
          mlOrderId,
          mlPackId: packId,
          evento: "pack_id_backfill",
          respostaMl: { motivo: "pack_id_preenchido" },
          statusResultante: "success",
        });
      } catch (err: any) {
        erros += 1;
        await registrarEventoNfAuditoria({
          pedidoId: pedido.id,
          mlOrderId: pedido.ml_order_id ? String(pedido.ml_order_id) : null,
          evento: "pack_id_backfill",
          respostaMl: {
            motivo: "erro_processamento",
            erro: err?.message || "erro_desconhecido",
          },
          statusResultante: "failed",
        });
      }
    }

    return NextResponse.json({
      success: true,
      domain,
      ok: true,
      processados: (pedidos || []).length,
      atualizados,
      nao_encontrados: naoEncontrados,
      erros,
      limit,
      records: {
        processed: (pedidos || []).length,
        updated: atualizados,
        not_found: naoEncontrados,
        failed: erros,
      },
      duration: { ms: Date.now() - startedAt },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        domain,
        errors: [
          {
            code: "pack_backfill_unexpected_error",
            message: err?.message || "Erro inesperado no backfill de pack_id",
          },
        ],
        records: { processed: 0, updated: 0, not_found: 0, failed: 0 },
        duration: { ms: Date.now() - startedAt },
        lock_acquired: lockAcquired,
      },
      { status: 500 },
    );
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
