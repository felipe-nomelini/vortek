export type MLStatus = 'ativo' | 'pausado' | 'sem_anuncio';

export interface Product {
  id: string;
  active: boolean;
  sku: string;
  name: string;
  brand: string;
  fornecedor: string | null;
  supplierId?: string | null;
  supplierProductId?: string | null;
  preferredSupplierManual?: boolean;
  stock: number;
  supplierStock?: number;
  internalStock?: number;
  cost: number;
  mlFee: number;
  mlShipping: number;
  customPrice: number | null;
  mlStatus: MLStatus;
  mlItemId?: string | null;
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
