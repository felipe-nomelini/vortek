/** A kit without its own GTIN uses the category's official absence reason. */
export function kitGtinAbsenceReason(input: {
  kitStatus: string;
  productGtin: unknown;
  attribute: { id?: string; values?: Array<{ id: string; name: string }> };
}): { value_id: string; value_name: string } | null {
  if (input.kitStatus !== 'ready' || String(input.productGtin || '').trim()
    || input.attribute.id !== 'EMPTY_GTIN_REASON') return null;
  const option = input.attribute.values?.find(value => String(value.id) === '17055159');
  return option ? { value_id: String(option.id), value_name: String(option.name) } : null;
}
