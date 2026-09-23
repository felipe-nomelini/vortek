/** Utilitários de formatação de valores monetários e percentuais. */

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return currency.format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function parseBrazilianCurrency(value: string | undefined): number | null {
  const input = (value || '').trim().replace(/^R\$\s*/, '');
  if (!input) return null;
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(input)) return null;
  const parsed = Number(input.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function currencyFormatter(value: number | string | undefined | null,
  info?: { userTyping: boolean; input: string }): string {
  if (info?.userTyping) return info.input;
  if (value === undefined || value === null || value === '') return '';
  const [integer, fraction] = String(value).split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction === undefined ? '' : `,${fraction}`}`;
}

export function currencyParser(value: string | undefined): number {
  if (!value?.trim()) return '' as unknown as number; // InputNumber expects a number type, but clears on an empty parser result.
  return parseBrazilianCurrency(value) ?? Number.NaN;
}

export const currencyInputProps = {
  decimalSeparator: ',',
  formatter: currencyFormatter,
  parser: currencyParser,
};
