import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { CONFIGURATION_ROW_ID } from '@/services/operation-configuration';
import {
  ML_WARRANTY_TYPE_NAMES,
  type MlWarrantyConfiguration,
  type MlWarrantyTypeId,
  type MlWarrantyUnit,
} from '@/lib/ml-sale-terms';

type ServiceClient = SupabaseClient<Database>;

export async function loadMercadoLivreConfiguration(client: ServiceClient): Promise<MlWarrantyConfiguration> {
  const { data, error } = await client
    .from('configuracoes')
    .select('ml_default_warranty_type_id,ml_default_warranty_duration,ml_default_warranty_unit')
    .eq('id', CONFIGURATION_ROW_ID)
    .single();
  if (error) throw new Error(`Falha ao carregar configuração do Mercado Livre: ${error.message}`);
  return {
    typeId: data.ml_default_warranty_type_id as MlWarrantyTypeId,
    duration: data.ml_default_warranty_duration,
    unit: data.ml_default_warranty_unit as MlWarrantyUnit,
  };
}

export function toMercadoLivreWarrantyDto(configuration: MlWarrantyConfiguration) {
  return { ...configuration, typeLabel: ML_WARRANTY_TYPE_NAMES[configuration.typeId] };
}
