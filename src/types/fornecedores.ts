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
  dropshipping_retired_at: string | null;
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

export interface FornecedorDetailItem {
  id: string;
  dsliteId: string | null;
  nickname: string;
  legalName: string;
  document: string;
  email: string;
  phone: string;
  address: string;
  pixKey: string;
  dsliteStatus: string;
  crossdocking: string;
  dropshipping: string;
  active: boolean;
  activationBlocked: boolean;
  syncHealth: SupplierSyncHealth;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FornecedorDetailSummary {
  purchaseCount: number;
  offerCount: number;
  activeOfferCount: number;
}

export interface FornecedorDetailResponse {
  data: {
    supplier: FornecedorDetailItem;
    summary: FornecedorDetailSummary;
  };
  syncPolicy: {
    intervalMinutes: number;
    staleThresholdMinutes: number;
  };
}

export interface FornecedorLocalUpdate {
  email?: string;
  phone?: string;
  address?: string;
  pixKey?: string;
}

export interface FornecedorLocalUpdateResponse {
  data: Required<FornecedorLocalUpdate> & { updatedAt: string };
}
