export const DSLITE_PROTECTED_EXISTING_LABEL_EVENT =
  'ml_label_replacement_skipped_protected_order' as const;

export function isDslitePlaceholderLabelSource(value: unknown): boolean {
  return String(value || '').trim().startsWith('placeholder_release_window');
}

export type DsliteLabelPresentation = {
  label: 'real' | 'genérica' | 'própria DSLite' | 'não enviada' | 'falha' | 'não identificada';
  showWhatsapp: boolean;
  whatsappLabel: 'Enviado' | 'Não enviado' | null;
};

export function resolveDsliteLabelPresentation(input: {
  labelSource?: unknown;
  operationalStatus?: unknown;
  whatsappStatus?: unknown;
}): DsliteLabelPresentation {
  const labelSource = String(input.labelSource || '').trim();
  const operationalStatus = String(input.operationalStatus || '').trim();
  const whatsappLabel = input.whatsappStatus === 'sent' ? 'Enviado' : 'Não enviado';
  const usesGenericLabel = isDslitePlaceholderLabelSource(labelSource)
    || operationalStatus === 'generic_sent'
    || operationalStatus === 'protected_existing';

  if (usesGenericLabel) {
    return { label: 'genérica', showWhatsapp: true, whatsappLabel };
  }
  if (labelSource === 'dslite_paid_shipping' || operationalStatus === 'provider_shipping') {
    return { label: 'própria DSLite', showWhatsapp: false, whatsappLabel: null };
  }
  if (labelSource === 'mercado_livre' || operationalStatus === 'real_sent') {
    return { label: 'real', showWhatsapp: false, whatsappLabel: null };
  }
  if (operationalStatus === 'failed') {
    return { label: 'falha', showWhatsapp: false, whatsappLabel: null };
  }
  if (operationalStatus === 'pending') {
    return { label: 'não enviada', showWhatsapp: false, whatsappLabel: null };
  }
  return { label: 'não identificada', showWhatsapp: false, whatsappLabel: null };
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
