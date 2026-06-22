'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Col, DatePicker, Dropdown, Input, Modal, Row, Select, Space, Statistic, Tag, Typography, message } from 'antd';
import ResizableTable from '@/components/ResizableTable';
import type { TableProps } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

type QuestionStatus = 'respondida' | 'pendente' | string;

interface Pergunta {
  id: number;
  itemId: string;
  anuncio: string;
  anuncioUrl: string | null;
  anuncioStatus: string | null;
  cliente: string;
  clienteId: number | null;
  pergunta: string;
  resposta: string | null;
  dataPergunta: string;
  dataResposta: string | null;
  status: QuestionStatus;
  mlStatus: string;
  respostaStatus: string | null;
  hold: boolean;
  removidaDoAnuncio: boolean;
  tags: string[];
  categoriasIa: string[];
}

interface PerguntasResponse {
  items: Pergunta[];
  total: number;
  limit: number;
  offset: number;
  error?: string;
  precisaReconectar?: boolean;
}

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'respondida', label: 'Respondida' },
];

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusTag(status: QuestionStatus) {
  if (status === 'respondida') return <Tag color="green">Respondida</Tag>;
  if (status === 'pendente') return <Tag color="orange">Pendente</Tag>;
  return <Tag color="blue">{String(status || 'desconhecido')}</Tag>;
}

function releaseText(text: string, max = 120) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

