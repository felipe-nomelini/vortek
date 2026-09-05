import type {
  DsliteLabelOperationalStatus,
  WhatsappLabelOperationalStatus,
} from '@/lib/orders/operational-view';
import type { SupplierPaymentMode } from '@/lib/produto-fornecedor';
import type { SupplierFilterOption } from '@/lib/produto-filtering';
import type { Database } from '@/types/database';

export type OrderStatus =
  | 'aberto'
  | 'atendido'
  | 'cancelado'
  | 'faturado'
  | 'entregue'
  | 'pendente'
  | 'preparando'
  | 'pronto_envio'
  | 'etiqueta_impressa'
  | 'coletado'
  | 'em_transito'
  | 'saiu_entrega'
  | 'dest_ausente'
  | 'recusado'
  | 'devolvido'
  | 'concretizada_ml';

export type DsliteNextAction =
  | 'create_dslite_order'
  | 'confirm_supplier_payment'
  | 'send_supplier_receipt'
  | 'resume_dslite_flow'
  | 'wait_ml_label'
  | 'complete_dslite_label'
  | 'done'
  | 'blocked'
  | 'internal_shipping';

export type PedidoOperacionalItemApiDto = {
  titulo: string;
  quantidade: number;
  seller_sku: string | null;
  ml_item_id: string | null;
  valor_unitario: number;
  valor_total_liquido: number;
};

type PedidoRow = Database['public']['Tables']['pedidos']['Row'];

export type PedidoOperacionalApiDto = Omit<PedidoRow, 'fulfillment_source' | 'lucro'> & {
  lucro: number | null;
  fulfillment_source: 'internal' | 'supplier' | null;
  operational_total?: number | null;
  operational_lucro?: number | null;
  operational_pedido_ids?: string[] | null;
  operational_order_ids?: string[] | null;
  operational_dslite_ids: string[];
  operational_invoice_numbers: string[];
  operational_profit_pending: boolean;
  operational_supplier_ids?: string[];
  operational_internal_stock?: boolean;
  is_virtual_kit: boolean;
  is_cart: boolean;
  kit_order_ids: string[];
  has_split_fulfillment: boolean;
  pedido_itens: PedidoOperacionalItemApiDto[];
  cliente_id: string | null;
  compra_id?: string | null;
  compra_produto_descricao?: string | null;
  compra_produto_sku?: string | null;
  compra_quantidade?: number | null;
  fornecedor_id?: string | null;
  fornecedor_nome?: string | null;
  fornecedor_telefone?: string | null;
  internal_stock_available?: boolean | null;
  supplier_payment_mode?: SupplierPaymentMode | null;
  supplier_payment_status?: string | null;
  supplier_payment_amount?: number | null;
  supplier_payment_receipt_path?: string | null;
  supplier_payment_reference?: string | null;
  supplier_payment_notes?: string | null;
  supplier_pix_key?: string | null;
  dslite_next_action?: DsliteNextAction;
  dslite_next_action_label?: string | null;
  dslite_label_operational_status: DsliteLabelOperationalStatus;
  dslite_label_operational_updated_at: string | null;
  dslite_label_operational_error: string | null;
  whatsapp_label_status: WhatsappLabelOperationalStatus;
  whatsapp_label_updated_at: string | null;
  whatsapp_label_error: string | null;
  whatsapp_label_next_retry_at: string | null;
};

export type PedidosOperacionaisApiResponse = {
  data: PedidoOperacionalApiDto[];
  total: number;
  page: number;
  pageSize: number;
  fornecedores: SupplierFilterOption[];
};

export type PedidoVendaCompraDetalheApiDto = {
  id: string;
  dslite_id: string;
  status: string | null;
  status_dslite: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  produto_descricao: string | null;
  produto_sku: string | null;
  quantidade: number | null;
  valor_total: number | null;
  valor_frete: number | null;
  supplier_payment_mode: string | null;
  supplier_payment_status: string | null;
  supplier_payment_amount: number | null;
  supplier_payment_reference: string | null;
  supplier_payment_notes: string | null;
  nf_numero: string | null;
  nf_chave: string | null;
  rastreio: string | null;
};

export type PedidoVendaGrupoDetalheApiDto = {
  pedido_id: string;
  ml_order_id: string | null;
  numero: string | null;
  fulfillment_source: 'internal' | 'supplier' | null;
  envio_interno_at: string | null;
  dslite_status: string | null;
  items: PedidoOperacionalItemApiDto[];
  purchase: PedidoVendaCompraDetalheApiDto | null;
};

