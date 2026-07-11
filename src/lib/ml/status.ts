export type LocalMlStatus = 'ativo' | 'pausado' | 'sem_anuncio';

export function mapMlStatusToLocalStatus(value: unknown): LocalMlStatus {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'sem_anuncio';
  if (raw === 'active') return 'ativo';
  return 'pausado';
}
