/** Extrai token Bearer estrito. Retorna null para formatos ambíguos. */
export function parseBearerToken(value: string | null): string | null {
  if (!value) return null;

  const match = /^Bearer ([^\s]+)$/i.exec(value.trim());
  return match?.[1] || null;
}
