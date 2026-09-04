import { z } from "zod";
import type { Json } from "@/types/database";

export const CONFIGURATION_CLASSIFICATIONS = [
  "EDITAVEL_IMEDIATO",
  "EDITAVEL_CONTROLADO",
  "SECRET_WRITE_ONLY",
  "STATUS_SOMENTE_LEITURA",
  "PREFERENCIA_LOCAL",
  "INVARIANTE",
  "OBSOLETO",
] as const;

export type ConfigurationClassification =
  (typeof CONFIGURATION_CLASSIFICATIONS)[number];

export const CONFIGURATION_DOMAINS = [
  "empresa_fiscal",
  "comercial_precificacao",
  "produtos_estoque_fulfillment",
  "mercado_livre_anuncios",
  "notificacoes",
  "integracoes",
  "dashboard_tv",
  "usuarios_permissoes",
  "sistema_jobs",
] as const;

export type ConfigurationDomain = (typeof CONFIGURATION_DOMAINS)[number];

export const CONFIGURATION_DOMAIN_LABELS: Record<ConfigurationDomain, string> = {
  empresa_fiscal: "Empresa e fiscal",
  comercial_precificacao: "Comercial e precificação",
  produtos_estoque_fulfillment: "Produtos, estoque e fulfillment",
  mercado_livre_anuncios: "Mercado Livre e anúncios",
  notificacoes: "Notificações",
  integracoes: "Integrações",
  dashboard_tv: "Dashboard e TV",
  usuarios_permissoes: "Usuários e permissões",
  sistema_jobs: "Sistema e jobs",
};

type ConfigurationDefinition = {
  domain: ConfigurationDomain;
  label: string;
  classification: ConfigurationClassification;
};

