import { NextResponse } from "next/server";
import { fetchMLResult, getMLConnectionStatus } from "@/services/integration";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MLOrder = {
  id: number;
  date_created?: string;
  date_last_updated?: string;
  status?: string;
  buyer?: { id?: number; nickname?: string };
  order_items?: Array<{ item?: { id?: string; title?: string } }>;
  mediations?: Array<{ id?: number }>;
};

type MLClaim = {
  id: number;
  resource_id: number;
  status: string;
  type: string;
  stage: string;
  reason_id?: string | null;
  fulfilled?: boolean | null;
  quantity_type?: string | null;
  claimed_quantity?: number | null;
  resolution?: any;
  date_created?: string;
  last_updated?: string;
  players?: Array<{
    role?: string;
    type?: string;
    user_id?: number;
    available_actions?: Array<{
      action?: string;
      mandatory?: boolean;
      due_date?: string | null;
    }>;
  }>;
  related_entities?: string[];
};

type MLClaimReason = {
  id: string;
  name?: string | null;
  detail?: string | null;
  flow?: string | null;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getOrderSearch(
  sellerId: number | string,
  params: Record<string, string>,
) {
  const search = new URLSearchParams({
    seller: String(sellerId),
    limit: "50",
    sort: "date_desc",
    ...params,
  });
  const result = await fetchMLResult<any>(
    `/orders/search?${search.toString()}`,
  );
  return result.ok ? ((result.data?.results || []) as MLOrder[]) : [];
}

function typeLabel(type: string | null | undefined) {
  if (type === "return" || type === "returns") return "Devolução";
  if (type === "mediations") return "Mediação";
  if (type === "cancel_sale" || type === "cancel_purchase")
    return "Cancelamento";
  if (type === "ml_case") return "Caso ML";
  if (type === "change") return "Troca";
  if (type === "service") return "Serviço";
  return type || "—";
}

function stageLabel(stage: string | null | undefined) {
  if (stage === "claim") return "Negociação";
  if (stage === "dispute") return "Disputa";
  if (stage === "recontact") return "Recontato";
  if (stage === "none") return "Não se aplica";
  if (stage === "stale") return "Tratativa ML";
  return stage || "—";
}

function statusLabel(status: string | null | undefined) {
  if (status === "opened") return "Aberto";
  if (status === "closed") return "Fechado";
  return status || "—";
}

function entityLabel(entity: string) {
  if (entity === "return") return "Devolução";
  return entity;
}

export async function GET() {
  try {
    const connection = await getMLConnectionStatus();
    if (!connection.conectado) {
      return NextResponse.json({
        conectado: false,
        precisaReconectar: true,
        items: [],
        total: 0,
        erro: connection.erro || "Mercado Livre desconectado",
      });
    }

    const meResult = await fetchMLResult<any>("/users/me");
    const sellerId = meResult.ok ? meResult.data?.id : null;
    if (!sellerId) {
      return NextResponse.json({
        conectado: true,
        precisaReconectar: false,
        items: [],
        total: 0,
        erro: "Não foi possível identificar a loja Mercado Livre",
      });
    }

    const [openedOrders, closedOrders] = await Promise.all([
      getOrderSearch(sellerId, { "mediations.status": "opened" }),
      getOrderSearch(sellerId, { "mediations.status": "closed" }),
    ]);

    const reasonCache = new Map<string, Promise<MLClaimReason | null>>();
    const getReason = (reasonId: string | null | undefined) => {
      if (!reasonId) return Promise.resolve(null);
      if (!reasonCache.has(reasonId)) {
        reasonCache.set(
          reasonId,
          fetchMLResult<MLClaimReason>(
            `/post-purchase/v1/claims/reasons/${reasonId}`,
          )
            .then((result) => (result.ok ? result.data : null))
            .catch(() => null),
        );
      }
      return reasonCache.get(reasonId)!;
    };

    const byClaimId = new Map<number, MLOrder>();
    for (const order of [...openedOrders, ...closedOrders]) {
      for (const mediation of order.mediations || []) {
        const claimId = toNumber(mediation.id);
        if (claimId && !byClaimId.has(claimId)) byClaimId.set(claimId, order);
      }
    }

    const entries = Array.from(byClaimId.entries()).slice(0, 80);
    const claimResults = await Promise.all(
      entries.map(async ([claimId, order]) => {
        const claimResult = await fetchMLResult<MLClaim>(
          `/post-purchase/v1/claims/${claimId}`,
        );
        const claim = claimResult.ok ? claimResult.data : null;
        const messagesResult = await fetchMLResult<any[]>(
          `/post-purchase/v1/claims/${claimId}/messages`,
        );
        const messages =
          messagesResult.ok && Array.isArray(messagesResult.data)
            ? messagesResult.data.map((message: any) => ({
                id: message?.id || null,
                sender:
                  message?.sender_role ||
                  message?.sender?.role ||
                  message?.from ||
                  null,
                text:
                  message?.message ||
                  message?.text ||
                  message?.plain_text ||
                  null,
                date_created:
                  message?.date_created || message?.created_at || null,
              }))
            : [];

        const sellerPlayer = claim?.players?.find(
          (player) => player.type === "seller" || player.role === "respondent",
        );
        const reason = await getReason(claim?.reason_id);
        const firstItem = order.order_items?.[0]?.item;
        return {
          id: claim?.id || claimId,
          pedido: claim?.resource_id || order.id,
          cliente: order.buyer?.nickname || String(order.buyer?.id || "—"),
          buyer_id: order.buyer?.id || null,
          tipo: claim?.type || null,
          tipo_label: typeLabel(claim?.type),
          stage: claim?.stage || null,
          stage_label: stageLabel(claim?.stage),
          status: claim?.status || null,
          status_label: statusLabel(claim?.status),
          reason_id: claim?.reason_id || null,
          reason_name: reason?.name || null,
          reason_detail: reason?.detail || null,
          reason_flow: reason?.flow || null,
          fulfilled: claim?.fulfilled ?? null,
          quantity_type: claim?.quantity_type || null,
          claimed_quantity: claim?.claimed_quantity ?? null,
          resolution: claim?.resolution || null,
          data: claim?.date_created || order.date_created || null,
          atualizado_em: claim?.last_updated || order.date_last_updated || null,
          pedido_status: order.status || null,
          item_id: firstItem?.id || null,
          item_title: firstItem?.title || null,
          available_actions: sellerPlayer?.available_actions || [],
          related_entities: claim?.related_entities || [],
          related_entities_label: (claim?.related_entities || []).map(
            entityLabel,
          ),
          messages,
        };
      }),
    );

    const items = claimResults.sort((a, b) => {
      const da = new Date(a.atualizado_em || a.data || 0).getTime();
      const db = new Date(b.atualizado_em || b.data || 0).getTime();
      return db - da;
    });

    return NextResponse.json({
      conectado: true,
      precisaReconectar: false,
      total: items.length,
      items,
      source: {
        orders: "/orders/search?mediations.status=opened|closed",
        claims: "/post-purchase/v1/claims/{claim_id}",
        messages: "/post-purchase/v1/claims/{claim_id}/messages",
        reasons: "/post-purchase/v1/claims/reasons/{reason_id}",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        conectado: true,
        precisaReconectar: false,
        items: [],
        total: 0,
        erro: error?.message || "Falha ao carregar reclamações",
      },
      { status: 500 },
    );
  }
}
