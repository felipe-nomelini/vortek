const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatCurrency(value: number): string {
  return currency.format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function currencyFormatter(v: number | string | undefined | null): string {
  if (v === undefined || v === null) return '';
  const num = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(num)) return '';
  return currency.format(num);
}

export function currencyParser(value: string | undefined): number {
  if (!value) return 0;
  return parseFloat(value.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.'));
}
