export type DsliteCreatePayloadClassification = {
  accepted: boolean;
  lockTimeout: boolean;
  dsid: number | null;
  nfeKey: string | null;
};

export function isDsliteCreatedOrderVerified(
  payload: unknown,
  expectedDsid: string | number,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const actualDsid = String((payload as { dsid?: unknown }).dsid ?? '').trim();
  return actualDsid.length > 0 && actualDsid === String(expectedDsid).trim();
}

export function isDsliteLockWaitTimeout(payload: unknown): boolean {
  const normalized = JSON.stringify(payload || {}).toLowerCase();
  return normalized.includes('lock wait timeout exceeded')
    || (normalized.includes('sqlstate[hy000]') && normalized.includes('1205'));
}

export function classifyDsliteCreatePayload(
  payload: unknown,
): DsliteCreatePayloadClassification {
  const body = payload && typeof payload === 'object'
    ? payload as {
        sucesso?: unknown;
        erros?: unknown;
        logs?: Array<{ dsid?: unknown; chave_acesso?: unknown }>;
      }
    : null;
  const logs = Array.isArray(body?.logs) ? body.logs : [];
  const dsidRaw = logs.find((log) => String(log?.dsid ?? '').trim())?.dsid;
  const parsedDsid = Number(dsidRaw);
  const nfeKey = logs
    .map((log) => String(log?.chave_acesso ?? '').replace(/\D/g, ''))
    .find((key) => key.length === 44) || null;

  return {
    accepted: Number(body?.sucesso) > 0 && Number(body?.erros) === 0,
    lockTimeout: isDsliteLockWaitTimeout(payload),
    dsid: Number.isFinite(parsedDsid) && parsedDsid > 0 ? parsedDsid : null,
    nfeKey,
  };
}

export function extractDsliteNfeKeyFromXml(xml: string): string | null {
  const chNfe = xml.match(/<(?:\w+:)?chNFe>\s*(\d{44})\s*<\/(?:\w+:)?chNFe>/i)?.[1];
  if (chNfe) return chNfe;

  return xml.match(/\bId=["']NFe(\d{44})["']/i)?.[1] || null;
}
