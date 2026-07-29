export type LocalMlStatus = 'ativo' | 'pausado' | 'sem_anuncio';

export function mapMlStatusToLocalStatus(value: unknown): LocalMlStatus {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'sem_anuncio';
  if (raw === 'active') return 'ativo';
  return 'pausado';
}

export function mapCreatedListingDesiredStatus(item: {
  status?: unknown;
  sub_status?: unknown;
}): Exclude<LocalMlStatus, 'sem_anuncio'> {
  const observedStatus = mapMlStatusToLocalStatus(item?.status);
  const subStatuses = Array.isArray(item?.sub_status)
    ? item.sub_status.map((value) => String(value))
    : [];

  if (
    observedStatus === 'pausado' &&
    subStatuses.includes('picture_download_pending')
  ) {
    return 'ativo';
  }

  return observedStatus === 'ativo' ? 'ativo' : 'pausado';
}
