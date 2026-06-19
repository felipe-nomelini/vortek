const SUPPLIER_PIX_KEYS_BY_DSLITE_ID: Record<string, string> = {
  '39': '11940733061',
};

export function getSupplierPixKey(fornecedorId: string | number | null | undefined): string | null {
  const id = String(fornecedorId || '').trim();
  return SUPPLIER_PIX_KEYS_BY_DSLITE_ID[id] || null;
}
