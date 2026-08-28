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
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isConfigured(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function toIntegrationConfigDto(
  row: Record<string, unknown>,
): IntegrationConfigDto {
  return {
    tipo: String(row.tipo || ""),
    client_id: nullableString(row.client_id),
    redirect_uri: nullableString(row.redirect_uri),
    url: nullableString(row.url),
    conectado: Boolean(row.conectado),
    last_refresh_error: nullableString(row.last_refresh_error),
    last_refresh_error_code: nullableString(row.last_refresh_error_code),
    token_expires_at: nullableString(row.token_expires_at),
    updated_at: nullableString(row.updated_at),
    client_secret_configurado: isConfigured(row.client_secret),
    access_token_configurado: isConfigured(row.access_token),
    refresh_token_configurado: isConfigured(row.refresh_token),
  };
}
