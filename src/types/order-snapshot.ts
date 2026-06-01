export interface BillingSnapshot {
  nome: string;
  documento: string;
  tipoPessoa: string;
  ie: string | null;
  endereco: {
    street_name: string;
    street_number: string;
    neighborhood: string;
    city_name: string;
    city_id?: string;
    cod_municipio?: string;
    state_id: string;
    state_name: string;
    zip_code: string;
    country_id?: string;
    taxpayer_type_ml_raw?: string | null;
    ie_policy_resolved?: 'contribuinte' | 'nao_contribuinte' | null;
  };
}

export interface PaymentSnapshot {
  id: string | null;
  status: string | null;
  payment_type: string | null;
  total_paid_amount: number;
}

export interface OrderItemSnapshot {
  ml_item_id: string | null;
  seller_sku: string | null;
  titulo: string;
  quantidade: number;
  unidade: string | null;
  valor_unitario: number;
  valor_total_bruto: number;
  desconto_item: number;
  frete_rateado_item: number;
  valor_total_liquido: number;
  ncm: string | null;
  cest: string | null;
  gtin: string | null;
  origem_fiscal: string | null;
  csosn: string | null;
  cfop_sugerido: string | null;
}

export interface OrderFiscalSnapshot {
  source: 'ml_live' | 'local_fallback';
  buyerMlId: string | null;
  billing: BillingSnapshot;
  pagamentos: PaymentSnapshot[];
  itens: OrderItemSnapshot[];
  totais: {
    total_produtos: number;
    frete_total: number;
    desconto_total: number;
    total_final: number;
  };
  incompleto: boolean;
  pendencias: string[];
}

export interface SyncPedidoCompletoResult {
  pedidoId: string;
  mlOrderId: string;
  source: 'ml_live' | 'local_fallback';
  itemsCount: number;
  incompleto: boolean;
  pendencias: string[];
}

export interface MlBillingInfoV2Payload {
  id: string;
  site_id: string;
  buyer: {
    cust_id?: number | string;
    billing_info?: {
      name?: string;
      last_name?: string;
      identification?: {
        type?: string;
        number?: string;
      };
      taxes?: Record<string, any>;
      address?: {
        street_name?: string;
        street_number?: string;
        city_name?: string;
        city_id?: string;
        neighborhood?: string;
        state?: {
          code?: string;
          name?: string;
        };
        zip_code?: string;
        country_id?: string;
      };
      attributes?: Record<string, any>;
    };
  };
}
