import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONFIGURATION_AUDIT_ACTION_LABELS,
  CONFIGURATION_DEFINITIONS,
  CONFIGURATION_DOMAIN_LABELS,
  sanitizeConfigurationAuditSnapshot,
  sanitizeStoredConfigurationAuditSnapshot,
  type ConfigurationAuditAction,
  type ConfigurationAuditEntryDto,
  type ConfigurationAuditSnapshot,
  type ConfigurationKey,
} from "@/lib/configuracoes/contracts";
import type { Database } from "@/types/database";

type ServiceClient = SupabaseClient<Database>;

export type ConfigurationAuditChange = {
  key: ConfigurationKey;
  targetId?: string | null;
  before: unknown;
  after: unknown;
  action?: ConfigurationAuditAction;
  force?: boolean;
};

export type ConfigurationAuditActor = {
  id: string;
  name: string;
};

function snapshotsEqual(
  before: ConfigurationAuditSnapshot,
  after: ConfigurationAuditSnapshot,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function resolveAction(
  change: ConfigurationAuditChange,
  before: ConfigurationAuditSnapshot,
  after: ConfigurationAuditSnapshot,
): ConfigurationAuditAction {
  if (change.action) return change.action;
  if ("configured" in after) return after.configured ? "secret_set" : "secret_removed";
  if (change.before === null || change.before === undefined) return "created";
  if (change.after === null || change.after === undefined) return "removed";
  return "updated";
}

export async function recordConfigurationAudit(
  client: ServiceClient,
  actor: ConfigurationAuditActor,
  changes: ConfigurationAuditChange[],
): Promise<string[]> {
  const rows = changes.flatMap((change) => {
    const before = sanitizeConfigurationAuditSnapshot(change.key, change.before);
    const after = sanitizeConfigurationAuditSnapshot(change.key, change.after);
    if (!change.force && snapshotsEqual(before, after)) return [];
    const definition = CONFIGURATION_DEFINITIONS[change.key];
    return [{
      dominio: definition.domain,
      chave: change.key,
      acao: resolveAction(change, before, after),
      alvo_id: change.targetId || null,
      autor_id: actor.id,
      autor_nome: actor.name.trim().slice(0, 200) || "Administrador",
      valor_anterior: before,
      valor_novo: after,
    }];
  });

  if (!rows.length) return [];
  const { data, error } = await client
    .from("configuracoes_auditoria")
    .insert(rows)
    .select("id");
  if (error) throw new Error(`CONFIG_AUDIT_FAILED:${error.code || "unknown"}`);
  return (data || []).map((row) => row.id);
}

type AuditRow = Database["public"]["Tables"]["configuracoes_auditoria"]["Row"];

export function toConfigurationAuditDto(row: AuditRow): ConfigurationAuditEntryDto {
  const key = row.chave as ConfigurationKey;
  const action = row.acao as ConfigurationAuditAction;
  const definition = CONFIGURATION_DEFINITIONS[key];
  const safeBefore = row.valor_anterior === null
    ? null
    : sanitizeStoredConfigurationAuditSnapshot(key, row.valor_anterior);
  const safeAfter = row.valor_novo === null
    ? null
    : sanitizeStoredConfigurationAuditSnapshot(key, row.valor_novo);

  return {
    id: row.id,
    domain: definition.domain,
    domainLabel: CONFIGURATION_DOMAIN_LABELS[definition.domain],
    key,
    keyLabel: definition.label,
    action,
    actionLabel: CONFIGURATION_AUDIT_ACTION_LABELS[action],
    targetId: row.alvo_id,
    actor: { id: row.autor_id, name: row.autor_nome },
    before: safeBefore,
    after: safeAfter,
    createdAt: row.created_at,
  };
}
