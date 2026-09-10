export const BNT_D01_FIXTURE_SOURCE = 'bnt_d01_production_clone';
export const BNT_D05_INVENTORY_FIXTURE_SOURCE = 'bnt_d05_inventory_mock';

const PRODUCTION_APP_HOSTS = new Set([
  'app.bentevi.shop',
  'app.vortek.shop',
]);

type FixtureRuntimeEnvironment = {
  VORTEK_RUNTIME_ENVIRONMENT?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

/**
 * Homologation fixtures are a local-development capability. Database flags alone
 * must never make synthetic records visible in a deployed production runtime.
 */
export function canUseHomologationFixtures(
  environment: FixtureRuntimeEnvironment = {
    VORTEK_RUNTIME_ENVIRONMENT: process.env.VORTEK_RUNTIME_ENVIRONMENT,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
): boolean {
  const runtime = String(environment.VORTEK_RUNTIME_ENVIRONMENT || '').trim().toLowerCase();
  if (runtime !== 'local_dev') return false;

  const configuredAppUrl = String(environment.NEXT_PUBLIC_APP_URL || '').trim();
  if (!configuredAppUrl) return true;

  try {
    const hostname = new URL(configuredAppUrl).hostname.toLowerCase();
    return !PRODUCTION_APP_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export const HOMOLOGATION_FIXTURE_READ_ONLY_ERROR = {
  error: 'Este pedido é uma amostra protegida de homologação e não permite ações operacionais.',
  code: 'homologation_fixture_read_only',
} as const;

export function isHomologationFixtureSource(value: unknown): boolean {
  return [BNT_D01_FIXTURE_SOURCE, BNT_D05_INVENTORY_FIXTURE_SOURCE]
    .includes(String(value || '').trim());
}

export function isHomologationFixtureId(value: unknown): boolean {
  return /^b17d01(?:01|02|03|04|05)/i.test(String(value || '').trim());
}
