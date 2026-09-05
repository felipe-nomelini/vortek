import { configured, integrationUrlAllowed, resolveIntegrationConfiguration, type IntegrationEnvironment, type CredentialOrigin } from "./integration-configuration";

export type IntegrationConfigDto = {
  tipo: string;
  client_id: string | null;
  redirect_uri: string | null;
  url: string | null;
  conectado: boolean;
  last_refresh_error: string | null;
  last_refresh_error_code: string | null;
  token_expires_at: string | null;
  updated_at: string | null;
  client_secret_configurado: boolean;
  access_token_configurado: boolean;
  refresh_token_configurado: boolean;
  effective: { tokenConfigured: boolean; userTokenConfigured: boolean; url: string | null; tokenOrigin: CredentialOrigin; userTokenOrigin: CredentialOrigin; urlOrigin: CredentialOrigin };
  runtime: { tokenConfigured: boolean; userTokenConfigured: boolean };
  fiscalEnvironment: string | null;
  returnEnvironment: string | null;
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isConfigured(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function toIntegrationConfigDto(
  row: Record<string, unknown>,
  env: IntegrationEnvironment = {},
): IntegrationConfigDto {
  const tipo = String(row.tipo || "");
  const effective = resolveIntegrationConfiguration(tipo, row, env);
  const safeUrl = (value: unknown) => typeof value === "string" && integrationUrlAllowed(tipo, value) ? value : null;
  const runtime = resolveIntegrationConfiguration(tipo, {}, env);
  const fiscalEnvironment = (value: string | undefined) => value === "1" ? "Produção" : value === "2" ? "Homologação" : "Não informado";
  return {
    tipo: String(row.tipo || ""),
    client_id: nullableString(row.client_id),
    redirect_uri: null,
    url: safeUrl(row.url),
    conectado: Boolean(row.conectado),
    last_refresh_error: row.last_refresh_error ? "Falha registrada; consulte a área responsável pela integração." : null,
    last_refresh_error_code: row.last_refresh_error_code ? "refresh_failed" : null,
    token_expires_at: nullableString(row.token_expires_at),
    updated_at: nullableString(row.updated_at),
    client_secret_configurado: isConfigured(row.client_secret),
    access_token_configurado: isConfigured(row.access_token),
    refresh_token_configurado: isConfigured(row.refresh_token),
    effective: { tokenConfigured: configured(effective.token.value), userTokenConfigured: configured(effective.userToken.value), url: safeUrl(effective.url.value), tokenOrigin: effective.token.origin, userTokenOrigin: effective.userToken.origin, urlOrigin: effective.url.origin },
    runtime: { tokenConfigured: runtime.token.origin === "runtime", userTokenConfigured: runtime.userToken.origin === "runtime" },
    fiscalEnvironment: tipo === "brasilnfe" ? fiscalEnvironment(env.BRASILNFE_TIPO_AMBIENTE) : null,
    returnEnvironment: tipo === "brasilnfe" ? fiscalEnvironment(env.BRASILNFE_RETURN_TIPO_AMBIENTE) : null,
  };
}
