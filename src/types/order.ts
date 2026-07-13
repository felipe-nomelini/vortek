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
  | 'devolvido';

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
  dslite_id: string | null;
  dslite_status?: string | null;
  dslite_etiqueta_enviada?: boolean;
  dslite_label_source?: string | null;
  compra_id?: string | null;
  supplier_payment_mode?: 'postpaid' | 'prepaid_pix' | 'balance_account' | null;
  supplier_payment_status?: 'pending' | 'paid' | 'failed' | 'cancelled' | string | null;
  supplier_payment_amount?: number | null;
  supplier_payment_receipt_path?: string | null;
  supplier_payment_reference?: string | null;
  supplier_payment_notes?: string | null;
  fornecedor_id?: string | null;
  fornecedor_nome?: string | null;
  fornecedor_telefone?: string | null;
  supplier_pix_key?: string | null;
  dslite_next_action?:
    | 'create_dslite_order'
    | 'confirm_supplier_payment'
    | 'send_supplier_receipt'
    | 'resume_dslite_flow'
    | 'wait_ml_label'
    | 'complete_dslite_label'
    | 'done'
    | 'blocked';
  dslite_next_action_label?: string | null;
  ml_claim_id: string | null;
  ml_shipment_id: string | null;
  ml_invoice_reported?: boolean;
  ml_order_id?: string | null;
  ml_pack_id?: string | null;
  billing_nome?: string | null;
  ml_fiscal_release_at?: string | null;
  ml_fiscal_release_reason?: string | null;
  ml_fiscal_release_source?: string | null;
  ml_fiscal_release_checked_at?: string | null;
  ml_label_storage_path?: string | null;
  nfe_chave?: string | null;
  nfe_status?: string | null;
  billing_endereco?: Record<string, unknown> | null;
  pedido_itens?: {
    titulo: string;
    quantidade: number;
    seller_sku: string | null;
    ml_item_id: string | null;
    valor_unitario: number;
    valor_total_liquido: number;
  }[];
  compra_produto_descricao?: string | null;
  compra_produto_sku?: string | null;
  compra_quantidade?: number | null;
  cliente_id?: string | null;
}