export type PedidoVendaHistoricoApiDto = {
  id: string;
  event: string;
  label: string;
  level: 'success' | 'warning' | 'error' | 'info';
  result: string | null;
  date: string | null;
};

export type PedidoVendaDetalheApiResponse = {
  data: {
    order: PedidoOperacionalApiDto;
    groups: PedidoVendaGrupoDetalheApiDto[];
    unmatchedPurchases: PedidoVendaCompraDetalheApiDto[];
    history: PedidoVendaHistoricoApiDto[];
  };
  error: null;
  meta: { requestId: string };
};

export type PedidoTrackingHistoryItemApiDto = {
  status: string;
  substatus: string;
  date: string;
  description: string;
};

export type PedidoTrackingApiDto = {
  currentStatus: string;
  currentSubstatus: string | null;
  carrier: { name: string; trackingUrl: string | null } | null;
  history: PedidoTrackingHistoryItemApiDto[];
  returnHistory: Array<PedidoTrackingHistoryItemApiDto & { shipmentId: string }>;
  returnShipments: Array<{
    shipmentId: string;
    status: string;
    trackingNumber: string | null;
    type: string;
    destination: string;
  }>;
  claim: {
    id: string;
    status: string;
    type: string;
    stage: string;
    reason: string;
  } | null;
  rastreio: string | null;
  warnings: string[];
};

export interface Order {
  id: number;
  dbId: string;
  numero: number;
  numeroLoja: string;
  data: string;
  dataCriacao?: string | null;
  dataSaida: string | null;
  dataPrevista: string | null;
  contato: {
    id: number;
    nome: string;
    tipoPessoa: string;
    numeroDocumento: string;
  };
  totalProdutos: number;
  total: number;
  situacao: {
    id: number;
    valor: OrderStatus;
  };
  loja: { id: number };
  transporte: {
    frete: number;
    prazoEntrega: number | null;
    contato: { nome: string };
  } | null;
  notaFiscal: {
    numero: string;
    emitida: boolean;
  } | null;
  nfe_danfe_url: string | null;
  rastreio: string | null;
  lucro: number | null;
  profit_pending?: boolean;
  dslite_id: string | null;
  dslite_status?: string | null;
  dslite_etiqueta_enviada?: boolean;
  dslite_label_source?: string | null;
  compra_id?: string | null;
  supplier_payment_mode?: SupplierPaymentMode | null;
  supplier_payment_status?: 'pending' | 'paid' | 'failed' | 'cancelled' | string | null;
  supplier_payment_amount?: number | null;
  supplier_payment_receipt_path?: string | null;
  supplier_payment_reference?: string | null;
  supplier_payment_notes?: string | null;
  fornecedor_id?: string | null;
  fornecedor_nome?: string | null;
  fornecedor_telefone?: string | null;
  internal_stock_available?: boolean;
  envio_interno_at?: string | null;
  fulfillment_source?: 'internal' | 'supplier' | null;
  fulfillment_selected_at?: string | null;
  supplier_pix_key?: string | null;
  dslite_next_action?: DsliteNextAction;
  dslite_next_action_label?: string | null;
  ml_claim_id: string | null;
  ml_shipment_id: string | null;
  ml_invoice_reported?: boolean;
  ml_order_id?: string | null;
  ml_pack_id?: string | null;
  is_virtual_kit?: boolean;
  is_cart?: boolean;
  kit_order_ids?: string[];
  operational_dslite_ids?: string[];
  operational_invoice_numbers?: string[];
  has_split_fulfillment?: boolean;
  billing_nome?: string | null;
  ml_fiscal_release_at?: string | null;
  ml_fiscal_release_reason?: string | null;
  ml_fiscal_release_source?: string | null;
  ml_fiscal_release_checked_at?: string | null;
  ml_label_storage_path?: string | null;
  ml_thermal_label_storage_path?: string | null;
  nfe_chave?: string | null;
  nfe_status?: string | null;
  billing_endereco?: Record<string, unknown> | null;
  pedido_itens?: PedidoOperacionalItemApiDto[];
  compra_produto_descricao?: string | null;
  compra_produto_sku?: string | null;
  compra_quantidade?: number | null;
  cliente_id?: string | null;
  dslite_label_operational_status?: DsliteLabelOperationalStatus;
  dslite_label_operational_updated_at?: string | null;
  dslite_label_operational_error?: string | null;
  whatsapp_label_status?: WhatsappLabelOperationalStatus;
  whatsapp_label_updated_at?: string | null;
  whatsapp_label_error?: string | null;
  whatsapp_label_next_retry_at?: string | null;
  is_homologation_fixture?: boolean;
}
