'use client';

import { useState, useMemo } from 'react';
import { Table, Input, Select, Button, Dropdown, Tag, Typography, Row, Col, DatePicker } from 'antd';
import type { TableProps } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';

const { Title } = Typography;
const { RangePicker } = DatePicker;

type QuestionStatus = 'respondida' | 'pendente';

interface Pergunta {
  id: number;
  anuncio: string;
  cliente: string;
  pergunta: string;
  resposta: string | null;
  dataPergunta: string;
  dataResposta: string | null;
  status: QuestionStatus;
}

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'respondida', label: 'Respondida' },
  { value: 'pendente', label: 'Pendente' },
];

const mockPerguntas: Pergunta[] = [
  { id: 1, anuncio: 'Fone Bluetooth X1', cliente: 'Ana Ferreira', pergunta: 'Este fone tem cancelamento de ruído ativo?', resposta: 'Olá! Sim, o fone possui cancelamento de ruído ativo com 4 microfones. Atenciosamente, Equipe Vortek.', dataPergunta: '2026-05-04T14:30:00Z', dataResposta: '2026-05-04T16:45:00Z', status: 'respondida' },
  { id: 2, anuncio: 'Capa Silicone iPhone 15', cliente: 'Carlos Lima', pergunta: 'A capa é compatível com o iPhone 15 Plus?', resposta: 'Carlos, esta capa é específica para iPhone 15 padrão (6.1"). Não compatível com a versão Plus. Temos modelo específico para o 15 Plus em nosso catálogo.', dataPergunta: '2026-05-04T10:15:00Z', dataResposta: '2026-05-04T11:30:00Z', status: 'respondida' },
  { id: 3, anuncio: 'Carregador USB-C 20W', cliente: 'Marina Costa', pergunta: 'Esse carregador suporta carregamento rápido em Samsung Galaxy?', resposta: null, dataPergunta: '2026-05-03T18:45:00Z', dataResposta: null, status: 'pendente' },
  { id: 4, anuncio: 'Película Premium Z10', cliente: 'Roberto Alves', pergunta: 'Vem com o kit de instalação?', resposta: 'Sim, acompanha lenço umedecido, flanela e espátula para instalação.', dataPergunta: '2026-05-03T09:30:00Z', dataResposta: '2026-05-03T14:20:00Z', status: 'respondida' },
  { id: 5, anuncio: 'Mouse Gamer RGB', cliente: 'Juliana Santos', pergunta: 'O mouse é ambidestro?', resposta: null, dataPergunta: '2026-05-02T16:20:00Z', dataResposta: null, status: 'pendente' },
  { id: 6, anuncio: 'Teclado Mecânico TKL', cliente: 'Pedro Martins', pergunta: 'Qual o tipo do switch? É Red, Blue ou Brown?', resposta: 'Pedro, este modelo utiliza switch Red (linear). Ideal para jogos devido à atuação suave e silenciosa.', dataPergunta: '2026-05-02T11:00:00Z', dataResposta: '2026-05-02T14:00:00Z', status: 'respondida' },
  { id: 7, anuncio: 'Suporte Articulado Monitor', cliente: 'Luciana Rocha', pergunta: 'Suporta monitor de 32 polegadas? Qual o peso máximo?', resposta: null, dataPergunta: '2026-04-30T14:00:00Z', dataResposta: null, status: 'pendente' },
  { id: 8, anuncio: 'Cabo HDMI 2.1 2m', cliente: 'Fernando Oliveira', pergunta: 'Esse cabo é certificado HDMI 2.1? Suporta 4K a 120Hz?', resposta: 'Fernando, sim! O cabo possui certificação HDMI 2.1 e suporta 4K a 120Hz, HDR10+ e eARC.', dataPergunta: '2026-04-29T09:45:00Z', dataResposta: '2026-04-29T12:30:00Z', status: 'respondida' },
  { id: 9, anuncio: 'Adaptador Bluetooth 5.3', cliente: 'Camila Barbosa', pergunta: 'Funciona no Linux?', resposta: null, dataPergunta: '2026-04-28T13:30:00Z', dataResposta: null, status: 'pendente' },
  { id: 10, anuncio: 'Caixa Som Portátil 20W', cliente: 'Diego Nunes', pergunta: 'A bateria dura quantas horas no volume máximo?', resposta: 'Diego, no volume máximo a bateria dura aproximadamente 4 horas. Em volume moderado (50%) chega a 12 horas.', dataPergunta: '2026-04-27T10:00:00Z', dataResposta: '2026-04-27T15:00:00Z', status: 'respondida' },
  { id: 11, anuncio: 'Fone Bluetooth X1', cliente: 'Tatiane Souza', pergunta: 'Tem microfone embutido para chamadas?', resposta: 'Sim, possui microfone embutido com tecnologia de redução de ruído para chamadas.', dataPergunta: '2026-04-26T15:00:00Z', dataResposta: '2026-04-26T17:30:00Z', status: 'respondida' },
  { id: 12, anuncio: 'Teclado Mecânico TKL', cliente: 'Gustavo Pereira', pergunta: 'A iluminação RGB é configurável por software?', resposta: null, dataPergunta: '2026-04-25T11:30:00Z', dataResposta: null, status: 'pendente' },
];

