import { z } from "zod";
import type { Json } from "@/types/database";
import { isValidCnpj, normalizeCnpj } from "../fiscal/cnpj.js";

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
  "empresa.nome": { domain: "empresa_fiscal", label: "Nome da empresa", classification: "EDITAVEL_IMEDIATO" },
  "empresa.nickname": { domain: "empresa_fiscal", label: "Nickname Mercado Livre", classification: "STATUS_SOMENTE_LEITURA" },
  "empresa.cnpj": { domain: "empresa_fiscal", label: "CNPJ", classification: "EDITAVEL_CONTROLADO" },
  "empresa.endereco": { domain: "empresa_fiscal", label: "Endereço legado", classification: "OBSOLETO" },
  "empresa.endereco_fiscal": { domain: "empresa_fiscal", label: "Endereço fiscal", classification: "EDITAVEL_CONTROLADO" },
  "empresa.email": { domain: "empresa_fiscal", label: "E-mail", classification: "EDITAVEL_IMEDIATO" },
  "empresa.telefone": { domain: "empresa_fiscal", label: "Telefone", classification: "EDITAVEL_IMEDIATO" },
  "empresa.uf_fiscal": { domain: "empresa_fiscal", label: "UF fiscal", classification: "EDITAVEL_CONTROLADO" },
  "empresa.cod_municipio_fiscal": { domain: "empresa_fiscal", label: "Município fiscal", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.margem_lucro": { domain: "comercial_precificacao", label: "Margem de lucro padrão legada", classification: "OBSOLETO" },
  "configuracoes.pricing_ml_fee_fallback_rate": { domain: "comercial_precificacao", label: "Taxa fallback do Mercado Livre", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.pricing_unspecified_shipping_cost": { domain: "comercial_precificacao", label: "Frete quando não informado", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.product_inactive_cost_threshold": { domain: "comercial_precificacao", label: "Limite de custo para inativação", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.order_operational_delay_minutes": { domain: "produtos_estoque_fulfillment", label: "Prazo de atenção operacional", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.internal_stock_return_address": { domain: "produtos_estoque_fulfillment", label: "Endereço do estoque interno", classification: "EDITAVEL_CONTROLADO" },
  "fornecedores.dslite_catalog_xml_url": { domain: "produtos_estoque_fulfillment", label: "Feed XML do fornecedor", classification: "SECRET_WRITE_ONLY" },
  "fornecedores.dropshipping_retired_at": { domain: "produtos_estoque_fulfillment", label: "Aposentadoria do fornecedor", classification: "STATUS_SOMENTE_LEITURA" },
  "pricing_cost_tiers.policy": { domain: "comercial_precificacao", label: "Faixas de custo, margem e lucro mínimo", classification: "EDITAVEL_CONTROLADO" },
  "ml_quantity_pricing_tiers.policy": { domain: "comercial_precificacao", label: "Faixas de preço por quantidade", classification: "EDITAVEL_CONTROLADO" },
  "configuracoes.notificacoes_push": { domain: "notificacoes", label: "Notificações push", classification: "EDITAVEL_IMEDIATO" },
  "configuracoes.nfe_provider_default": { domain: "empresa_fiscal", label: "Provedor fiscal", classification: "INVARIANTE" },
  "configuracoes.simples_inicio_atividade": { domain: "empresa_fiscal", label: "Início da atividade", classification: "EDITAVEL_CONTROLADO" },
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

const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
] as const;

const IBGE_STATE_PREFIX: Record<(typeof BRAZILIAN_STATES)[number], string> = {
  AC: "12", AL: "27", AP: "16", AM: "13", BA: "29", CE: "23", DF: "53",
  ES: "32", GO: "52", MA: "21", MT: "51", MS: "50", MG: "31", PA: "15",
  PB: "25", PR: "41", PE: "26", PI: "22", RJ: "33", RN: "24", RS: "43",
  RO: "11", RR: "14", SC: "42", SP: "35", SE: "28", TO: "17",
};

export const companyAddressSchema = z.object({
  cep: z.string().trim().regex(/^\d{8}$/, "CEP inválido. Use 8 dígitos."),
  logradouro: z.string().trim().min(1, "Informe o logradouro").max(200),
  numero: z.string().trim().min(1, "Informe o número ou S/N").max(30),
  complemento: z.string().trim().max(120),
  bairro: z.string().trim().min(1, "Informe o bairro").max(120),
  municipio: z.string().trim().min(1, "Informe o município").max(120),
  uf: z.enum(BRAZILIAN_STATES, { message: "UF fiscal inválida" }),
  codigo_ibge: z.string().trim().regex(/^\d{7}$/, "Código do município inválido. Use 7 dígitos."),
}).strict().refine(
  (address) => address.codigo_ibge.startsWith(IBGE_STATE_PREFIX[address.uf]),
  { message: "O código do município não pertence à UF selecionada", path: ["codigo_ibge"] },
);

export const companyConfigurationSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome da empresa").max(200),
  cnpj: z.string().trim().max(32)
    .refine(isValidCnpj, "CNPJ inválido")
    .transform(normalizeCnpj),
  email: optionalCompanyEmailSchema,
  telefone: z.string().trim().max(40),
  endereco_fiscal: companyAddressSchema,
}).strict();

