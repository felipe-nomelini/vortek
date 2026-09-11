export const DSLITE_PROTECTED_EXISTING_LABEL_EVENT =
  'ml_label_replacement_skipped_protected_order' as const;

export function isDslitePlaceholderLabelSource(value: unknown): boolean {
  return String(value || '').trim().startsWith('placeholder_release_window');
}

export function isDsliteProtectedExistingLabelError(input: {
  status?: number | null;
  message?: unknown;
}): boolean {
  const message = String(input.message || '').trim().toLowerCase();
  const hasProtectedOrderMessage = message.includes('etiqueta')
    && message.includes('status protegido')
    && message.includes('administrador');
  const hasForbiddenStatus = input.status === 403 || message.includes('http 403');
  return hasForbiddenStatus && hasProtectedOrderMessage;
}
