const DEFAULT_APP_URL = 'https://app.vortek.shop';

export function getMercadoLivreRedirectUri() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
  return `${appUrl}/api/integracao/ml/callback`;
}