export const CONFIGURATION_DEFINITIONS = {
  "empresa.nome": { domain: "empresa_fiscal", label: "Nome da empresa", classification: "EDITAVEL_CONTROLADO" },
  "empresa.nickname": { domain: "empresa_fiscal", label: "Nickname Mercado Livre", classification: "EDITAVEL_CONTROLADO" },
  "empresa.cnpj": { domain: "empresa_fiscal", label: "CNPJ", classification: "EDITAVEL_CONTROLADO" },
  "empresa.endereco": { domain: "empresa_fiscal", label: "Endereço", classification: "EDITAVEL_CONTROLADO" },
  "empresa.email": { domain: "empresa_fiscal", label: "E-mail", classification: "EDITAVEL_CONTROLADO" },
  "empresa.telefone": { domain: "empresa_fiscal", label: "Telefone", classification: "EDITAVEL_CONTROLADO" },
  "empresa.uf_fiscal": { domain: "empresa_fiscal", label: "UF fiscal", classification: "EDITAVEL_CONTROLADO" },
  "empresa.cod_municipio_fiscal": { domain: "empresa_fiscal", label: "Município fiscal", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.margem_lucro": { domain: "comercial_precificacao", label: "Margem de lucro padrão", classification: "EDITAVEL_IMEDIATO" },
  "configuracoes.notificacoes_push": { domain: "notificacoes", label: "Notificações push", classification: "EDITAVEL_IMEDIATO" },
  "configuracoes.nfe_provider_default": { domain: "empresa_fiscal", label: "Provedor fiscal padrão", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.simples_aliquota_confirmada": { domain: "empresa_fiscal", label: "Alíquota confirmada do Simples", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.simples_aliquota_confirmada_em": { domain: "empresa_fiscal", label: "Data da alíquota confirmada", classification: "EDITAVEL_CONTROLADO" },
  "integracoes.client_id": { domain: "integracoes", label: "Client ID", classification: "EDITAVEL_CONTROLADO" },
  "integracoes.client_secret": { domain: "integracoes", label: "Client secret", classification: "SECRET_WRITE_ONLY" },
  "integracoes.url": { domain: "integracoes", label: "URL da integração", classification: "EDITAVEL_CONTROLADO" },
  "integracoes.access_token": { domain: "integracoes", label: "Token de acesso", classification: "SECRET_WRITE_ONLY" },
  "integracoes.refresh_token": { domain: "integracoes", label: "Token de renovação", classification: "SECRET_WRITE_ONLY" },
  "integracoes.conectado": { domain: "integracoes", label: "Estado da conexão", classification: "EDITAVEL_CONTROLADO" },
  "usuarios.nome": { domain: "usuarios_permissoes", label: "Nome do usuário", classification: "EDITAVEL_CONTROLADO" },
  "usuarios.email": { domain: "usuarios_permissoes", label: "E-mail do usuário", classification: "EDITAVEL_CONTROLADO" },
  "usuarios.cargo": { domain: "usuarios_permissoes", label: "Cargo do usuário", classification: "EDITAVEL_CONTROLADO" },
  "usuarios.avatar_url": { domain: "usuarios_permissoes", label: "Avatar do usuário", classification: "EDITAVEL_CONTROLADO" },
  "usuarios.senha": { domain: "usuarios_permissoes", label: "Senha do usuário", classification: "SECRET_WRITE_ONLY" },
  "usuarios.ativo": { domain: "usuarios_permissoes", label: "Estado do usuário", classification: "EDITAVEL_CONTROLADO" },
} as const satisfies Record<string, ConfigurationDefinition>;

export type ConfigurationKey = keyof typeof CONFIGURATION_DEFINITIONS;

export const CONFIGURATION_AUDIT_ACTIONS = [
  "created",
  "updated",
  "enabled",
  "disabled",
  "secret_set",
  "secret_removed",
  "removed",
] as const;

export type ConfigurationAuditAction =
  (typeof CONFIGURATION_AUDIT_ACTIONS)[number];

export const CONFIGURATION_AUDIT_ACTION_LABELS: Record<ConfigurationAuditAction, string> = {
  created: "Criado",
  updated: "Atualizado",
  enabled: "Ativado",
  disabled: "Desativado",
  secret_set: "Credencial definida",
  secret_removed: "Credencial removida",
  removed: "Removido",
};

const optionalCompanyEmailSchema = z.union([
  z.literal(""),
  z.string().trim().email("E-mail inválido").max(320),
]);

export const companyConfigurationSchema = z.object({
  id: z.string().uuid("Empresa inválida").nullable().optional(),
  nome: z.string().trim().max(200),
  nickname: z.string().trim().max(200),
  cnpj: z.string().trim().max(32),
  endereco: z.string().trim().max(500),
  email: optionalCompanyEmailSchema,
  telefone: z.string().trim().max(40),
  uf_fiscal: z.string().trim().regex(/^[A-Za-z]{2}$/, "UF Fiscal inválida. Use 2 letras (ex.: RS)."),
  cod_municipio_fiscal: z.union([
    z.literal(""),
    z.string().trim().regex(/^\d{7}$/, "Código Município (IBGE) inválido. Use 7 dígitos."),
  ]),
}).strict();

export const preferencesConfigurationSchema = z.object({
  margem_lucro: z.number().finite().min(0).max(1000),
  notificacoes_push: z.boolean(),
  nfe_provider_default: z.literal("brasilnfe"),
  simples_aliquota_confirmada_percentual: z.number().finite().min(4).lt(100).nullable(),
  simples_aliquota_confirmada_em: z.union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de confirmação inválida"),
    z.null(),
  ]),
}).strict().refine(
  (value) =>
    (value.simples_aliquota_confirmada_percentual === null)
      === (!value.simples_aliquota_confirmada_em),
  { message: "Informe ou remova juntos a alíquota confirmada e a data do PGDAS" },
);

export const fiscalProviderConfigurationSchema = z.object({
  defaultProvider: z.literal("brasilnfe"),
}).strict();

const credentialSchema = z.string().trim().min(1).max(8192).nullable();
const integrationUrlSchema = z.union([
  z.literal("").transform(() => null),
  z.string().trim().url().max(2048),
  z.null(),
]);

function requireAtLeastOneField<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.strict().refine(
    (value) => Object.keys(value).length > 0,
    { message: "Nenhum campo permitido informado" },
  );
}

export const integrationConfigurationSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("mercadolivre"),
    values: requireAtLeastOneField(z.object({
      client_id: z.string().trim().max(200).optional(),
      client_secret: credentialSchema.optional(),
    })),
  }).strict(),
  z.object({
    tipo: z.literal("dslite"),
    values: requireAtLeastOneField(z.object({
      url: integrationUrlSchema.optional(),
      access_token: credentialSchema.optional(),
      conectado: z.boolean().optional(),
    })),
  }).strict(),
  z.object({
    tipo: z.literal("brasilnfe"),
    values: requireAtLeastOneField(z.object({
      url: integrationUrlSchema.optional(),
      access_token: credentialSchema.optional(),
      refresh_token: credentialSchema.optional(),
      conectado: z.boolean().optional(),
    })),
  }).strict(),
  z.object({
    tipo: z.literal("mercadopago"),
    values: requireAtLeastOneField(z.object({
      access_token: credentialSchema.optional(),
      conectado: z.boolean().optional(),
    })),
  }).strict(),
]);

