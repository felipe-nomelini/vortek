import { isDslitePlaceholderLabelSource } from './label-state';

export function clearSupplierLabelState() {
  return {
    label_type: null,
    label_delivery_channel: null,
    label_delivered_at: null,
  } as const;
}

export function supplierDsliteLabelState(source: unknown, deliveredAt: string) {
  if (isDslitePlaceholderLabelSource(source)) {
    return {
      label_type: 'provisional',
      label_delivery_channel: 'dslite',
      label_delivered_at: null,
    } as const;
  }
  if (source === 'mercado_livre') {
    return {
      label_type: 'real',
      label_delivery_channel: 'dslite',
      label_delivered_at: deliveredAt,
    } as const;
  }
  return clearSupplierLabelState();
}

export function supplierWhatsappLabelState(deliveredAt: string) {
  return {
    label_type: 'real',
    label_delivery_channel: 'whatsapp',
    label_delivered_at: deliveredAt,
  } as const;
}
