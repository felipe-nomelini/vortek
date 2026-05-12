'use client';

import { useState, useMemo } from 'react';
import { Input, Button, Dropdown, Typography, Row, Col } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';

const { Title } = Typography;

interface Supplier {
  id: number;
  nome: string;
  cnpj: string;
  endereco: string;
  email: string;
  telefone: string;
}

const mockSuppliers: Supplier[] = [
  { id: 1, nome: 'Distribuidora TechSound Ltda', cnpj: '12.345.678/0001-90', endereco: 'Av. Paulista, 1500 - São Paulo, SP', email: 'comercial@techsound.com.br', telefone: '(11) 3567-8901' },
  { id: 2, nome: 'GameX Indústria e Comércio', cnpj: '23.456.789/0001-01', endereco: 'Rua da Indústria, 500 - Campinas, SP', email: 'vendas@gamex.com.br', telefone: '(19) 3456-7890' },
  { id: 3, nome: 'VoltPower Componentes Eletrônicos', cnpj: '34.567.890/0001-12', endereco: 'Av. Tecnológica, 800 - São José dos Campos, SP', email: 'contato@voltpower.com.br', telefone: '(12) 3344-5566' },
  { id: 4, nome: 'GlassShield Proteções Ltda', cnpj: '45.678.901/0001-23', endereco: 'Rua do Mercado, 300 - São Paulo, SP', email: 'admin@glassshield.com.br', telefone: '(11) 3222-4455' },
  { id: 5, nome: 'ErgoTech Móveis Corporativos', cnpj: '56.789.012/0001-34', endereco: 'Av. das Nações, 1200 - Curitiba, PR', email: 'sac@ergotech.com.br', telefone: '(41) 3333-5566' },
  { id: 6, nome: 'EletroMix Distribuidora', cnpj: '67.890.123/0001-45', endereco: 'Rua do Comércio, 900 - Belo Horizonte, MG', email: 'pedidos@eletromix.com.br', telefone: '(31) 3444-6677' },
  { id: 7, nome: 'DigitalConnect Cabos e Conexões', cnpj: '78.901.234/0001-56', endereco: 'Av. das Américas, 600 - Rio de Janeiro, RJ', email: 'vendas@digitalconnect.com.br', telefone: '(21) 3555-7788' },
  { id: 8, nome: 'AudioKing Indústria de Som Ltda', cnpj: '89.012.345/0001-67', endereco: 'Rua dos Áudios, 200 - Manaus, AM', email: 'comercial@audioking.com.br', telefone: '(92) 3666-8899' },
];

export default function FornecedoresPage() {
  const [search, setSearch] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const filtered = useMemo(() => {
    return mockSuppliers.filter(s => {
      if (!search) return true;
      const q = search.toLowerCase();
      return [String(s.id), s.nome, s.cnpj, s.email, s.telefone, s.endereco].some(f => f.toLowerCase().includes(q));
    });
  }, [search]);

  const columns: TableProps<Supplier>['columns'] = [
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 70,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: 'Nome', dataIndex: 'nome', key: 'nome',
      sorter: (a, b) => a.nome.localeCompare(b.nome),
    },
    {
      title: 'CNPJ', dataIndex: 'cnpj', key: 'cnpj', width: 170,
      sorter: (a, b) => a.cnpj.localeCompare(b.cnpj),
      render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span>,
    },
    {
      title: 'Endereço', dataIndex: 'endereco', key: 'endereco',
      sorter: (a, b) => a.endereco.localeCompare(b.endereco),
      render: (v: string) => <span style={{ fontSize: 13 }}>{v}</span>,
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
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
              items: [
                { key: 'view', label: 'Visualizar' },
                { key: 'edit', label: 'Editar' },
                { key: 'dslite', label: 'Ver no DSLite' },
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Fornecedores</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (ID, nome, CNPJ, e-mail, telefone ou endereço)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 450 }}
              allowClear
            />
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <ResizableTable<Supplier>
          storageKey="fornecedores"
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} fornecedores` }}
          scroll={{ x: 1100 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
