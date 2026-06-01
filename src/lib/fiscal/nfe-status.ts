export type NfeTechnicalStatus =
  | 'autorizada'
  | 'cancelada'
  | 'pendente'
  | 'interrompida'
  | 'rejeitada'
  | 'processando'
  | 'outro';

function normalize(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeNfeTechnicalStatus(rawStatus: string | null | undefined): NfeTechnicalStatus {
  const status = normalize(rawStatus);
  if (!status) return 'pendente';
  if (status === 'authorized' || status === 'autorizada' || status.includes('autoriz')) return 'autorizada';
  if (status === 'cancelada' || status === 'cancelled' || status === 'canceled' || status.includes('cancel')) return 'cancelada';
  if (status === 'pendente' || status === 'pending') return 'pendente';
  if (status === 'interrupted' || status === 'interrompida' || status.includes('interrupt')) return 'interrompida';
  if (status === 'rejected' || status === 'rejeitada' || status === 'denegada' || status.includes('rejeit') || status.includes('deneg')) return 'rejeitada';
  if (status === 'processing' || status === 'processando' || status.includes('process')) return 'processando';
  return 'outro';
}

export function nfeTechnicalStatusLabel(status: NfeTechnicalStatus): string {
  const labels: Record<NfeTechnicalStatus, string> = {
    autorizada: 'Autorizada',
    cancelada: 'Cancelada',
    pendente: 'Pendente',
    interrompida: 'Interrompida',
    rejeitada: 'Rejeitada',
    processando: 'Processando',
    outro: 'Outro',
  };
  return labels[status];
}

export function nfeTechnicalStatusFilter(rawStatus: string | null | undefined, filter: NfeTechnicalStatus): boolean {
  return normalizeNfeTechnicalStatus(rawStatus) === filter;
}
