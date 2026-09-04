import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type ServiceClient = SupabaseClient<Database>;

export const CONFIGURATION_ROW_ID = '00000000-0000-0000-0000-000000000001';

export type OperationRuntimeConfiguration = {
  delayedAfterMinutes: number;
  returnAddress: { addressId: string | null; zipCode: string | null };
};

export async function loadOperationRuntimeConfiguration(
  client: ServiceClient,
): Promise<OperationRuntimeConfiguration> {
  const { data, error } = await client
    .from('configuracoes')
    .select('order_operational_delay_minutes,internal_stock_return_address_id,internal_stock_return_zip_code')
    .eq('id', CONFIGURATION_ROW_ID)
    .single();
  if (error) throw new Error(`Falha ao carregar configuração operacional: ${error.message}`);
  return {
    delayedAfterMinutes: data.order_operational_delay_minutes,
    returnAddress: {
      addressId: data.internal_stock_return_address_id,
      zipCode: data.internal_stock_return_zip_code,
    },
  };
}
