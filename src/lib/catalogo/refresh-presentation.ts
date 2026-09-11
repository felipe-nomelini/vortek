export type CatalogRefreshTone = 'info' | 'success' | 'warning' | 'error';

export type CatalogRefreshPresentation = {
  tone: CatalogRefreshTone;
  title: string;
  description: string;
  actionLabel?: string;
};

type CatalogRefreshInput = {
  status?: unknown;
  processed?: unknown;
  total?: unknown;
  detailsUnavailable?: unknown;
  competitionUnavailable?: unknown;
};

function count(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

export function presentCatalogRefresh(input: CatalogRefreshInput): CatalogRefreshPresentation {
  const status = String(input.status || '').trim().toLowerCase();
  const processed = count(input.processed);
  const total = count(input.total);
  const detailsUnavailable = count(input.detailsUnavailable);
  const competitionUnavailable = count(input.competitionUnavailable);
  const suffix = total > 0 ? ` ${processed.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} anúncios processados.` : '';

  if (status === 'pendente' || status === 'rodando' || status === 'on_hold') {
    return {
      tone: 'info',
      title: 'Atualizando o catálogo',
      description: `${suffix.trim() || 'A atualização está sendo preparada.'} Você pode continuar usando o sistema.`,
    };
  }

  if (status === 'completo') {
    return {
      tone: 'success',
      title: 'Catálogo atualizado',
      description: `${suffix.trim() || 'Todos os anúncios foram processados.'} Os dados já estão disponíveis para consulta.`,
    };
  }

  if (status === 'completo_parcial') {
    const issues = [
      detailsUnavailable > 0 ? `${detailsUnavailable.toLocaleString('pt-BR')} sem detalhes atualizados` : '',
      competitionUnavailable > 0 ? `${competitionUnavailable.toLocaleString('pt-BR')} sem informação de competição` : '',
    ].filter(Boolean).join(' e ');
    return {
      tone: 'warning',
      title: 'Catálogo atualizado com pendências',
      description: `${suffix.trim()}${issues ? ` Ficaram ${issues}.` : ' Alguns anúncios não puderam ser atualizados.'} Os dados anteriores foram preservados.`,
      actionLabel: 'Tentar novamente',
    };
  }

  if (status === 'cancelado') {
    return {
      tone: 'warning',
      title: 'Atualização interrompida',
      description: `${suffix.trim()} Os dados anteriores foram preservados.`,
      actionLabel: 'Tentar novamente',
    };
  }

  return {
    tone: 'error',
    title: 'Não foi possível atualizar o catálogo',
    description: `${suffix.trim()} Os dados anteriores foram preservados. Tente novamente; se o problema continuar, verifique a conexão com o Mercado Livre.`,
    actionLabel: 'Tentar novamente',
  };
}