export default function PerguntasPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | ''>('');
  const [perguntaRange, setPerguntaRange] = useState<[Date | null, Date | null]>([null, null]);
  const [respostaRange, setRespostaRange] = useState<[Date | null, Date | null]>([null, null]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [questions, setQuestions] = useState<Pergunta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerModalOpen, setAnswerModalOpen] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<Pergunta | null>(null);
  const [answerText, setAnswerText] = useState('');

  const loadQuestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100', offset: '0' });
      if (statusFilter) params.set('status', statusFilter);
      const response = await fetch(`/api/perguntas?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as PerguntasResponse;
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar perguntas');
      setQuestions(data.items || []);
      setTotal(data.total || data.items?.length || 0);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar perguntas');
      setQuestions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const pendingCount = questions.filter((question) => question.status === 'pendente').length;
  const answeredCount = questions.filter((question) => question.status === 'respondida').length;

  const filtered = useMemo(() => {
    return questions.filter((question) => {
      if (search) {
        const q = search.toLowerCase();
        const fields = [
          String(question.id),
          question.itemId,
          question.anuncio,
          question.cliente,
          question.pergunta,
          question.resposta || '',
        ];
        if (!fields.some((field) => field.toLowerCase().includes(q))) return false;
      }

      const perguntaDate = new Date(question.dataPergunta);
      if (perguntaRange[0] && perguntaDate < perguntaRange[0]) return false;
      if (perguntaRange[1]) {
        const end = new Date(perguntaRange[1]);
        end.setHours(23, 59, 59, 999);
        if (perguntaDate > end) return false;
      }

      if (question.dataResposta) {
        const respostaDate = new Date(question.dataResposta);
        if (respostaRange[0] && respostaDate < respostaRange[0]) return false;
        if (respostaRange[1]) {
          const end = new Date(respostaRange[1]);
          end.setHours(23, 59, 59, 999);
          if (respostaDate > end) return false;
        }
      } else if (respostaRange[0] || respostaRange[1]) {
        return false;
      }

      return true;
    });
  }, [questions, search, perguntaRange, respostaRange]);

  const openAnswerModal = (question: Pergunta) => {
    setActiveQuestion(question);
    setAnswerText('');
    setAnswerModalOpen(true);
  };

  const submitAnswer = async () => {
    if (!activeQuestion) return;
    const text = answerText.trim();
    if (!text) {
      message.warning('Digite a resposta antes de enviar.');
      return;
    }

    setAnswering(true);
    try {
      const response = await fetch(`/api/perguntas/${activeQuestion.id}/responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Falha ao responder pergunta');
      message.success('Resposta enviada ao Mercado Livre.');
      setAnswerModalOpen(false);
      setActiveQuestion(null);
      setAnswerText('');
      await loadQuestions();
    } catch (err: any) {
      message.error(err?.message || 'Erro ao responder pergunta');
    } finally {
      setAnswering(false);
    }
  };

  const columns: TableProps<Pergunta>['columns'] = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 110,
      sorter: (a, b) => a.id - b.id,
      render: (id: number) => <Text copyable style={{ color: '#1677ff' }}>{id}</Text>,
    },
    {
      title: 'Anúncio',
      dataIndex: 'anuncio',
      key: 'anuncio',
      width: 280,
      sorter: (a, b) => a.anuncio.localeCompare(b.anuncio),
      render: (text: string, record) => (
        <div>
          {record.anuncioUrl ? (
            <a href={record.anuncioUrl} target="_blank" rel="noreferrer">{releaseText(text, 75)}</a>
          ) : (
            <Text style={{ color: '#e0e0e0' }}>{releaseText(text, 75)}</Text>
          )}
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>{record.itemId}</div>
        </div>
      ),
    },
    {
      title: 'Cliente',
      dataIndex: 'cliente',
      key: 'cliente',
      width: 130,
      sorter: (a, b) => a.cliente.localeCompare(b.cliente),
      render: (cliente: string, record) => (
        <div>
          <Text style={{ color: '#e0e0e0' }}>{cliente}</Text>
          {record.clienteId ? <div style={{ color: '#8c8c8c', fontSize: 12 }}>{record.clienteId}</div> : null}
        </div>
      ),
    },
    {
      title: 'Pergunta',
      dataIndex: 'pergunta',
      key: 'pergunta',
      width: 340,
      sorter: (a, b) => a.pergunta.localeCompare(b.pergunta),
      render: (text: string) => (
        <div style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
          {releaseText(text, 180)}
        </div>
      ),
    },
    {
      title: 'Data/Pergunta',
      dataIndex: 'dataPergunta',
      key: 'dataPergunta',
      width: 155,
      sorter: (a, b) => new Date(a.dataPergunta).getTime() - new Date(b.dataPergunta).getTime(),
      render: (date: string) => formatDate(date) || '—',
    },
    {
      title: 'Data/Resposta',
      dataIndex: 'dataResposta',
      key: 'dataResposta',
      width: 155,
      sorter: (a, b) => {
        const ta = a.dataResposta ? new Date(a.dataResposta).getTime() : Infinity;
        const tb = b.dataResposta ? new Date(b.dataResposta).getTime() : Infinity;
        return ta - tb;
      },
      render: (date: string | null) => formatDate(date) || <span style={{ color: '#666' }}>—</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      sorter: (a, b) => String(a.status).localeCompare(String(b.status)),
      render: statusTag,
    },
    {
      title: 'Velocidade',
      key: 'velocidade',
      width: 110,
      sorter: (a, b) => {
        const ta = a.dataResposta ? new Date(a.dataResposta).getTime() - new Date(a.dataPergunta).getTime() : Infinity;
        const tb = b.dataResposta ? new Date(b.dataResposta).getTime() - new Date(b.dataPergunta).getTime() : Infinity;
        return ta - tb;
      },
      render: (_, record) => {
        if (!record.dataResposta) return <span style={{ color: '#666' }}>—</span>;
        const diffMin = (new Date(record.dataResposta).getTime() - new Date(record.dataPergunta).getTime()) / 60000;
        if (diffMin <= 60) return <Tag color="green">Rápido</Tag>;
        if (diffMin <= 240) return <Tag color="gold">Normal</Tag>;
        return <Tag color="red">Lento</Tag>;
      },
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 70,
      fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              record.status === 'pendente'
                ? { key: 'answer', label: 'Responder' }
                : { key: 'viewAnswer', label: 'Ver resposta' },
              record.anuncioUrl ? { key: 'viewItem', label: 'Ver anúncio' } : null,
              { key: 'copyQuestion', label: 'Copiar pergunta' },
            ].filter(Boolean) as any,
            onClick: ({ key }) => {
              if (key === 'answer') openAnswerModal(record);
              if (key === 'viewItem' && record.anuncioUrl) window.open(record.anuncioUrl, '_blank', 'noopener,noreferrer');
              if (key === 'copyQuestion') {
                navigator.clipboard?.writeText(record.pergunta);
                message.success('Pergunta copiada.');
              }
            },
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

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
            <Statistic title="Perguntas carregadas" value={filtered.length} suffix={`/ ${total}`} />
          </div>
        </Col>
        <Col xs={24} sm={8}>
          <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
            <Statistic title="Pendentes" value={pendingCount} valueStyle={{ color: pendingCount ? '#faad14' : '#52c41a' }} />
          </div>
        </Col>
        <Col xs={24} sm={8}>
          <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
            <Statistic title="Respondidas" value={answeredCount} valueStyle={{ color: '#52c41a' }} />
          </div>
        </Col>
      </Row>

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (ID, anúncio, cliente, pergunta)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 300 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={(value) => setStatusFilter(value as QuestionStatus | '')}
              options={statusOptions}
              style={{ width: 160 }}
              allowClear
              onClear={() => setStatusFilter('')}
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(dates) => setPerguntaRange([
                dates?.[0]?.toDate?.() || null,
                dates?.[1]?.toDate?.() || null,
              ])}
              format="DD/MM/YYYY"
              style={{ width: 250 }}
              placeholder={['Pergunta início', 'Pergunta fim']}
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(dates) => setRespostaRange([
                dates?.[0]?.toDate?.() || null,
                dates?.[1]?.toDate?.() || null,
              ])}
              format="DD/MM/YYYY"
              style={{ width: 250 }}
              placeholder={['Resposta início', 'Resposta fim']}
            />
          </Col>
          <Col flex="auto" />
          <Col>
            <Button icon={<ReloadOutlined />} onClick={loadQuestions} loading={loading}>
              Atualizar
            </Button>
          </Col>
        </Row>
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Falha ao carregar perguntas"
          description={error}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 16 }}>
        <ResizableTable<Pergunta>
          storageKey="perguntas"
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: '8px 0', color: '#c0c0c0', lineHeight: 1.7 }}>
                <Text strong style={{ color: '#e0e0e0' }}>Pergunta:</Text>
                <div style={{ marginBottom: 8 }}>{record.pergunta}</div>
                <Text strong style={{ color: '#e0e0e0' }}>Resposta:</Text>
                {record.resposta ? (
                  <div>{record.resposta}</div>
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Text type="secondary">Ainda sem resposta no Mercado Livre.</Text>
                    <Button type="primary" size="small" icon={<SendOutlined />} onClick={() => openAnswerModal(record)}>
                      Responder agora
                    </Button>
                  </Space>
                )}
              </div>
            ),
            rowExpandable: () => true,
          }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (count) => `${count} perguntas` }}
          scroll={{ x: 1350 }}
          style={{ background: 'transparent' }}
          size="small"
        />
      </div>

      <Modal
        title="Responder pergunta no Mercado Livre"
        open={answerModalOpen}
        onCancel={() => setAnswerModalOpen(false)}
        onOk={submitAnswer}
        okText="Enviar resposta"
        cancelText="Cancelar"
        confirmLoading={answering}
        okButtonProps={{ icon: <SendOutlined /> }}
      >
        {activeQuestion ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">Anúncio</Text>
              <div>{activeQuestion.anuncio}</div>
            </div>
            <div>
              <Text type="secondary">Pergunta</Text>
              <div style={{ color: '#e0e0e0' }}>{activeQuestion.pergunta}</div>
            </div>
            <Input.TextArea
              rows={5}
              value={answerText}
              onChange={(event) => setAnswerText(event.target.value)}
              placeholder="Digite a resposta que será enviada ao Mercado Livre..."
              maxLength={2000}
              showCount
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
