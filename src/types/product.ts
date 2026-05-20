export type MLStatus = 'ativo' | 'pausado' | 'sem_anuncio';

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  fornecedor: string | null;
  stock: number;
  cost: number;
  mlFee: number;
  mlShipping: number;
  customPrice: number | null;
  mlStatus: MLStatus;
  netWeight: number;
  grossWeight: number;
  width: number;
  height: number;
  depth: number;
  gtin: string;
  description: string;
  images: string[];
  category?: string;
  ncm: string | null;
  cest: string | null;
}
