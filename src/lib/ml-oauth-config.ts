export function getMercadoLivreAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error('NEXT_PUBLIC_APP_URL não configurada para o OAuth do Mercado Livre');
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('NEXT_PUBLIC_APP_URL deve usar HTTPS no OAuth do Mercado Livre');
  return url.toString().replace(/\/+$/, '');
}

export function getMercadoLivreRedirectUri() {
  return `${getMercadoLivreAppUrl()}/api/integracao/ml/callback`;
}
