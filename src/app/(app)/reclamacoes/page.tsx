'use client';

import { useState, useMemo } from 'react';
import { Input, Select, Button, Tag, Typography, Row, Col, DatePicker } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

type ClaimType = 'devolucao' | 'cancelamento' | 'mediacao';
type ClaimStage = 'claim' | 'dispute' | 'recontact';
type ClaimStatus = 'opened' | 'closed';

interface Mensagem {
  sender: string;
  texto: string;
  data: string;
}

interface Reclamacao {
  id: number;
  pedido: number;
  cliente: string;
  tipo: ClaimType;
  stage: ClaimStage;
  status: ClaimStatus;
  data: string;
  mensagens: Mensagem[];
}

const tipoOptions = [
  { value: '', label: 'Todos os tipos' },
  { value: 'devolucao', label: 'Devolução' },
  { value: 'cancelamento', label: 'Cancelamento' },
  { value: 'mediacao', label: 'Mediação' },
];

const stageOptions = [
  { value: '', label: 'Todos os estágios' },
  { value: 'claim', label: 'Negociação' },
  { value: 'dispute', label: 'Disputa' },
  { value: 'recontact', label: 'Recontato' },
];

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'opened', label: 'Aberto' },
  { value: 'closed', label: 'Fechado' },
];

const tipoColor: Record<ClaimType, string> = { devolucao: 'blue', cancelamento: 'red', mediacao: 'orange' };
const tipoLabel: Record<ClaimType, string> = { devolucao: 'Devolução', cancelamento: 'Cancelamento', mediacao: 'Mediação' };
const stageColor: Record<ClaimStage, string> = { claim: 'green', dispute: 'volcano', recontact: 'purple' };
const stageLabel: Record<ClaimStage, string> = { claim: 'Negociação', dispute: 'Disputa', recontact: 'Recontato' };

