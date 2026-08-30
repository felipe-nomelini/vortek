export function selectBrasilNfeNoteByInternalIdentifier(
  notas: any[],
  identificadorInterno: string,
  preferAuthorized = true,
): any | null {
  const expected = String(identificadorInterno || '').trim();
  if (!expected) return null;

  const exactMatches = (Array.isArray(notas) ? notas : []).filter((nota: any) =>
    String(nota?.IdentificadorInterno || '').trim() === expected
    && String(nota?.Chave || '').trim(),
  );
  if (!exactMatches.length) return null;

  const isAuthorizedNota = (nota: any): boolean => {
    const numericCandidates = [
      nota?.Status,
      nota?.CodStatus,
      nota?.CodStatusRespostaSefaz,
      nota?.CodStatusSefaz,
    ];
    const hasAuthorizedCode = numericCandidates.some((value: any) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && [100, 150].includes(numeric);
    });
    if (hasAuthorizedCode) return true;

    return [
      nota?.DsStatus,
      nota?.DsSituacao,
      nota?.Situacao,
      nota?.StatusDescricao,
      nota?.DescricaoStatus,
      nota?.DsStatusRespostaSefaz,
    ].some((value: any) => String(value || '').toLowerCase().includes('autoriz'));
  };

  return exactMatches.sort((a: any, b: any) => {
    if (preferAuthorized) {
      const authorizedDifference = Number(isAuthorizedNota(b)) - Number(isAuthorizedNota(a));
      if (authorizedDifference) return authorizedDifference;
    }
    const aDate = new Date(String(a?.DtEmissao || a?.DtRecebimento || 0)).getTime();
    const bDate = new Date(String(b?.DtEmissao || b?.DtRecebimento || 0)).getTime();
    return bDate - aDate;
  })[0] || null;
}

export type BrasilNfeIdentifierLookupOutcome =
  | { kind: 'found'; nota: any; error: null }
  | { kind: 'not_found'; nota: null; error: string }
  | { kind: 'transient_error'; nota: null; error: string };

export function buildBrasilNfeIdentifierLookupPayload(input: {
  identificadorInterno: string;
  dtInicio: string;
  dtFim: string;
}) {
  return {
    TipoDocumentoFiscal: 1,
    DtInicio: input.dtInicio,
    DtFim: input.dtFim,
    IdentificadorInterno: input.identificadorInterno,
  };
}

export function classifyBrasilNfeIdentifierLookupResponse(input: {
  response: any;
  identificadorInterno: string;
  preferAuthorized?: boolean;
}): BrasilNfeIdentifierLookupOutcome {
  const providerError = String(input.response?.Error || '').trim();
  if (providerError) {
    return {
      kind: 'transient_error',
      nota: null,
      error: providerError,
    };
  }

  const notas = Array.isArray(input.response?.Notas)
    ? input.response.Notas
    : [];
  if (!notas.length) {
    return {
      kind: 'not_found',
      nota: null,
      error: 'NF não encontrada por identificador interno',
    };
  }

  const expectedIdentifier = String(input.identificadorInterno || '').trim();
  const exactMatch = notas.find(
    (nota: any) =>
      String(nota?.IdentificadorInterno || '').trim() === expectedIdentifier,
  );
  if (!exactMatch) {
    return {
      kind: 'not_found',
      nota: null,
      error: `Brasil NFe não retornou correspondência exata para o identificador interno ${expectedIdentifier}`,
    };
  }

  const selected = selectBrasilNfeNoteByInternalIdentifier(
    notas,
    expectedIdentifier,
    input.preferAuthorized !== false,
  );
  if (!selected) {
    return {
      kind: 'transient_error',
      nota: null,
      error: `Brasil NFe retornou a nota ${expectedIdentifier} sem chave fiscal`,
    };
  }

  return { kind: 'found', nota: selected, error: null };
}

export function resolveBrasilNfeInternalIdentifier(input: {
  identifierOverride?: string | null;
  pedidoNumero?: string | number | null;
  pedidoId: string;
  mlPackId?: string | null;
  mlBundleType?: string | null;
}): string {
  const override = String(input.identifierOverride || '').trim();
  if (override) return override;

  const packId = String(input.mlPackId || '').trim();
  const bundleType = String(input.mlBundleType || '').trim().toLowerCase();
  if (packId && bundleType === 'cart') return `VORTEK-PACK-${packId}`;
  if (packId && bundleType === 'virtual_kit') return `VORTEK-KIT-${packId}`;

  return `VORTEK-${String(input.pedidoNumero || input.pedidoId)}`;
}
