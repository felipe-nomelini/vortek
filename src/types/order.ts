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
  ml_claim_id: string | null;
  ml_shipment_id: string | null;
  ml_invoice_reported?: boolean;
  ml_order_id?: string | null;
  ml_pack_id?: string | null;
  ml_fiscal_release_at?: string | null;
  ml_fiscal_release_reason?: string | null;
  ml_fiscal_release_source?: string | null;
  ml_fiscal_release_checked_at?: string | null;
  nfe_status?: string | null;
}
