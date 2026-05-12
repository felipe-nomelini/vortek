'use client';

import { useState, useMemo } from 'react';
import { Input, Select, Tag, Typography, Row, Col, Button, Dropdown } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { useRouter } from 'next/navigation';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';

const { Title } = Typography;

type PersonType = 'F' | 'J';

interface Client {
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

const tipoOptions = [
  { value: '', label: 'Todos os tipos' },
  { value: 'F', label: 'Pessoa Física' },
  { value: 'J', label: 'Pessoa Jurídica' },
];

const mockClients: Client[] = [
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

export default function ClientesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState<PersonType | ''>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const filtered = useMemo(() => {
    return mockClients.filter(c => {
      if (search) {
        const q = search.toLowerCase();
        const fields = [String(c.id), c.nome, c.documento, c.nickname, c.email, c.telefone, c.endereco];
        if (!fields.some(f => f.toLowerCase().includes(q))) return false;
      }
      if (tipoFilter && c.tipo !== tipoFilter) return false;
      return true;
    });
  }, [search, tipoFilter]);

  const columns: TableProps<Client>['columns'] = [
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 70,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: 'Nickname', dataIndex: 'nickname', key: 'nickname', width: 120,
      sorter: (a, b) => a.nickname.localeCompare(b.nickname),
    },
    {
      title: 'Nome', dataIndex: 'nome', key: 'nome',
      sorter: (a, b) => a.nome.localeCompare(b.nome),
      render: (nome: string, record) => (
        <a onClick={() => router.push(`/clientes/${record.id}`)} style={{ color: '#1677ff', cursor: 'pointer' }}>
          {nome}
        </a>
      ),
    },
    {
      title: 'Tipo', dataIndex: 'tipo', key: 'tipo', width: 80,
      sorter: (a, b) => a.tipo.localeCompare(b.tipo),
      render: (t: PersonType) => (
        <Tag color={t === 'F' ? 'blue' : 'purple'}>{t === 'F' ? 'PF' : 'PJ'}</Tag>
      ),
    },
    {
      title: 'Documento', dataIndex: 'documento', key: 'documento', width: 160,
      sorter: (a, b) => a.documento.localeCompare(b.documento),
      render: (doc: string) => <span style={{ fontFamily: 'monospace' }}>{doc}</span>,
    },
    {
      title: 'Endereço', dataIndex: 'endereco', key: 'endereco',
      sorter: (a, b) => a.endereco.localeCompare(b.endereco),
      render: (end: string) => <span style={{ fontSize: 13 }}>{end}</span>,
    },
    {
      title: 'E-mail', dataIndex: 'email', key: 'email',
      sorter: (a, b) => a.email.localeCompare(b.email),
    },
    {
      title: 'Telefone', dataIndex: 'telefone', key: 'telefone', width: 150,
      sorter: (a, b) => a.telefone.localeCompare(b.telefone),
    },
    {
      title: 'Vendas', dataIndex: 'totalVendas', key: 'totalVendas', width: 90,
      sorter: (a, b) => a.totalVendas - b.totalVendas,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#1677ff' }}>{v}</span>,
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
              items: [
                { key: 'view', label: 'Visualizar' },
                { key: 'edit', label: 'Editar' },
              ],
            onClick: ({ key }) => { /* TODO: implementar ação */ },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Clientes</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (ID, nome, documento, nickname, e-mail, telefone ou endereço)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 400 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Tipo"
              value={tipoFilter || undefined}
              onChange={v => setTipoFilter(v as PersonType | '')}
              options={tipoOptions}
              style={{ width: 160 }}
              allowClear
              onClear={() => setTipoFilter('')}
            />
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <ResizableTable<Client>
          storageKey="clientes"
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} clientes` }}
          scroll={{ x: 1200 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
