export type OrderStatus = 'aberto' | 'atendido' | 'cancelado' | 'faturado' | 'entregue';

export interface Order {
  id: number;
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
  rastreio: string | null;
  lucro: number;
  dslite_id: string | null;
}
