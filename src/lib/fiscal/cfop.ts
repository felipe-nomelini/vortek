export const ALLOWED_CFOP_DSLITE = ['5120', '6120'] as const;

type AllowedCfopDslite = typeof ALLOWED_CFOP_DSLITE[number];

const ALLOWED_SET = new Set<string>(ALLOWED_CFOP_DSLITE);

export interface CfopValidationResult {
  ok: boolean;
  cfopsDetectados: string[];
  cfopsInvalidos: string[];
  cfopAusente: boolean;
  ufAusente: boolean;
  cfopEsperado: AllowedCfopDslite | null;
  cfopDivergenteDaRegraUf: boolean;
  motivo: 'ok' | 'cfop_ausente' | 'uf_ausente' | 'cfop_invalido' | 'cfop_divergente_regra_uf';
}

export function extractCfopsFromXml(xml: string): string[] {
  try {
    return [...xml.matchAll(/<CFOP>([^<]+)<\/CFOP>/g)]
      .map((m) => String(m[1] || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function extractEmitDestUfFromXml(xml: string): { emitUf: string | null; destUf: string | null } {
  try {
    const emitUf = xml.match(/<emit>[\s\S]*?<enderEmit>[\s\S]*?<UF>([^<]+)<\/UF>/)?.[1]?.trim()?.toUpperCase() || null;
    const destUf = xml.match(/<dest>[\s\S]*?<enderDest>[\s\S]*?<UF>([^<]+)<\/UF>/)?.[1]?.trim()?.toUpperCase() || null;
    return { emitUf, destUf };
  } catch {
    return { emitUf: null, destUf: null };
  }
}

export function getExpectedCfopByUf(emitUf: string | null | undefined, destUf: string | null | undefined): AllowedCfopDslite | null {
  if (!emitUf || !destUf) return null;
  return emitUf.trim().toUpperCase() === destUf.trim().toUpperCase() ? '5120' : '6120';
}

export function validateCfopForDslite(
  cfops: string[],
  emitUf: string | null | undefined,
  destUf: string | null | undefined,
): CfopValidationResult {
  const cfopsDetectados = cfops.map((c) => String(c || '').trim()).filter(Boolean);
  const cfopsInvalidos = cfopsDetectados.filter((cfop) => !ALLOWED_SET.has(cfop));
  const cfopAusente = cfopsDetectados.length === 0;
  const ufAusente = !emitUf || !destUf;
  const cfopEsperado = getExpectedCfopByUf(emitUf, destUf);
  const cfopDivergenteDaRegraUf = !!cfopEsperado && cfopsDetectados.some((cfop) => cfop !== cfopEsperado);

  let motivo: CfopValidationResult['motivo'] = 'ok';
  if (cfopAusente) motivo = 'cfop_ausente';
  else if (ufAusente) motivo = 'uf_ausente';
  else if (cfopsInvalidos.length > 0) motivo = 'cfop_invalido';
  else if (cfopDivergenteDaRegraUf) motivo = 'cfop_divergente_regra_uf';

  const ok = !(cfopAusente || ufAusente || cfopsInvalidos.length > 0 || cfopDivergenteDaRegraUf);

  return {
    ok,
    cfopsDetectados,
    cfopsInvalidos,
    cfopAusente,
    ufAusente,
    cfopEsperado,
    cfopDivergenteDaRegraUf,
    motivo,
  };
}
