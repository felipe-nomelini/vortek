import { createServiceClient } from "@/lib/supabase";
import { consultarCadastroSefazBrasilNfe } from "@/services/fiscal-provider";
import { registrarEventoNfAuditoria } from "@/services/nf-auditoria";

type RecipientOrderRow = {
  id: string;
  billing_endereco?: Record<string, any> | null;
  snapshot_pendencias?: unknown;
};

function normalizeUf(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim().toUpperCase();
  const uf = normalized.startsWith("BR-") ? normalized.slice(3) : normalized;
  return /^[A-Z]{2}$/.test(uf) ? uf : null;
}

/**
 * Completa a IE do destinatário pelo CCC/SEFAZ quando o Mercado Livre não a
 * fornece. A consulta nunca bloqueia a emissão: sem resposta válida, preserva
 * a política fiscal já existente e deixa a SEFAZ validar o documento.
 */
export async function ensureRecipientIeFromSefaz(params: {
  client: ReturnType<typeof createServiceClient>;
  orders: RecipientOrderRow[];
  documento: string;
  uf: string | null | undefined;
  billingIe: string | null | undefined;
  mlOrderId?: string | null;
  mlPackId?: string | null;
}): Promise<{
  billingIe: string;
  checked: boolean;
  resolvedFromSefaz: boolean;
}> {
  const currentIe = String(params.billingIe || "").replace(/\D/g, "");
  const documento = String(params.documento || "").replace(/\D/g, "");
  const uf = normalizeUf(params.uf);
  if (currentIe || documento.length !== 14 || !uf) {
    return {
      billingIe: currentIe,
      checked: false,
      resolvedFromSefaz: false,
    };
  }

  const primaryPedidoId = params.orders[0]?.id || null;
  await registrarEventoNfAuditoria({
    pedidoId: primaryPedidoId,
    mlOrderId: params.mlOrderId || null,
    mlPackId: params.mlPackId || null,
    evento: "recipient_ie_sefaz_lookup_start",
    payloadEnviado: { uf, documento_tipo: "CNPJ" },
    statusResultante: "starting",
  });

  const registry = await consultarCadastroSefazBrasilNfe({ uf, documento });
  if (!registry.ok || !registry.active || !registry.ie) {
    await registrarEventoNfAuditoria({
      pedidoId: primaryPedidoId,
      mlOrderId: params.mlOrderId || null,
      mlPackId: params.mlPackId || null,
      evento: registry.ok
        ? "recipient_ie_sefaz_lookup_not_found"
        : "recipient_ie_sefaz_lookup_failed",
      respostaMl: {
        uf,
        status: registry.status,
        situacao: registry.situacao,
        fonte: registry.fonte,
        error: registry.error || null,
      },
      statusResultante: registry.ok ? "not_found" : "failed",
    });
    return {
      billingIe: "",
      checked: true,
      resolvedFromSefaz: false,
    };
  }

  const updateResults = await Promise.all(
    params.orders.map((order) => {
      const pending = Array.isArray(order.snapshot_pendencias)
        ? order.snapshot_pendencias.filter(
            (item) => item !== "billing_ie_ausente_cnpj",
          )
        : undefined;
      return params.client
        .from("pedidos")
        .update({
          billing_ie: registry.ie,
          billing_endereco: {
            ...(order.billing_endereco || {}),
            ie_policy_resolved: "contribuinte",
          },
          ...(pending ? { snapshot_pendencias: pending } : {}),
        } as any)
        .eq("id", order.id);
    }),
  );
  const persistenceErrors = updateResults
    .map((result) => result.error?.message || null)
    .filter(Boolean);

  await registrarEventoNfAuditoria({
    pedidoId: primaryPedidoId,
    mlOrderId: params.mlOrderId || null,
    mlPackId: params.mlPackId || null,
    evento: "recipient_ie_sefaz_lookup_success",
    respostaMl: {
      uf,
      status: registry.status,
      situacao: registry.situacao,
      fonte: registry.fonte,
      regime_apuracao: registry.regimeApuracao,
      ie_present: true,
      ie_digits: registry.ie.length,
      persisted_orders: params.orders.length - persistenceErrors.length,
      persistence_errors: persistenceErrors,
    },
    statusResultante:
      persistenceErrors.length === 0 ? "resolved" : "resolved_not_persisted",
  });

  return {
    billingIe: registry.ie,
    checked: true,
    resolvedFromSefaz: true,
  };
}