const mockReclamacoes: Reclamacao[] = [
  {
    id: 5308212444, pedido: 337, cliente: 'Pedro Martins', tipo: 'cancelamento', stage: 'claim', status: 'opened', data: '2026-05-02T11:00:00Z',
    mensagens: [
      { sender: 'Comprador', texto: 'Produto veio com defeito, o mouse não liga. Quero cancelar a compra.', data: '2026-05-02T11:05:00Z' },
      { sender: 'Vendedor', texto: 'Olá Pedro, sinto muito pelo ocorrido. Vamos processar o cancelamento. Pode nos enviar uma foto do defeito?', data: '2026-05-02T14:30:00Z' },
      { sender: 'Comprador', texto: 'Claro, estou enviando o vídeo mostrando que não liga.', data: '2026-05-02T15:00:00Z' },
    ],
  },
  {
    id: 5308212555, pedido: 333, cliente: 'Diego Nunes', tipo: 'cancelamento', stage: 'dispute', status: 'opened', data: '2026-04-28T10:00:00Z',
    mensagens: [
      { sender: 'Comprador', texto: 'Comprei o produto errado, quero cancelar.', data: '2026-04-28T10:15:00Z' },
      { sender: 'Vendedor', texto: 'Diego, o pedido já foi faturado e está em processo de separação. Infelizmente não podemos cancelar após o faturamento.', data: '2026-04-28T11:00:00Z' },
      { sender: 'ML Mediação', texto: 'Foi aberta uma disputa. Ambas as partes devem apresentar suas evidências.', data: '2026-04-29T09:00:00Z' },
    ],
  },
  {
    id: 5308212666, pedido: 342, cliente: 'Ana Ferreira', tipo: 'devolucao', stage: 'claim', status: 'opened', data: '2026-05-05T09:30:00Z',
    mensagens: [
      { sender: 'Comprador', texto: 'O fone chegou mas o áudio está falhando no lado direito. Quero devolver.', data: '2026-05-05T09:35:00Z' },
    ],
  },
  {
    id: 5308212777, pedido: 331, cliente: 'Gustavo Pereira', tipo: 'devolucao', stage: 'recontact', status: 'closed', data: '2026-04-26T11:30:00Z',
    mensagens: [
      { sender: 'Comprador', texto: 'O suporte veio sem um dos parafusos, não consigo montar.', data: '2026-04-26T11:45:00Z' },
      { sender: 'Vendedor', texto: 'Gustavo, vamos enviar o parafuso faltante pelo correio. Pedimos desculpas pelo transtorno.', data: '2026-04-26T14:00:00Z' },
      { sender: 'Comprador', texto: 'Recebi o parafuso hoje, já montei o suporte. Obrigado!', data: '2026-05-01T10:00:00Z' },
      { sender: 'ML Mediação', texto: 'Reclamação encerrada. Cliente confirmou resolução.', data: '2026-05-01T10:30:00Z' },
    ],
  },
  {
    id: 5308212888, pedido: 340, cliente: 'Marina Costa', tipo: 'mediacao', stage: 'dispute', status: 'opened', data: '2026-05-04T18:45:00Z',
    mensagens: [
      { sender: 'Comprador', texto: 'O carregador não carrega meu celular. Testei com outro carregador e funciona normal.', data: '2026-05-04T19:00:00Z' },
      { sender: 'Vendedor', texto: 'Marina, você testou com o cabo original? Pode ser incompatibilidade do cabo.', data: '2026-05-05T09:00:00Z' },
      { sender: 'Comprador', texto: 'Testei com 3 cabos diferentes e nenhum funcionou.', data: '2026-05-05T10:00:00Z' },
    ],
  },
  {
    id: 5308212999, pedido: 335, cliente: 'Fernando Oliveira', tipo: 'devolucao', stage: 'claim', status: 'closed', data: '2026-04-30T09:45:00Z',
    mensagens: [
      { sender: 'Comprador', texto: 'O cabo HDMI veio com a ponta amassada.', data: '2026-04-30T10:00:00Z' },
      { sender: 'Vendedor', texto: 'Vamos realizar a troca imediatamente. Envie o produto de volta pelo correio.', data: '2026-04-30T11:00:00Z' },
      { sender: 'ML Mediação', texto: 'Troca autorizada. Cliente deve enviar o produto em até 7 dias.', data: '2026-04-30T11:30:00Z' },
    ],
  },
];

