export type FornecedorSortKey =
  | 'dslite_id'
  | 'apelido'
  | 'status_dslite'
  | 'crossdocking'
  | 'dropshipping'
  | 'nome'
  | 'cnpj'
  | 'email'
  | 'telefone'
  | 'dslite_ultima_sync'
  | 'created_at'
  | 'ativo';

export type SupplierSyncHealth = 'healthy' | 'attention' | 'unknown';

export interface FornecedorListItem {
  id: string;
  dslite_id: string | null;
  apelido: string | null;
  nome: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  status_dslite: string | null;
  crossdocking: string | null;
  dropshipping: string | null;
  ativo: boolean | null;
  dslite_ultima_sync: string | null;
  activation_blocked: boolean;
  sync_health: SupplierSyncHealth;
}

export interface FornecedoresSummary {
  total: number;
  active: number;
  inactive: number;
  sync_attention: number;
  last_sync_at: string | null;
}

export interface FornecedoresFilterOptions {
  status_dslite: string[];
  crossdocking: string[];
  dropshipping: string[];
}

export interface FornecedoresListResponse {
  data: FornecedorListItem[];
  total: number;
  page: number;
  limit: number;
  summary: FornecedoresSummary;
  filters: FornecedoresFilterOptions;
  sync_policy: {
    interval_minutes: number;
    stale_threshold_minutes: number;
  };
}
