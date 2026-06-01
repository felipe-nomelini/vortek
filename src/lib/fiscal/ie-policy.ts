export type IePolicyResolved = 'contribuinte' | 'nao_contribuinte';

function normalizeTaxpayerTypeRaw(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseMlTaxpayerType(raw: string | null | undefined): IePolicyResolved | null {
  const normalized = normalizeTaxpayerTypeRaw(raw);
  if (!normalized) return null;
  if (normalized.includes('nao contribuinte') || normalized.includes('non_taxpayer')) {
    return 'nao_contribuinte';
  }
  if (normalized.includes('contribuinte') || normalized.includes('taxpayer')) {
    return 'contribuinte';
  }
  return null;
}

export function resolveDestIePolicy(params: {
  documento: string;
  billingIe: string | null | undefined;
  taxpayerTypeMlRaw?: string | null;
}): {
  isCnpj: boolean;
  iePresent: boolean;
  taxpayerTypeMlRaw: string | null;
  iePolicyResolved: IePolicyResolved;
  indicadorIe: 1 | 9;
  ieRequired: boolean;
} {
  const doc = String(params.documento || '').replace(/\D/g, '');
  const isCnpj = doc.length === 14;
  const billingIe = String(params.billingIe || '').trim();
  const iePresent = Boolean(billingIe);
  const taxpayerTypeMlRaw = String(params.taxpayerTypeMlRaw || '').trim() || null;
  const taxpayerTypePolicy = parseMlTaxpayerType(taxpayerTypeMlRaw);

  let iePolicyResolved: IePolicyResolved = 'nao_contribuinte';
  if (isCnpj) {
    if (iePresent) {
      iePolicyResolved = 'contribuinte';
    } else if (taxpayerTypePolicy === 'contribuinte') {
      iePolicyResolved = 'contribuinte';
    }
  }

  return {
    isCnpj,
    iePresent,
    taxpayerTypeMlRaw,
    iePolicyResolved,
    indicadorIe: iePolicyResolved === 'contribuinte' ? 1 : 9,
    ieRequired: isCnpj && iePolicyResolved === 'contribuinte',
  };
}

export function extractTaxpayerTypeFromBillingAddress(address: any): string | null {
  if (!address || typeof address !== 'object') return null;
  const value = String(
    address.taxpayer_type_ml_raw
      || address.taxpayer_type
      || '',
  ).trim();
  return value || null;
}
