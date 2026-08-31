export type NfeTechnicalStatus =
  | 'autorizada'
  | 'cancelada'
  | 'pendente'
  | 'interrompida'
  | 'rejeitada'
  | 'processando'
  | 'outro';

export type NfePersistedStatus =
  | 'authorized'
  | 'cancelled'
  | 'pending'
  | 'interrupted'
  | 'rejected'
  | 'denied'
  | 'processing'
  | 'not_found'
  | 'cancel_rejected_deadline'
  | 'other';

export const BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS = 'not_found';
export const NFE_CANCEL_REJECTED_DEADLINE_STATUS = 'cancel_rejected_deadline';

function normalize(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeNfePersistedStatus(
  rawStatus: string | null | undefined,
): NfePersistedStatus | null {
  const status = normalize(rawStatus);
  if (!status) return null;
  if (status === NFE_CANCEL_REJECTED_DEADLINE_STATUS) return status;
  if (status === BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS) return status;
  if (status === 'authorized' || status === 'autorizada' || status === 'autorizado') return 'authorized';
  if (
    status === 'cancelled'
    || status === 'canceled'
    || status === 'cancelada'
    || status === 'cancelado'
  ) return 'cancelled';
  if (status === 'pending' || status === 'pendente') return 'pending';
  if (status === 'interrupted' || status === 'interrompida' || status === 'interrompido') return 'interrupted';
  if (status === 'rejected' || status === 'rejeitada' || status === 'rejeitado') return 'rejected';
  if (status === 'denied' || status === 'denegada' || status === 'denegado') return 'denied';
  if (status === 'processing' || status === 'processando') return 'processing';
  if (status === 'other' || status === 'outro') return 'other';
  return 'other';
}

export function normalizeNfeTechnicalStatus(
  rawStatus: string | null | undefined,
): NfeTechnicalStatus {
  const status = normalizeNfePersistedStatus(rawStatus);
  if (!status || status === 'pending') return 'pendente';
  if (status === 'authorized' || status === NFE_CANCEL_REJECTED_DEADLINE_STATUS) return 'autorizada';
  if (status === 'cancelled') return 'cancelada';
  if (status === 'interrupted') return 'interrompida';
  if (status === 'rejected' || status === 'denied') return 'rejeitada';
  if (status === 'processing') return 'processando';
  return 'outro';
}

export function isNfeAuthorizedStatus(rawStatus: string | null | undefined): boolean {
  const status = normalizeNfePersistedStatus(rawStatus);
  return status === 'authorized' || status === NFE_CANCEL_REJECTED_DEADLINE_STATUS;
}

export function isNfeCancelledStatus(rawStatus: string | null | undefined): boolean {
  return normalizeNfePersistedStatus(rawStatus) === 'cancelled';
}

export function isNfeCancelRejectedDeadlineStatus(
  rawStatus: string | null | undefined,
): boolean {
  return normalizeNfePersistedStatus(rawStatus) === NFE_CANCEL_REJECTED_DEADLINE_STATUS;
}

export function isNfeFinalPersistedStatus(rawStatus: string | null | undefined): boolean {
  const status = normalizeNfePersistedStatus(rawStatus);
  return status === 'cancelled'
    || status === 'rejected'
    || status === 'denied'
    || status === NFE_CANCEL_REJECTED_DEADLINE_STATUS;
}

export function resolveReconciledNfePersistedStatus(
  currentStatus: string | null | undefined,
  observedStatus: NfePersistedStatus,
): NfePersistedStatus {
  const current = normalizeNfePersistedStatus(currentStatus);
  if (
    current === NFE_CANCEL_REJECTED_DEADLINE_STATUS
    && (observedStatus === 'authorized' || observedStatus === 'other')
  ) {
    return current;
  }
  return observedStatus;
}

export function mapBrasilNfeSearchStatusToPersistedStatus(
  value: number | null | undefined,
): NfePersistedStatus | null {
  const status = Number(value);
  if (status === 1) return 'authorized';
  if (status === 2) return 'cancelled';
  if (status === 3) return 'denied';
  return null;
}

export function nfePersistedStatusesForTechnicalStatus(
  status: NfeTechnicalStatus,
): readonly NfePersistedStatus[] {
  const statuses: Record<NfeTechnicalStatus, readonly NfePersistedStatus[]> = {
    autorizada: ['authorized', NFE_CANCEL_REJECTED_DEADLINE_STATUS],
    cancelada: ['cancelled'],
    pendente: ['pending'],
    interrompida: ['interrupted'],
    rejeitada: ['rejected', 'denied'],
    processando: ['processing'],
    outro: [BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS, 'other'],
  };
  return statuses[status];
}

export function isBrasilNfeAutomaticReconciliationEligible(
  rawStatus: string | null | undefined,
): boolean {
  return normalize(rawStatus) !== BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS;
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