export default function ReclamacoesPage() {
  const [search, setSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState<ClaimType | ''>('');
  const [stageFilter, setStageFilter] = useState<ClaimStage | ''>('');
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});

  const filtered = useMemo(() => {
    return mockReclamacoes.filter(r => {
      if (search) {
        const q = search.toLowerCase();
        if (!String(r.id).includes(q) && !String(r.pedido).includes(q) && !r.cliente.toLowerCase().includes(q)) return false;
      }
      if (tipoFilter && r.tipo !== tipoFilter) return false;
      if (stageFilter && r.stage !== stageFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (dateRange[0] && new Date(r.data) < new Date(dateRange[0])) return false;
      if (dateRange[1]) {
        const end = new Date(dateRange[1]);
        end.setHours(23, 59, 59, 999);
        if (new Date(r.data) > end) return false;
      }
      return true;
    });
  }, [search, tipoFilter, stageFilter, statusFilter, dateRange]);

  const handleReply = (id: number) => {
    console.log(`Reply to claim ${id}:`, replyTexts[id]);
  };

  const columns: TableProps<Reclamacao>['columns'] = [
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 80,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: 'Pedido', dataIndex: 'pedido', key: 'pedido', width: 90,
      sorter: (a, b) => a.pedido - b.pedido,
      render: (v: number) => <span style={{ fontFamily: 'monospace' }}>#{String(v).padStart(6, '0')}</span>,
    },
    {
      title: 'Cliente', dataIndex: 'cliente', key: 'cliente',
      sorter: (a, b) => a.cliente.localeCompare(b.cliente),
    },
    {
      title: 'Tipo', dataIndex: 'tipo', key: 'tipo', width: 120,
      sorter: (a, b) => a.tipo.localeCompare(b.tipo),
      render: (t: ClaimType) => <Tag color={tipoColor[t]}>{tipoLabel[t]}</Tag>,
    },
    {
      title: 'Estágio', dataIndex: 'stage', key: 'stage', width: 110,
      sorter: (a, b) => a.stage.localeCompare(b.stage),
      render: (s: ClaimStage) => <Tag color={stageColor[s]}>{stageLabel[s]}</Tag>,
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (s: ClaimStatus) => (
        <Tag color={s === 'opened' ? 'orange' : 'default'}>
          {s === 'opened' ? 'Aberto' : 'Fechado'}
        </Tag>
      ),
    },
    {
      title: 'Data', dataIndex: 'data', key: 'data', width: 150,
      sorter: (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime(),
      render: (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Button type="text" size="small" icon={<EllipsisOutlined />} />
      ),
    },
  ];

  const inputStyle = { background: '#1f1f1f', border: '1px solid #303030', color: '#e0e0e0', borderRadius: 6 };

  return (
    <div>
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Reclamações - Mercado Livre</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input placeholder="Buscar (ID, pedido, cliente)" prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} allowClear />
          </Col>
          <Col>
            <Select placeholder="Tipo" value={tipoFilter || undefined} onChange={v => setTipoFilter(v as ClaimType | '')} options={tipoOptions} style={{ width: 140 }} allowClear onClear={() => setTipoFilter('')} />
          </Col>
          <Col>
            <Select placeholder="Estágio" value={stageFilter || undefined} onChange={v => setStageFilter(v as ClaimStage | '')} options={stageOptions} style={{ width: 140 }} allowClear onClear={() => setStageFilter('')} />
          </Col>
          <Col>
            <Select placeholder="Status" value={statusFilter || undefined} onChange={v => setStatusFilter(v as ClaimStatus | '')} options={statusOptions} style={{ width: 140 }} allowClear onClear={() => setStatusFilter('')} />
          </Col>
          <Col>
            <RangePicker onChange={(_, ds) => setDateRange([ds[0] || null, ds[1] || null])} format="DD/MM/YYYY" style={{ width: 230 }} />
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <ResizableTable<Reclamacao>
          storageKey="reclamacoes"
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: '4px 0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                  {record.mensagens.map((msg, i) => (
                    <div key={i} style={{
                      alignSelf: msg.sender === 'Vendedor' ? 'flex-end' : 'flex-start',
                      maxWidth: '70%',
                      background: msg.sender === 'Vendedor' ? '#1a3a1a' : msg.sender === 'ML Mediação' ? '#1a1a2e' : '#252525',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid #303030',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={{ color: msg.sender === 'Vendedor' ? '#5aab2c' : msg.sender === 'ML Mediação' ? '#1677ff' : '#a0a0a0', fontWeight: 600, fontSize: 12 }}>
                          {msg.sender}
                        </Text>
                        <Text style={{ color: '#666', fontSize: 11, marginLeft: 12 }}>
                          {new Date(msg.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </div>
                      <Text style={{ color: '#c0c0c0', fontSize: 13, lineHeight: 1.6 }}>{msg.texto}</Text>
                    </div>
                  ))}
                </div>
                {record.status === 'opened' && (
                  <div style={{ borderTop: '1px solid #303030', paddingTop: 12, display: 'flex', gap: 8 }}>
                    <Input.TextArea
                      rows={2}
                      placeholder="Digite sua resposta..."
                      value={replyTexts[record.id] ?? ''}
                      onChange={e => setReplyTexts(prev => ({ ...prev, [record.id]: e.target.value }))}
                      style={inputStyle}
                    />
                    <Button type="primary" size="small" style={{ alignSelf: 'flex-end' }} onClick={() => handleReply(record.id)}>
                      Responder
                    </Button>
                  </div>
                )}
              </div>
            ),
            rowExpandable: () => true,
          }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} reclamações` }}
          scroll={{ x: 1100 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
