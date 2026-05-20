export type PersonType = 'F' | 'J';

export interface Client {
  id: number;
  nickname: string;
  nome: string;
  tipo: PersonType;
  documento: string;
  endereco: string;
  email: string;
  telefone: string;
  totalVendas: number;
}

export interface Venda {
  id: number;
  pedido: number;
  data: string;
  valor: number;
  status: string;
}

export const mockClients: Client[] = [
  { id: 1, nickname: 'ANAFER', nome: 'Ana Ferreira', tipo: 'F', documento: '123.456.789-00', endereco: 'Rua das Flores, 123 - São Paulo, SP', email: 'ana.ferreira@email.com', telefone: '(11) 99999-0001', totalVendas: 8 },
  { id: 2, nickname: 'CARLIM', nome: 'Carlos Lima', tipo: 'F', documento: '234.567.890-11', endereco: 'Av. Atlântica, 500 - Rio de Janeiro, RJ', email: 'carlos.lima@email.com', telefone: '(21) 98888-0002', totalVendas: 3 },
  { id: 3, nickname: 'MARCOSTA', nome: 'Marina Costa', tipo: 'F', documento: '345.678.901-22', endereco: 'Rua Augusta, 800 - São Paulo, SP', email: 'marina.costa@email.com', telefone: '(11) 97777-0003', totalVendas: 12 },
  { id: 4, nickname: 'ROBALVES', nome: 'Roberto Alves', tipo: 'F', documento: '456.789.012-33', endereco: 'Rua da Praia, 200 - Santos, SP', email: 'roberto.alves@email.com', telefone: '(13) 96666-0004', totalVendas: 5 },
  { id: 5, nickname: 'JUSANTOS', nome: 'Juliana Santos', tipo: 'F', documento: '567.890.123-44', endereco: 'Rua do Comércio, 50 - Belo Horizonte, MG', email: 'juliana.santos@email.com', telefone: '(31) 95555-0005', totalVendas: 7 },
  { id: 6, nickname: 'PEDMART', nome: 'Pedro Martins', tipo: 'F', documento: '678.901.234-55', endereco: 'Av. Brasil, 1000 - Curitiba, PR', email: 'pedro.martins@email.com', telefone: '(41) 94444-0006', totalVendas: 2 },
  { id: 7, nickname: 'LUROCHA', nome: 'Luciana Rocha', tipo: 'F', documento: '789.012.345-66', endereco: 'Rua das Acácias, 300 - Porto Alegre, RS', email: 'luciana.rocha@email.com', telefone: '(51) 93333-0007', totalVendas: 15 },
  { id: 8, nickname: 'FEROLIVEIRA', nome: 'Fernando Oliveira', tipo: 'J', documento: '12.345.678/0001-90', endereco: 'Av. Paulista, 1500 - São Paulo, SP', email: 'fernando.oliveira@empresa.com', telefone: '(11) 92222-0008', totalVendas: 25 },
  { id: 9, nickname: 'CAMBARBOSA', nome: 'Camila Barbosa', tipo: 'F', documento: '901.234.567-88', endereco: 'Rua XV de Novembro, 400 - Florianópolis, SC', email: 'camila.barbosa@email.com', telefone: '(48) 91111-0009', totalVendas: 4 },
  { id: 10, nickname: 'DIEGONUNES', nome: 'Diego Nunes', tipo: 'J', documento: '98.765.432/0001-10', endereco: 'Rua da Indústria, 50 - Joinville, SC', email: 'diego.nunes@empresa.com', telefone: '(47) 90000-0010', totalVendas: 18 },
  { id: 11, nickname: 'TATISOUZA', nome: 'Tatiane Souza', tipo: 'F', documento: '111.222.333-44', endereco: 'Rua da Matriz, 200 - Ribeirão Preto, SP', email: 'tatiane.souza@email.com', telefone: '(16) 98989-0011', totalVendas: 6 },
  { id: 12, nickname: 'GUPEREIRA', nome: 'Gustavo Pereira', tipo: 'F', documento: '555.666.777-88', endereco: 'Av. Getúlio Vargas, 600 - Uberlândia, MG', email: 'gustavo.pereira@email.com', telefone: '(34) 97878-0012', totalVendas: 9 },
  { id: 13, nickname: 'TECMIX', nome: 'TecMix Distribuidora Ltda', tipo: 'J', documento: '45.678.901/0001-23', endereco: 'Rua do Mercado, 800 - São Paulo, SP', email: 'contato@tecmix.com.br', telefone: '(11) 3567-8901', totalVendas: 42 },
  { id: 14, nickname: 'GAMEX', nome: 'GameX Comércio Digital', tipo: 'J', documento: '56.789.012/0001-34', endereco: 'Av. Tecnológica, 500 - Campinas, SP', email: 'vendas@gamex.com.br', telefone: '(19) 3456-7890', totalVendas: 31 },
  { id: 15, nickname: 'MARQUES', nome: 'Marques da Silva', tipo: 'F', documento: '789.123.456-99', endereco: 'Rua do Rosário, 150 - Salvador, BA', email: 'marques.silva@email.com', telefone: '(71) 96789-0015', totalVendas: 1 },
];

export const historicoVendas: Record<number, Venda[]> = {
  1: [{ id: 1, pedido: 342, data: '2026-05-04T14:30:00Z', valor: 89.90, status: 'aberto' }, { id: 2, pedido: 330, data: '2026-04-20T10:00:00Z', valor: 149.90, status: 'entregue' }, { id: 3, pedido: 315, data: '2026-04-05T16:00:00Z', valor: 59.90, status: 'entregue' }],
  7: [{ id: 4, pedido: 336, data: '2026-04-30T14:00:00Z', valor: 99.90, status: 'entregue' }, { id: 5, pedido: 320, data: '2026-04-12T09:00:00Z', valor: 79.90, status: 'entregue' }],
  13: [{ id: 6, pedido: 350, data: '2026-05-05T11:00:00Z', valor: 450.00, status: 'faturado' }, { id: 7, pedido: 345, data: '2026-05-02T15:00:00Z', valor: 890.00, status: 'entregue' }],
};
