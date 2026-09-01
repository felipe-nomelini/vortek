export const BNT_D01_FIXTURE_SOURCE = 'bnt_d01_production_clone';
export const BNT_D05_INVENTORY_FIXTURE_SOURCE = 'bnt_d05_inventory_mock';

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