export const USER_ROLES = ["admin", "gerente", "operador", "visualizador"] as const;

export const createUserConfigurationSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(320),
  senha: z.string().min(6).max(256),
  cargo: z.enum(USER_ROLES),
  avatar_url: z.union([z.literal(""), z.string().trim().url("URL do avatar inválida").max(2048)]).optional(),
}).strict();

const updateUserProfileSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(320),
  senha: z.union([z.literal(""), z.string().min(6).max(256)]).optional(),
  cargo: z.enum(USER_ROLES),
  avatar_url: z.union([z.literal(""), z.string().trim().url("URL do avatar inválida").max(2048)]).optional(),
}).strict();

const updateUserStatusSchema = z.object({ ativo: z.boolean() }).strict();

export const updateUserConfigurationSchema = z.union([
  updateUserStatusSchema,
  updateUserProfileSchema,
]);

export const userIdSchema = z.string().uuid("Usuário inválido");

const positiveInteger = z.coerce.number().int().positive();

export const configurationAuditQuerySchema = z.object({
  dominio: z.enum(CONFIGURATION_DOMAINS).optional(),
  acao: z.enum(CONFIGURATION_AUDIT_ACTIONS).optional(),
  page: positiveInteger.default(1),
  pageSize: positiveInteger.max(100).default(25),
}).strict();

export type ConfigurationAuditSnapshot =
  | { value: Json }
  | { configured: boolean };

export type ConfigurationAuditEntryDto = {
  id: string;
  domain: ConfigurationDomain;
  domainLabel: string;
  key: ConfigurationKey;
  keyLabel: string;
  action: ConfigurationAuditAction;
  actionLabel: string;
  targetId: string | null;
  actor: { id: string; name: string };
  before: ConfigurationAuditSnapshot | null;
  after: ConfigurationAuditSnapshot | null;
  createdAt: string;
};

export type ConfigurationAuditResponse = {
  items: ConfigurationAuditEntryDto[];
  pagination: { page: number; pageSize: number; total: number };
};

const SENSITIVE_AUDIT_KEY =
  /(?:secret|token|password|senha|credential|cookie|authorization|api[_-]?key|private[_-]?key)/i;

function isConfigured(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined && value !== false;
}

function sanitizeJson(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): Json {
  if (SENSITIVE_AUDIT_KEY.test(key)) return { configured: isConfigured(value) };
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value as Json;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeJson(item, key, seen));
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const result: Record<string, Json> = {};
  for (const [nestedKey, nestedValue] of Object.entries(value).slice(0, 100)) {
    result[nestedKey] = sanitizeJson(nestedValue, nestedKey, seen);
  }
  return result;
}

export function sanitizeConfigurationAuditSnapshot(
  key: ConfigurationKey,
  value: unknown,
): ConfigurationAuditSnapshot {
  const definition = CONFIGURATION_DEFINITIONS[key];
  if (definition.classification === "SECRET_WRITE_ONLY") {
    return { configured: isConfigured(value) };
  }
  return { value: sanitizeJson(value) };
}

export function sanitizeStoredConfigurationAuditSnapshot(
  key: ConfigurationKey,
  snapshot: Json,
): ConfigurationAuditSnapshot {
  if (
    snapshot !== null
    && typeof snapshot === "object"
    && !Array.isArray(snapshot)
    && "configured" in snapshot
  ) {
    return { configured: snapshot.configured === true };
  }
  if (
    snapshot !== null
    && typeof snapshot === "object"
    && !Array.isArray(snapshot)
    && "value" in snapshot
  ) {
    return sanitizeConfigurationAuditSnapshot(key, snapshot.value);
  }
  return sanitizeConfigurationAuditSnapshot(key, snapshot);
}

export function configurationValidationMessage(
  error: z.ZodError,
  fallback: string,
): string {
  return error.issues[0]?.message || fallback;
}
