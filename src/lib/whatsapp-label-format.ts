import { isBkr1Supplier, isMksSupplier } from '@/lib/supplier-balance';

export type WhatsappLabelFormat = {
  responseType: 'pdf' | 'zpl2';
  extension: 'pdf' | 'zpl';
  mimetype: 'application/pdf' | 'text/plain';
  thermal: boolean;
};

export function resolveWhatsappLabelFormat(input: {
  fornecedorId: string | number | null | undefined;
  fornecedorNome?: string | null;
  usePlaceholderLabel?: boolean;
}): WhatsappLabelFormat {
  const thermal = !input.usePlaceholderLabel
    && (isBkr1Supplier(input.fornecedorId, input.fornecedorNome)
      || isMksSupplier(input.fornecedorId, input.fornecedorNome));

  return thermal
    ? {
        responseType: 'zpl2',
        extension: 'zpl',
        mimetype: 'text/plain',
        thermal: true,
      }
    : {
        responseType: 'pdf',
        extension: 'pdf',
        mimetype: 'application/pdf',
        thermal: false,
      };
}