export default function PerguntasPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | ''>('');
  const [perguntaRange, setPerguntaRange] = useState<[string | null, string | null]>([null, null]);
  const [respostaRange, setRespostaRange] = useState<[string | null, string | null]>([null, null]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});

  const handleReply = (id: number) => {
    console.log(`Reply to ${id}:`, replyTexts[id]);
  };

  const filtered = useMemo(() => {
    return mockPerguntas.filter(p => {
      if (search) {
        const q = search.toLowerCase();
        const fields = [String(p.id), p.anuncio, p.cliente, p.pergunta];
        if (!fields.some(f => f.toLowerCase().includes(q))) return false;
      }
      if (statusFilter && p.status !== statusFilter) return false;
      if (perguntaRange[0] && new Date(p.dataPergunta) < new Date(perguntaRange[0])) return false;
      if (perguntaRange[1]) {
        const end = new Date(perguntaRange[1]);
        end.setHours(23, 59, 59, 999);
        if (new Date(p.dataPergunta) > end) return false;
      }
      if (respostaRange[0] && p.dataResposta && new Date(p.dataResposta) < new Date(respostaRange[0])) return false;
      if (respostaRange[1] && p.dataResposta) {
        const end = new Date(respostaRange[1]);
        end.setHours(23, 59, 59, 999);
        if (new Date(p.dataResposta) > end) return false;
      }
      return true;
    });
  }, [search, statusFilter, perguntaRange, respostaRange]);

  const columns: TableProps<Pergunta>['columns'] = [
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 70,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: 'Anúncio', dataIndex: 'anuncio', key: 'anuncio',
      sorter: (a, b) => a.anuncio.localeCompare(b.anuncio),
    },
    {
      title: 'Cliente', dataIndex: 'cliente', key: 'cliente',
      sorter: (a, b) => a.cliente.localeCompare(b.cliente),
    },
    {
      title: 'Pergunta', dataIndex: 'pergunta', key: 'pergunta',
      sorter: (a, b) => a.pergunta.localeCompare(b.pergunta),
      render: (text: string) => (
        <div style={{ maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={text}>
          {text}
        </div>
      ),
    },
    {
      title: 'Data/Pergunta', dataIndex: 'dataPergunta', key: 'dataPergunta', width: 150,
      sorter: (a, b) => new Date(a.dataPergunta).getTime() - new Date(b.dataPergunta).getTime(),
      render: (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    },
    {
      title: 'Data/Resposta', dataIndex: 'dataResposta', key: 'dataResposta', width: 150,
      sorter: (a, b) => {
        if (!a.dataResposta) return 1;
        if (!b.dataResposta) return -1;
        return new Date(a.dataResposta).getTime() - new Date(b.dataResposta).getTime();
      },
      render: (d: string | null) => d
        ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (s: QuestionStatus) => (
        <Tag color={s === 'respondida' ? 'green' : 'orange'}>
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </Tag>
      ),
    },
    {
      title: 'Velocidade', key: 'velocidade', width: 100,
      sorter: (a, b) => {
        const ta = a.dataResposta ? new Date(a.dataResposta).getTime() - new Date(a.dataPergunta).getTime() : Infinity;
        const tb = b.dataResposta ? new Date(b.dataResposta).getTime() - new Date(b.dataPergunta).getTime() : Infinity;
        return ta - tb;
      },
      render: (_, record) => {
        if (!record.dataResposta) return <span style={{ color: '#666' }}>—</span>;
        const diffMs = new Date(record.dataResposta).getTime() - new Date(record.dataPergunta).getTime();
        const diffMin = diffMs / 60000;
        const rapido = diffMin <= 60;
        return (
          <Tag color={rapido ? 'green' : 'red'}>
            {rapido ? 'Rápido' : 'Lento'}
          </Tag>
        );
      },
    },
    {
      title: 'Ações', key: 'actions', width: 60, fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              ...(record.status === 'pendente' ? [{ key: 'answer', label: 'Responder' }] : [{ key: 'editAnswer', label: 'Editar Resposta' }]),
              { key: 'viewItem', label: 'Ver Anúncio' },
              { key: 'block', label: 'Bloquear Cliente' },
            ],
            onClick: ({ key }) => console.log(`${key} ${record.id}`),
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
      <Title level={4} style={{ color: '#e0e0e0', marginBottom: 16 }}>Perguntas - Mercado Livre</Title>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (ID, anúncio, cliente, pergunta)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </Col>
          <Col>
            <Select placeholder="Status" value={statusFilter || undefined} onChange={v => setStatusFilter(v as QuestionStatus | '')} options={statusOptions} style={{ width: 150 }} allowClear onClear={() => setStatusFilter('')} />
          </Col>
          <Col>
            <RangePicker
              onChange={(_, dateStrings) => setPerguntaRange([dateStrings[0] || null, dateStrings[1] || null])}
              format="DD/MM/YYYY"
              style={{ width: 230 }}
              placeholder={['Data perg. início', 'Data perg. fim']}
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(_, dateStrings) => setRespostaRange([dateStrings[0] || null, dateStrings[1] || null])}
              format="DD/MM/YYYY"
              style={{ width: 230 }}
              placeholder={['Data resp. início', 'Data resp. fim']}
            />
          </Col>
        </Row>
      </div>
      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <Table<Pergunta>
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: '4px 0' }}>
                {record.status === 'pendente' ? (
                  <div>
                    <Input.TextArea
                      rows={3}
                      placeholder="Digite sua resposta..."
                      value={replyTexts[record.id] ?? ''}
                      onChange={e => setReplyTexts(prev => ({ ...prev, [record.id]: e.target.value }))}
                      style={{ background: '#1f1f1f', border: '1px solid #303030', color: '#e0e0e0', borderRadius: 6 }}
                    />
                    <Button
                      type="primary"
                      size="small"
                      style={{ marginTop: 8 }}
                      onClick={() => handleReply(record.id)}
                    >
                      Responder
                    </Button>
                  </div>
                ) : (
                  <div style={{ color: '#c0c0c0', fontSize: 14, lineHeight: 1.7, padding: '4px 0' }}>
                    {record.resposta}
                  </div>
                )}
              </div>
            ),
            rowExpandable: () => true,
          }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `${t} perguntas` }}
          scroll={{ x: 1100 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>
    </div>
  );
}
