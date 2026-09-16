import { buildBrandEquivalences, type BrandEquivalences } from '@/lib/ml-listing-identity';

export { brandKey, equivalentBrandKey } from '@/lib/ml-listing-identity';
export type { BrandEquivalences } from '@/lib/ml-listing-identity';

export async function loadMlBrandEquivalences(client: { from: (table: string) => any }): Promise<BrandEquivalences> {
  const { data, error } = await client.from('ml_brand_equivalences')
    .select('brand_a_key,brand_b_key').eq('active', true);
  if (error) throw new Error(`ml_brand_equivalences_read_failed: ${error.message}`);
  return buildBrandEquivalences(data || []);
}
