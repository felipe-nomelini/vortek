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