export const preferencesConfigurationSchema = z.object({
  notificacoes_push: z.boolean(),
}).strict();

const costTierSchema = z.object({
  position: z.number().int().min(1).max(3),
  maxCost: z.number().finite().positive().nullable(),
  marginPercent: z.number().finite().gt(0).lt(100),
  minProfit: z.number().finite().min(0).max(10_000_000),
}).strict();

const quantityPricingTierSchema = z.object({
  position: z.number().int().min(1).max(5),
  minPurchaseUnit: z.number().int().min(1).max(100),
  discountPercent: z.number().finite().gt(0).lt(100),
}).strict();

export const commercialConfigurationSchema = z.object({
  mlFeeFallbackPercent: z.number().finite().min(0).lt(100),
  unspecifiedShippingCost: z.number().finite().min(0).max(10_000_000),
  inactiveCostThreshold: z.number().finite().positive().max(10_000_000),
  costTiers: z.array(costTierSchema).length(3),
  quantityPricingTiers: z.array(quantityPricingTierSchema).min(1).max(5),
}).strict().superRefine((value, context) => {
  const orderedCostTiers = [...value.costTiers].sort((left, right) => left.position - right.position);
  let previousMax = 0;
  orderedCostTiers.forEach((tier, index) => {
    if (tier.position !== index + 1) {
      context.addIssue({ code: "custom", path: ["costTiers", index, "position"], message: "As faixas de custo devem ter posições sequenciais" });
    }
    if (index === orderedCostTiers.length - 1) {
      if (tier.maxCost !== null) context.addIssue({ code: "custom", path: ["costTiers", index, "maxCost"], message: "A última faixa de custo deve ser ilimitada" });
    } else if (tier.maxCost === null || tier.maxCost <= previousMax) {
      context.addIssue({ code: "custom", path: ["costTiers", index, "maxCost"], message: "Os limites de custo devem ser crescentes" });
    } else {
      previousMax = tier.maxCost;
    }
    const totalRate = (tier.marginPercent + value.mlFeeFallbackPercent) / 100;
    if (totalRate >= 1) {
      context.addIssue({ code: "custom", path: ["costTiers", index, "marginPercent"], message: "Margem e taxa fallback do ML devem somar menos de 100%" });
    }
  });

  const orderedQuantityTiers = [...value.quantityPricingTiers].sort((left, right) => left.position - right.position);
  let previousQuantity = 0;
  let previousDiscount = 0;
  orderedQuantityTiers.forEach((tier, index) => {
    if (tier.position !== index + 1) {
      context.addIssue({ code: "custom", path: ["quantityPricingTiers", index, "position"], message: "As faixas por quantidade devem ter posições sequenciais" });
    }
    if (tier.minPurchaseUnit <= previousQuantity) {
      context.addIssue({ code: "custom", path: ["quantityPricingTiers", index, "minPurchaseUnit"], message: "As quantidades devem ser únicas e crescentes" });
    }
    if (tier.discountPercent <= previousDiscount) {
      context.addIssue({ code: "custom", path: ["quantityPricingTiers", index, "discountPercent"], message: "Os descontos devem ser crescentes" });
    }
    previousQuantity = tier.minPurchaseUnit;
    previousDiscount = tier.discountPercent;
  });
});

export type CommercialConfigurationInput = z.infer<typeof commercialConfigurationSchema>;

const dsliteXmlFeedUrlSchema = z.string().trim().max(2048).superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.hostname !== "app.dslite.com.br"
      || !url.pathname.startsWith("/getXMLCrossdocking/")
    ) {
      context.addIssue({ code: "custom", message: "Informe uma URL HTTPS válida do feed Crossdocking da DSLite" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "URL do feed XML inválida" });
  }
});

export const operationConfigurationPatchSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("orders"),
    delayedAfterMinutes: z.number().int().min(5).max(1440),
  }).strict(),
  z.object({
    section: z.literal("internal_stock"),
    returnAddressId: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    section: z.literal("supplier_feed"),
    supplierId: z.string().uuid("Fornecedor inválido"),
    xmlUrl: z.union([z.literal(""), dsliteXmlFeedUrlSchema, z.null()]),
  }).strict(),
]);

export type OperationConfigurationPatch = z.infer<typeof operationConfigurationPatchSchema>;

export const fiscalConfigurationSchema = z.object({
  simples_inicio_atividade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida"),
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
).refine(
  (value) => value.simples_inicio_atividade <= new Date().toISOString().slice(0, 10),
  { message: "O início da atividade não pode estar no futuro" },
).refine(
  (value) => !value.simples_aliquota_confirmada_em
    || value.simples_aliquota_confirmada_em >= value.simples_inicio_atividade,
  { message: "A confirmação do PGDAS não pode ser anterior ao início da atividade" },
);

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
