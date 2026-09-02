export type ClientePersonType = 'F' | 'J';

export type ClienteSortKey =
  | 'name'
  | 'ml_id'
  | 'person_type'
  | 'document'
  | 'location'
  | 'orders';

export interface ClienteListItem {
  id: string;
  name: string;
  personType: string;
  document: string;
  address: string;
  email: string;
  phone: string;
  mlId: string | null;
  mlNickname: string | null;
  orderCount: number;
  city: string | null;
  state: string | null;
}

export interface ClientesSummary {
  total: number;
  pf: number;
  pj: number;
}

export interface ClientesListResponse {
  data: ClienteListItem[];
  page: number;
  pageSize: number;
  total: number;
  summary: ClientesSummary;
}
