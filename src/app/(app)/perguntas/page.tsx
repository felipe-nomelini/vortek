'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Image,
  Input,
  Pagination,
  Popover,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  FilterOutlined,
  LinkOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { filterQuestionsOnCurrentPage } from '@/lib/ml/questions-page-filter';
import {
  BNT_D06_VISUAL_REVIEW,
  createQuestionHomologationFixtures,
} from '@/lib/ml/questions-homologation-fixtures';
import styles from './perguntas.module.css';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

type QuestionStatus = 'respondida' | 'pendente' | string;

interface Pergunta {
  id: number;
  itemId: string;
  anuncio: string;
  anuncioUrl: string | null;
  anuncioStatus: string | null;
  thumbnail: string | null;
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
  isHomologationFixture?: boolean;
}

interface PerguntasResponse {
  items: Pergunta[];
  total: number;
  limit: number;
  offset: number;
  account?: { id: string; nickname: string };
  updatedAt?: string;
  error?: string;
  precisaReconectar?: boolean;
}

const statusOptions = [
  { value: 'pendente', label: 'Não respondidas' },
  { value: 'respondida', label: 'Respondidas' },
  { value: '', label: 'Todos os estados' },
];
const PAGE_SIZE = 100;

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatElapsed(startValue: string, endValue?: string | null) {
  const start = new Date(startValue).getTime();
  const end = endValue ? new Date(endValue).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  const minutes = Math.max(0, Math.floor((end - start) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  return `${Math.floor(days / 30)} m`;
}

function releaseText(text: string, max = 120) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

function questionState(question: Pergunta) {
  const mlStatus = question.mlStatus.toUpperCase();
  if (question.removidaDoAnuncio || ['CLOSED_UNANSWERED', 'DELETED', 'DISABLED', 'BANNED'].includes(mlStatus)) {
    return { label: 'Indisponível', color: 'default' as const, kind: 'unavailable' as const };
  }
  if (question.hold || mlStatus === 'UNDER_REVIEW') {
    return { label: 'Em revisão', color: 'blue' as const, kind: 'review' as const };
  }
  if (question.status === 'respondida') {
    return { label: 'Respondida', color: 'green' as const, kind: 'answered' as const };
  }
  if (question.status === 'pendente') {
    return { label: 'Não respondida', color: 'gold' as const, kind: 'pending' as const };
  }
  return { label: question.status || 'Desconhecido', color: 'default' as const, kind: 'unavailable' as const };
}

function isOpenForAnswer(question: Pergunta) {
  return questionState(question).kind === 'pending' && question.mlStatus.toUpperCase() === 'UNANSWERED';
}

export default function PerguntasPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | ''>('pendente');
  const [perguntaRange, setPerguntaRange] = useState<[Date | null, Date | null]>([null, null]);
  const [respostaRange, setRespostaRange] = useState<[Date | null, Date | null]>([null, null]);
  const [questions, setQuestions] = useState<Pergunta[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<{ id: string; nickname: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [messageApi, contextHolder] = message.useMessage();

  const loadQuestions = useCallback(async (page: number) => {
    setLoading(true);
    setError(null);

    if (BNT_D06_VISUAL_REVIEW) {
      const fixtures = createQuestionHomologationFixtures();
      const items = (statusFilter
        ? fixtures.filter((question) => question.status === statusFilter)
        : fixtures)
        .sort((left, right) => {
          const difference = new Date(left.dataPergunta).getTime() - new Date(right.dataPergunta).getTime();
          return statusFilter === 'pendente' ? difference : -difference;
        });
      setQuestions(items);
      setTotal(items.length);
      setAccount(null);
      setUpdatedAt(new Date().toISOString());
      setCurrentPage(1);
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (statusFilter) params.set('status', statusFilter);
      const response = await fetch(`/api/perguntas?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as PerguntasResponse;
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar perguntas');
      setQuestions(data.items || []);
      setTotal(data.total || data.items?.length || 0);
      setAccount(data.account || null);
      setUpdatedAt(data.updatedAt || new Date().toISOString());
      setCurrentPage(page);
    } catch (loadError: any) {
      setError(loadError?.message || 'Erro ao carregar perguntas');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setQuestions([]);
    setTotal(0);
    setCurrentPage(1);
    setSelectedQuestionId(null);
    void loadQuestions(1);
  }, [loadQuestions]);

  const filtered = useMemo(() => filterQuestionsOnCurrentPage(questions, {
    search,
    questionDateRange: perguntaRange,
    answerDateRange: respostaRange,
  }), [questions, search, perguntaRange, respostaRange]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedQuestionId(null);
      return;
    }
    if (!selectedQuestionId || !filtered.some((question) => question.id === selectedQuestionId)) {
      setSelectedQuestionId(filtered[0].id);
    }
  }, [filtered, selectedQuestionId]);

  useEffect(() => {
    setAnswerText('');
  }, [selectedQuestionId]);

  const activeQuestion = filtered.find((question) => question.id === selectedQuestionId) || null;
  const pendingOnPage = filtered.filter((question) => questionState(question).kind === 'pending');
  const oldestPending = pendingOnPage.reduce<Pergunta | null>((oldest, question) => {
    if (!oldest) return question;
    return new Date(question.dataPergunta).getTime() < new Date(oldest.dataPergunta).getTime() ? question : oldest;
  }, null);
  const periodFilterCount = Number(Boolean(perguntaRange[0] || perguntaRange[1])) + Number(Boolean(respostaRange[0] || respostaRange[1]));

  const totalLabel = statusFilter === 'pendente'
    ? BNT_D06_VISUAL_REVIEW ? 'Não respondidas na amostra' : 'Não respondidas no Mercado Livre'
    : statusFilter === 'respondida'
      ? BNT_D06_VISUAL_REVIEW ? 'Respondidas na amostra' : 'Respondidas no Mercado Livre'
      : BNT_D06_VISUAL_REVIEW ? 'Total na amostra' : 'Total no Mercado Livre';

  const changePage = (page: number) => {
    setSelectedQuestionId(null);
    void loadQuestions(page);
  };

  const copyQuestion = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      messageApi.success('Pergunta copiada.');
    } catch {
      messageApi.error('Não foi possível copiar a pergunta.');
    }
  };

  const submitAnswer = async () => {
    if (!activeQuestion || !isOpenForAnswer(activeQuestion)) return;
    if (activeQuestion.isHomologationFixture) {
      messageApi.warning('A amostra de homologação não envia respostas ao Mercado Livre.');
      return;
    }
    const text = answerText.trim();
    if (!text) {
      messageApi.warning('Digite a resposta antes de enviar.');
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
      messageApi.success('Resposta enviada ao Mercado Livre.');
      setAnswerText('');
      await loadQuestions(currentPage);
    } catch (submitError: any) {
      messageApi.error(submitError?.message || 'Erro ao responder pergunta');
    } finally {
      setAnswering(false);
    }
  };

  const clearPeriods = () => {
    setPerguntaRange([null, null]);
    setRespostaRange([null, null]);
  };

  return (
    <div className={styles.page}>
      {contextHolder}
      <header className={styles.header}>
        <div>
          <Title level={2} className={styles.title}>Perguntas</Title>
          <Text type="secondary">Responda dúvidas pré-venda com o anúncio sempre em contexto.</Text>
          <Text type="secondary" className={styles.accountLine}>
            {BNT_D06_VISUAL_REVIEW
              ? 'Amostra sintética · nenhuma conta externa conectada'
              : account ? `${account.nickname} · conta ${account.id}` : 'Conta Mercado Livre'}
            {updatedAt ? ` · atualizado em ${formatDate(updatedAt)}` : ''}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadQuestions(currentPage)}>
          Atualizar
        </Button>
      </header>

      {BNT_D06_VISUAL_REVIEW ? (
        <Alert
          showIcon
          type="info"
          message="Amostra protegida de homologação"
          description="Todos os dados desta página são sintéticos. A consulta e o envio ao Mercado Livre estão desabilitados durante a aprovação visual."
        />
      ) : null}

      {error ? (
        <Alert
          showIcon
          type="error"
          message="Não foi possível atualizar as perguntas"
          description={`${error}${questions.length ? ' A fila anterior foi preservada.' : ''}`}
          action={<Button onClick={() => void loadQuestions(currentPage)}>Tentar novamente</Button>}
        />
      ) : null}

      <section className={styles.summaryBand} aria-label="Resumo das perguntas">
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>{totalLabel}</span>
          <strong className={styles.summaryValue}>{total}</strong>
          <span className={styles.summaryHint}>{BNT_D06_VISUAL_REVIEW ? 'Total do filtro na amostra' : 'Total global do filtro de status'}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Exibidas nesta página</span>
          <strong className={styles.summaryValue}>{filtered.length}<small> / {questions.length}</small></strong>
          <span className={styles.summaryHint}>Após busca e períodos locais</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Pendentes nesta página</span>
          <strong className={styles.summaryValue}>{pendingOnPage.length}</strong>
          <span className={styles.summaryHint}>Disponíveis para responder</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Mais antiga nesta página</span>
          <strong className={styles.summaryValue}>{oldestPending ? formatElapsed(oldestPending.dataPergunta) : '—'}</strong>
          <span className={styles.summaryHint}>Entre as pendentes exibidas</span>
        </div>
      </section>

      <section className={styles.filters} aria-label="Filtros de perguntas">
        <Select
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as QuestionStatus | '')}
          options={statusOptions}
          className={styles.statusSelect}
          aria-label="Status global das perguntas"
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar nesta página por pergunta, anúncio, cliente ou ID"
          className={styles.search}
        />
        <Popover
          trigger="click"
          placement="bottomRight"
          content={(
            <div className={styles.periodPopover}>
              <Text strong>Períodos nesta página</Text>
              <label>
                <Text type="secondary">Data da pergunta</Text>
                <RangePicker
                  value={perguntaRange[0] || perguntaRange[1] ? [
                    perguntaRange[0] ? dayjs(perguntaRange[0]) : null,
                    perguntaRange[1] ? dayjs(perguntaRange[1]) : null,
                  ] : null}
                  onChange={(dates) => setPerguntaRange([
                    dates?.[0]?.toDate?.() || null,
                    dates?.[1]?.toDate?.() || null,
                  ])}
                  format="DD/MM/YYYY"
                  placeholder={['Início', 'Fim']}
                />
              </label>
              <label>
                <Text type="secondary">Data da resposta</Text>
                <RangePicker
                  value={respostaRange[0] || respostaRange[1] ? [
                    respostaRange[0] ? dayjs(respostaRange[0]) : null,
                    respostaRange[1] ? dayjs(respostaRange[1]) : null,
                  ] : null}
                  onChange={(dates) => setRespostaRange([
                    dates?.[0]?.toDate?.() || null,
                    dates?.[1]?.toDate?.() || null,
                  ])}
                  format="DD/MM/YYYY"
                  placeholder={['Início', 'Fim']}
                />
              </label>
              <Button size="small" disabled={!periodFilterCount} onClick={clearPeriods}>Limpar períodos</Button>
            </div>
          )}
        >
          <Button icon={<FilterOutlined />}>Períodos{periodFilterCount ? ` (${periodFilterCount})` : ''}</Button>
        </Popover>
        <Text type="secondary" className={styles.scopeHint}>
          {BNT_D06_VISUAL_REVIEW
            ? 'Status, busca e períodos filtram somente os registros sintéticos desta amostra.'
            : <>Status consulta todas as perguntas no Mercado Livre. Busca e períodos filtram somente os até {PAGE_SIZE} registros desta página.</>}
        </Text>
      </section>

      <section className={styles.workspace} aria-label="Caixa de entrada de perguntas">
        <aside className={styles.queuePanel}>
          <div className={styles.panelHeader}>
            <div>
              <Text strong>Fila desta página</Text>
              <Text type="secondary">Selecione uma pergunta para responder</Text>
            </div>
            <span className={styles.queueCount}>{filtered.length}</span>
          </div>

          <div className={styles.queueList}>
            {loading && questions.length === 0 ? (
              <div className={styles.queueLoading}>
                {[1, 2, 3, 4].map((item) => <Skeleton key={item} active avatar paragraph={{ rows: 2 }} />)}
              </div>
            ) : filtered.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={search || periodFilterCount ? 'Nenhuma pergunta nesta página corresponde aos filtros' : 'Nenhuma pergunta neste estado'}
              />
            ) : filtered.map((question) => {
              const state = questionState(question);
              const selected = question.id === selectedQuestionId;
              return (
                <button
                  type="button"
                  key={question.id}
                  className={`${styles.queueItem} ${selected ? styles.queueItemSelected : ''}`}
                  aria-pressed={selected}
                  onClick={() => setSelectedQuestionId(question.id)}
                >
                  <div className={styles.queueItemTop}>
                    <span className={styles.age}><ClockCircleOutlined /> {formatElapsed(question.dataPergunta)}</span>
                    <Tag color={state.color}>{state.label}</Tag>
                  </div>
                  <strong className={styles.questionPreview}>{releaseText(question.pergunta, 145) || 'Texto indisponível no Mercado Livre'}</strong>
                  <span className={styles.itemPreview}>{releaseText(question.anuncio, 80)}</span>
                  <span className={styles.queueMeta}>{question.itemId} · {formatDate(question.dataPergunta)}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.pagination}>
            <Pagination
              current={currentPage}
              pageSize={PAGE_SIZE}
              total={total}
              showSizeChanger={false}
              showLessItems
              hideOnSinglePage={false}
              disabled={loading}
              onChange={changePage}
              showTotal={(count) => `${count} ${BNT_D06_VISUAL_REVIEW ? 'na amostra' : 'no filtro global'}`}
            />
          </div>
        </aside>

        <article className={styles.detailPanel}>
          {loading && questions.length === 0 ? (
            <div className={styles.detailLoading}><Skeleton active avatar paragraph={{ rows: 8 }} /></div>
          ) : !activeQuestion ? (
            <Empty
              image={<QuestionCircleOutlined className={styles.emptyIcon} />}
              description="Selecione uma pergunta para ver o contexto"
            />
          ) : (() => {
            const state = questionState(activeQuestion);
            const answerable = isOpenForAnswer(activeQuestion);
            return (
              <>
                <div className={styles.itemContext}>
                  <div className={styles.thumbnail}>
                    {activeQuestion.thumbnail ? (
                      <Image src={activeQuestion.thumbnail} alt={activeQuestion.anuncio} preview={false} />
                    ) : <QuestionCircleOutlined />}
                  </div>
                  <div className={styles.itemIdentity}>
                    <Text type="secondary">Anúncio</Text>
                    <strong>{activeQuestion.anuncio}</strong>
                    <span>{activeQuestion.itemId}{activeQuestion.anuncioStatus ? ` · ${activeQuestion.anuncioStatus}` : ''}</span>
                  </div>
                  <Space>
                    <Tooltip title="Copiar pergunta">
                      <Button aria-label="Copiar pergunta" icon={<CopyOutlined />} onClick={() => void copyQuestion(activeQuestion.pergunta)} />
                    </Tooltip>
                    {activeQuestion.anuncioUrl ? (
                      <Button icon={<LinkOutlined />} href={activeQuestion.anuncioUrl} target="_blank" rel="noreferrer">Abrir anúncio</Button>
                    ) : null}
                  </Space>
                </div>

                <div className={styles.detailBody}>
                  <div className={styles.questionHeader}>
                    <div>
                      <span className={styles.eyebrow}>Pergunta do cliente</span>
                      <Title level={4} className={styles.questionTitle}>{activeQuestion.pergunta || 'Texto indisponível no Mercado Livre'}</Title>
                    </div>
                    <Tag color={state.color}>{state.label}</Tag>
                  </div>

                  <div className={styles.metadata}>
                    <div><span>Cliente</span><strong>{activeQuestion.cliente}</strong></div>
                    <div><span>ID do cliente</span><strong>{activeQuestion.clienteId || 'Não informado'}</strong></div>
                    <div><span>Recebida em</span><strong>{formatDate(activeQuestion.dataPergunta)}</strong></div>
                    <div><span>Aguardando</span><strong>{formatElapsed(activeQuestion.dataPergunta, activeQuestion.dataResposta)}</strong></div>
                  </div>

                  {state.kind === 'answered' ? (
                    <section className={styles.answerCard}>
                      <div className={styles.answerHeading}>
                        <span><CheckCircleOutlined /> Resposta enviada</span>
                        <Text type="secondary">{formatDate(activeQuestion.dataResposta)}</Text>
                      </div>
                      <p>{activeQuestion.resposta || 'O Mercado Livre não disponibilizou o texto desta resposta.'}</p>
                      {activeQuestion.respostaStatus && <Text type="secondary">Estado no Mercado Livre: {activeQuestion.respostaStatus}</Text>}
                    </section>
                  ) : answerable ? (
                    <section className={styles.composer}>
                      <div className={styles.composerHeading}>
                        <div>
                          <Text strong>Sua resposta</Text>
                          <Text type="secondary">
                            {activeQuestion.isHomologationFixture
                              ? 'Digite para avaliar o compositor. Nenhum conteúdo será enviado.'
                              : 'Será enviada diretamente ao Mercado Livre.'}
                          </Text>
                        </div>
                      </div>
                      <Input.TextArea
                        autoFocus
                        autoSize={{ minRows: 7, maxRows: 12 }}
                        value={answerText}
                        onChange={(event) => setAnswerText(event.target.value)}
                        placeholder="Digite uma resposta clara e objetiva para o cliente…"
                        maxLength={2000}
                        showCount
                        disabled={answering}
                      />
                      <div className={styles.composerActions}>
                        <Text type="secondary">Revise antes de enviar. A resposta ficará pública no anúncio.</Text>
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          loading={answering}
                          disabled={Boolean(activeQuestion.isHomologationFixture || !answerText.trim())}
                          title={activeQuestion.isHomologationFixture ? 'Envio desabilitado na amostra protegida' : undefined}
                          onClick={() => void submitAnswer()}
                        >
                          Enviar resposta
                        </Button>
                      </div>
                    </section>
                  ) : (
                    <Alert
                      showIcon
                      type={state.kind === 'review' ? 'info' : 'warning'}
                      message={state.kind === 'review' ? 'Pergunta em revisão no Mercado Livre' : 'Pergunta indisponível para resposta'}
                      description={state.kind === 'review'
                        ? 'O campo de resposta será liberado somente se o Mercado Livre devolver a pergunta ao estado não respondido.'
                        : 'O anúncio ou a pergunta não aceita resposta neste estado. Consulte o anúncio para mais detalhes.'}
                    />
                  )}
                </div>
              </>
            );
          })()}
        </article>
      </section>
    </div>
  );
}
