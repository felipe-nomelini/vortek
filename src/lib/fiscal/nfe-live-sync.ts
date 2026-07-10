import { reconcileBrasilNfeExistingInvoice } from "@/lib/fiscal/ensure-brasilnfe-invoice";
import { reconcileLocalNfeSnapshotFromXml } from "@/lib/fiscal/nfe-local-reconciliation";
import { normalizeNfeTechnicalStatus } from "@/lib/fiscal/nfe-status";

const FINAL_STATUS_SYNC_INTERVAL_MS = 30_000;
const ACTIVE_STATUS_SYNC_INTERVAL_MS = 5_000;
const MAX_LIVE_SYNC_ROWS = 20;

function nowMs(): number {
  return Date.now();
}

function parseIsoMs(value: unknown): number | null {
  const iso = String(value || "").trim();
  if (!iso) return null;
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getSyncIntervalMs(row: any): number {
  const status = normalizeNfeTechnicalStatus(row?.nfe_status);
  if (
    status === "pendente" ||
    status === "processando" ||
    status === "interrompida" ||
    status === "outro"
  ) {
    return ACTIVE_STATUS_SYNC_INTERVAL_MS;
  }
  return FINAL_STATUS_SYNC_INTERVAL_MS;
}

function shouldSyncWithBrasilNfe(row: any, now: number): boolean {
  if (!row?.id) return false;
  const pedidoNumero = String(row?.numero || "").trim();
  if (!pedidoNumero) return false;
  const lastSyncMs = parseIsoMs(row?.nfe_last_sync_at);
  if (lastSyncMs === null) return true;
  return now - lastSyncMs >= getSyncIntervalMs(row);
}

async function reconcileRowsFromLocalXml(supabase: any, rows: any[]): Promise<any[]> {
  return Promise.all(
    (rows || []).map(async (row) => {
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
        .from("pedidos")
        .update({
          ...reconciliation.updates,
          nfe_last_sync_at: new Date().toISOString(),
        } as any)
        .eq("id", row.id);

      return {
        ...row,
        ...reconciliation.updates,
        nfe_last_sync_at: new Date().toISOString(),
      };
    }),
  );
}

export async function reconcileRowsBestEffort(
  supabase: any,
  rows: any[],
  options?: {
    liveSyncWithBrasilNfe?: boolean;
    maxLiveSyncRows?: number;
  },
): Promise<any[]> {
  const locallyReconciledRows = await reconcileRowsFromLocalXml(supabase, rows || []);
  if (!options?.liveSyncWithBrasilNfe) {
    return locallyReconciledRows;
  }

  const mergedRows = [...locallyReconciledRows];
  const rowIndexById = new Map<string, number>();
  mergedRows.forEach((row, index) => {
    if (row?.id) rowIndexById.set(String(row.id), index);
  });

  const now = nowMs();
  const maxLiveSyncRows = Math.max(
    1,
    Number(options?.maxLiveSyncRows || MAX_LIVE_SYNC_ROWS),
  );
  const candidates = locallyReconciledRows
    .filter((row) => shouldSyncWithBrasilNfe(row, now))
    .sort((a, b) => {
      const aSync = parseIsoMs(a?.nfe_last_sync_at) ?? 0;
      const bSync = parseIsoMs(b?.nfe_last_sync_at) ?? 0;
      return aSync - bSync;
    })
    .slice(0, maxLiveSyncRows);

  await Promise.all(
    candidates.map(async (row) => {
      const result = await reconcileBrasilNfeExistingInvoice({
        pedidoId: String(row.id),
      }).catch(() => null);

      if (!result?.ok) return;
      const index = rowIndexById.get(String(row.id));
      if (index === undefined) return;

      mergedRows[index] = {
        ...mergedRows[index],
        nfe_status: result.status || mergedRows[index]?.nfe_status || null,
        nfe_chave: result.chave || mergedRows[index]?.nfe_chave || null,
        nfe_protocolo: result.existingNfe?.numeroProtocolo || mergedRows[index]?.nfe_protocolo || null,
        nota_fiscal_numero: result.numero || mergedRows[index]?.nota_fiscal_numero || null,
        nfe_xml: result.xml || mergedRows[index]?.nfe_xml || null,
        nfe_danfe_url: result.danfeUrl || mergedRows[index]?.nfe_danfe_url || null,
        nfe_cfop: result.cfop || mergedRows[index]?.nfe_cfop || null,
        nfe_last_sync_at: new Date().toISOString(),
      };
    }),
  );

  return mergedRows;
}
