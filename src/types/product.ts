export type BlingStatus = 'ativo' | 'inativo';
export type MLStatus = 'ativo' | 'pausado' | 'sem_anuncio';

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  stock: number;
  cost: number;
  blingPrice: number;
  mlFee: number;
  mlShipping: number;
  customPrice: number | null;
  blingStatus: BlingStatus;
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
}
