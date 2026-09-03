import type { OrderStatus } from '@/types/order';

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

export interface ClienteDetailItem {
  id: string;
  name: string;
  personType: string;
  document: string;
  address: string;
  email: string;
  phone: string;
  mlId: string | null;
  mlNickname: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClienteDetailOrder {
  id: string;
  saleId: string;
  packId: string | null;
  date: string | null;
  total: number;
  status: OrderStatus;
  shipmentId: string | null;
  tracking: string | null;
  isHomologationFixture: boolean;
}

export interface ClienteDetailResponse {
  data: {
    client: ClienteDetailItem;
    summary: {
      orderCount: number;
      lastOrderAt: string | null;
    };
    orders: ClienteDetailOrder[];
  };
  page: number;
  pageSize: number;
  total: number;
}

export interface ClienteContactUpdate {
  email: string;
  phone: string;
}
