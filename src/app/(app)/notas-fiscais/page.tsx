'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert, Button, Card, Col, DatePicker, Dropdown, Empty, Input, InputNumber,
  Modal, Row, Select, Space, Tabs, Tag, Typography, message,
} from 'antd';
import type { TablePaginationConfig, TableProps } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import {
  DownloadOutlined, EllipsisOutlined, EyeOutlined, FilePdfOutlined,
  MailOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SyncOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import NotaFiscalDetailsDrawer, {
  getFiscalStatusPresentation,
  type NotaFiscalRow,
} from '@/components/fiscal/NotaFiscalDetailsDrawer';
import { formatCurrency } from '@/lib/format';
import {
  BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS,
  isNfeCancelRejectedDeadlineStatus,
  type NfeTechnicalStatus,
} from '@/lib/fiscal/nfe-status';
import type { PedidoVendaDetalheApiResponse, PedidoVendaHistoricoApiDto } from '@/types/order';
import FiscalReturnModal from '@/components/fiscal/FiscalReturnModal';
import FiscalReturnsPanel from '@/components/fiscal/FiscalReturnsPanel';
import IncomingInvoicesPanel from '@/components/fiscal/IncomingInvoicesPanel';
import { hasPermission, type VortekRole } from '@/lib/permissions';
import styles from './notas-fiscais.module.css';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;
const PAGE_SIZE = 100;
const POLLING_INTERVAL_MS = 5000;

type SortOrder = 'asc' | 'desc';

interface FiscalSummary {
  total: number;
  emitidas: number;
  pendentes: number;
  com_erro: number;
  valor_autorizado: number;
  imposto_estimado_mes: {
    competence: string;
    grossRevenue: number;
    rate: number | null;
    estimatedAmount: number | null;
    source: string;
    warning: string;
  } | null;
}

const EMPTY_SUMMARY: FiscalSummary = {
  total: 0,
  emitidas: 0,
  pendentes: 0,
  com_erro: 0,
  valor_autorizado: 0,
  imposto_estimado_mes: null,
};

const VALID_ROLES: VortekRole[] = ['admin', 'gerente', 'operador', 'visualizador'];

const statusOptions: Array<{ value: NfeTechnicalStatus; label: string }> = [
  { value: 'autorizada', label: 'Autorizada' },
  { value: 'cancelada', label: 'Cancelada' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'interrompida', label: 'Interrompida' },
  { value: 'rejeitada', label: 'Rejeitada' },
  { value: 'processando', label: 'Processando' },
  { value: 'outro', label: 'Outro / não encontrada' },
];

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatDateParts(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: 'Ainda não emitida', time: '' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: value, time: '' };
  return {
    date: parsed.toLocaleDateString('pt-BR'),
    time: parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

function formatDocument(value: string | null | undefined): string {
  const document = String(value || '').replace(/\D/g, '');
  if (document.length === 11) {
    return `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`;
  }
  if (document.length === 14) {
    return `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
  }
  return value || 'Documento não informado';
}

function nextActionLabel(note: NotaFiscalRow): string {
  if (note.nfe_status === BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS) return 'Revisar a emissão antes de reconciliar';
  if (isNfeCancelRejectedDeadlineStatus(note.nfe_status)) return 'Seguir o procedimento fiscal fora do prazo';
  if (note.status === 'cancelada') return 'Fluxo fiscal encerrado';
  if (note.status === 'autorizada') return 'Consultar ou enviar os documentos';
  if (note.status === 'processando') return 'Aguardar processamento e reconciliação';
  if (note.status === 'pendente') return 'Aguardar emissão da NF-e';
  if (note.status === 'interrompida' || note.status === 'rejeitada') return 'Revisar a falha no histórico fiscal';
  return 'Revisar o estado fiscal';
}

function primaryAction(note: NotaFiscalRow): 'danfe' | 'details' {
  return note.status === 'autorizada' && note.numero !== '—' && !note.is_homologation_fixture
    ? 'danfe'
    : 'details';
}

export default function NotasFiscaisPage() {
  const [rows, setRows] = useState<NotaFiscalRow[]>([]);
  const [summary, setSummary] = useState<FiscalSummary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [lastSearch, setLastSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NfeTechnicalStatus | ''>('');
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
  const [valorMin, setValorMin] = useState<number | null>(null);
  const [valorMax, setValorMax] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState('data');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [sendingRowId, setSendingRowId] = useState<string | null>(null);
  const [actionRowId, setActionRowId] = useState<string | null>(null);
  const [drawerNote, setDrawerNote] = useState<NotaFiscalRow | null>(null);
  const [drawerHistory, setDrawerHistory] = useState<PedidoVendaHistoricoApiDto[]>([]);
  const [drawerHistoryLoading, setDrawerHistoryLoading] = useState(false);
  const [drawerHistoryError, setDrawerHistoryError] = useState<string | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<NotaFiscalRow | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<NotaFiscalRow | null>(null);
  const [cancelReason, setCancelReason] = useState('Cancelamento operacional da NF-e solicitada pelo usuário');
  const [cancelConfirmText, setCancelConfirmText] = useState('');
  const [cceModalOpen, setCceModalOpen] = useState(false);
  const [cceTarget, setCceTarget] = useState<NotaFiscalRow | null>(null);
  const [cceText, setCceText] = useState('');
  const [cceSeq, setCceSeq] = useState(1);
  const [role, setRole] = useState<VortekRole | null>(null);
  const [activeTab, setActiveTab] = useState<'sales' | 'incoming' | 'returns'>('sales');
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnsRefreshToken, setReturnsRefreshToken] = useState(0);
  const [messageApi, contextHolder] = message.useMessage();
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingInFlightRef = useRef(false);
  const requestSequence = useRef(0);
  const historyRequestSequence = useRef(0);
  const canManageFiscal = Boolean(role && hasPermission(role, 'fiscal.manage'));

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => {
        const cargo = profile?.cargo as VortekRole | undefined;
        setRole(cargo && VALID_ROLES.includes(cargo) ? cargo : null);
      })
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSearch = params.get('search')?.trim() || '';
    const initialStatus = params.get('status') || '';
    setSearch(initialSearch);
    setLastSearch(initialSearch);
    setStatusFilter(statusOptions.some((option) => option.value === initialStatus) ? initialStatus as NfeTechnicalStatus : '');
    setDateRange([params.get('dateFrom'), params.get('dateTo')]);
    const initialMin = params.get('valorMin');
    const initialMax = params.get('valorMax');
    setValorMin(initialMin === null || initialMin === '' ? null : Number(initialMin));
    setValorMax(initialMax === null || initialMax === '' ? null : Number(initialMax));
    setPage(parsePositiveInteger(params.get('page'), 1));
    setSortBy(params.get('sortBy') || 'data');
    setSortOrder(params.get('sortOrder') === 'asc' ? 'asc' : 'desc');
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== lastSearch) {
        setPage(1);
        setLastSearch(search.trim());
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [lastSearch, search]);

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (lastSearch) params.set('search', lastSearch);
    if (statusFilter) params.set('status', statusFilter);
    if (dateRange[0]) params.set('dateFrom', dateRange[0]);
    if (dateRange[1]) params.set('dateTo', dateRange[1]);
    if (valorMin !== null && Number.isFinite(valorMin)) params.set('valorMin', String(valorMin));
    if (valorMax !== null && Number.isFinite(valorMax)) params.set('valorMax', String(valorMax));
    return params;
  }, [dateRange, lastSearch, statusFilter, valorMax, valorMin]);

  const buildListParams = useCallback(() => {
    const params = buildFilterParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    params.set('sortBy', sortBy);
    params.set('sortOrder', sortOrder);
    return params;
  }, [buildFilterParams, page, sortBy, sortOrder]);

  useEffect(() => {
    if (!filtersHydrated) return;
    const params = buildListParams();
    if (page === 1) params.delete('page');
    params.delete('pageSize');
    if (sortBy === 'data') params.delete('sortBy');
    if (sortOrder === 'desc') params.delete('sortOrder');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [buildListParams, filtersHydrated, page, sortBy, sortOrder]);

  const fetchNotas = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background === true;
    const sequence = ++requestSequence.current;
    if (!background) {
      setListLoading(true);
      setSummaryLoading(true);
    }
    setListError(null);
    setSummaryError(null);

    const parseResponse = async (response: Response, fallback: string) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.erro || payload?.error || fallback);
      return payload;
    };
    const listRequest = fetch(`/api/notas-fiscais?${buildListParams().toString()}`, { cache: 'no-store' })
      .then((response) => parseResponse(response, 'Não foi possível carregar as notas fiscais.'));
    const summaryRequest = fetch(`/api/notas-fiscais/resumo?${buildFilterParams().toString()}`, { cache: 'no-store' })
      .then((response) => parseResponse(response, 'Não foi possível carregar o resumo fiscal.'));
    const [listResult, summaryResult] = await Promise.allSettled([listRequest, summaryRequest]);

    if (sequence !== requestSequence.current) return;
    if (listResult.status === 'fulfilled') {
      setRows((listResult.value.data || []) as NotaFiscalRow[]);
      setTotal(Number(listResult.value.total || 0));
      setDrawerNote((current) => current
        ? (listResult.value.data || []).find((note: NotaFiscalRow) => note.id === current.id) || current
        : null);
      setLastUpdatedAt(new Date());
    } else {
      setListError(listResult.reason instanceof Error ? listResult.reason.message : 'Não foi possível carregar as notas fiscais.');
    }
    if (summaryResult.status === 'fulfilled') {
      setSummary({
        total: Number(summaryResult.value.total || 0),
        emitidas: Number(summaryResult.value.emitidas || 0),
        pendentes: Number(summaryResult.value.pendentes || 0),
        com_erro: Number(summaryResult.value.com_erro || 0),
        valor_autorizado: Number(summaryResult.value.valor_autorizado || 0),
        imposto_estimado_mes: summaryResult.value.imposto_estimado_mes
          ? {
              competence: String(summaryResult.value.imposto_estimado_mes.competence || ''),
              grossRevenue: Number(summaryResult.value.imposto_estimado_mes.grossRevenue || 0),
              rate: summaryResult.value.imposto_estimado_mes.rate == null
                ? null
                : Number(summaryResult.value.imposto_estimado_mes.rate),
              estimatedAmount: summaryResult.value.imposto_estimado_mes.estimatedAmount == null
                ? null
                : Number(summaryResult.value.imposto_estimado_mes.estimatedAmount),
              source: String(summaryResult.value.imposto_estimado_mes.source || ''),
              warning: String(summaryResult.value.imposto_estimado_mes.warning || ''),
            }
          : null,
      });
    } else {
      setSummaryError(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Não foi possível carregar o resumo fiscal.');
    }
    if (!background) {
      setListLoading(false);
      setSummaryLoading(false);
    }
  }, [buildFilterParams, buildListParams]);

  useEffect(() => {
    if (filtersHydrated) void fetchNotas();
  }, [fetchNotas, filtersHydrated]);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const scheduleNextPoll = useCallback(() => {
    clearPolling();
    pollingRef.current = setTimeout(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        scheduleNextPoll();
        return;
      }
      if (pollingInFlightRef.current) {
        scheduleNextPoll();
        return;
      }
      pollingInFlightRef.current = true;
      try {
        await fetchNotas({ background: true });
      } finally {
        pollingInFlightRef.current = false;
        scheduleNextPoll();
      }
    }, POLLING_INTERVAL_MS);
  }, [clearPolling, fetchNotas]);

  useEffect(() => {
    if (!filtersHydrated) return;
    scheduleNextPoll();
    return clearPolling;
  }, [clearPolling, filtersHydrated, scheduleNextPoll]);

  const resolvePdfUrl = useCallback(async (note: NotaFiscalRow): Promise<string | null> => {
    const response = await fetch(`/api/notas-fiscais/${note.id}/pdf`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.url) {
      messageApi.error(payload?.error || 'Não foi possível localizar a DANFE.');
      return null;
    }
    return String(payload.url);
  }, [messageApi]);

  const handleViewDanfe = useCallback(async (note: NotaFiscalRow) => {
    const url = await resolvePdfUrl(note);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, [resolvePdfUrl]);

  const handleDownloadDanfe = useCallback(async (note: NotaFiscalRow) => {
    const url = await resolvePdfUrl(note);
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `danfe_${note.numero || note.pedido}.pdf`;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [resolvePdfUrl]);

  const handleDownloadXml = useCallback((note: NotaFiscalRow) => {
    const anchor = document.createElement('a');
    anchor.href = `/api/notas-fiscais/${note.id}/xml`;
    anchor.download = `nfe_${note.numero || note.pedido}.xml`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const openDrawer = useCallback(async (note: NotaFiscalRow) => {
    const sequence = ++historyRequestSequence.current;
    setDrawerNote(note);
    setDrawerHistory([]);
    setDrawerHistoryError(null);
    setDrawerHistoryLoading(true);
    try {
      const response = await fetch(`/api/pedidos/${note.id}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as {
        data?: PedidoVendaDetalheApiResponse['data'] | null;
        error?: { message?: string } | null;
      };
      if (sequence !== historyRequestSequence.current) return;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'Não foi possível carregar o histórico fiscal.');
      setDrawerHistory(payload.data.history || []);
    } catch (error) {
      if (sequence === historyRequestSequence.current) {
        setDrawerHistoryError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico fiscal.');
      }
    } finally {
      if (sequence === historyRequestSequence.current) setDrawerHistoryLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    historyRequestSequence.current += 1;
    setDrawerNote(null);
    setDrawerHistory([]);
    setDrawerHistoryError(null);
    setDrawerHistoryLoading(false);
  }, []);

  const openEmailModal = useCallback((note: NotaFiscalRow) => {
    setEmailTarget(note);
    setEmailTo('');
    setEmailSubject(`NF-e ${note.numero} - Pedido #${String(note.pedido).padStart(6, '0')}`);
    setEmailBody(`Olá ${note.cliente},\n\nSegue em anexo a DANFE da NF-e ${note.numero}.\n\nMensagem automática Bentevi.`);
    setEmailModalOpen(true);
  }, []);

  const handleSendEmail = useCallback(async () => {
    if (!emailTarget) return;
    setSendingRowId(emailTarget.id);
    try {
      const response = await fetch(`/api/notas-fiscais/${emailTarget.id}/enviar-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emailTo || undefined, subject: emailSubject || undefined, message: emailBody || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao enviar a nota fiscal por e-mail.');
      messageApi.success(`NF-e enviada para ${payload.to}.`);
      setEmailModalOpen(false);
      setEmailTarget(null);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Falha ao enviar a nota fiscal por e-mail.');
    } finally {
      setSendingRowId(null);
    }
  }, [emailBody, emailSubject, emailTarget, emailTo, messageApi]);

  const openCancelModal = useCallback((note: NotaFiscalRow) => {
    setCancelTarget(note);
    setCancelReason('Cancelamento operacional da NF-e solicitada pelo usuário');
    setCancelConfirmText('');
    setCancelModalOpen(true);
  }, []);

  const submitCancelNfe = useCallback(async () => {
    if (!cancelTarget) return;
    if (cancelConfirmText.trim().toUpperCase() !== 'CANCELAR') {
      messageApi.error('Digite CANCELAR para confirmar.');
      return;
    }
    setActionRowId(cancelTarget.id);
    try {
      const response = await fetch(`/api/notas-fiscais/${cancelTarget.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justificativa: cancelReason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao cancelar a nota fiscal.');
      messageApi.success(payload?.alreadyCanceled ? 'A nota fiscal já estava cancelada.' : 'Nota fiscal cancelada com sucesso.');
      setCancelModalOpen(false);
      setCancelTarget(null);
      await fetchNotas({ background: true });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Falha ao cancelar a nota fiscal.');
    } finally {
      setActionRowId(null);
    }
  }, [cancelConfirmText, cancelReason, cancelTarget, fetchNotas, messageApi]);

  const openCceModal = useCallback((note: NotaFiscalRow) => {
    setCceTarget(note);
    setCceText('');
    setCceSeq(1);
    setCceModalOpen(true);
  }, []);

  const submitCartaCorrecao = useCallback(async () => {
    if (!cceTarget) return;
    if (cceText.trim().length < 15) {
      messageApi.error('A correção deve ter no mínimo 15 caracteres.');
      return;
    }
    setActionRowId(cceTarget.id);
    try {
      const response = await fetch(`/api/notas-fiscais/${cceTarget.id}/carta-correcao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correcao: cceText, numeroSequencial: cceSeq }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao enviar a carta de correção.');
      messageApi.success(`Carta de correção enviada${payload?.protocolo ? ` (protocolo ${payload.protocolo})` : ''}.`);
      setCceModalOpen(false);
      setCceTarget(null);
      await fetchNotas({ background: true });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Falha ao enviar a carta de correção.');
    } finally {
      setActionRowId(null);
    }
  }, [cceSeq, cceTarget, cceText, fetchNotas, messageApi]);

  const reconcileNow = useCallback(async () => {
    setReconciling(true);
    try {
      const response = await fetch('/api/sync/nf/reconciliar-brasilnfe/job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível iniciar a reconciliação.');
      if (payload?.throttled) messageApi.info('A reconciliação foi executada há pouco. Aguarde a próxima janela.');
      else if (payload?.reused) messageApi.info('Já existe uma reconciliação fiscal em andamento.');
      else messageApi.success('Reconciliação fiscal iniciada em segundo plano.');
      await fetchNotas({ background: true });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Não foi possível iniciar a reconciliação.');
    } finally {
      setReconciling(false);
    }
  }, [fetchNotas, messageApi]);

  const runAction = useCallback((key: string, note: NotaFiscalRow) => {
    if (note.is_homologation_fixture && key !== 'details') {
      messageApi.info('Amostra protegida: ações fiscais estão disponíveis apenas para demonstração.');
      return;
    }
    if (key === 'details') void openDrawer(note);
    if (key === 'view') void handleViewDanfe(note);
    if (key === 'download') void handleDownloadDanfe(note);
    if (key === 'xml') handleDownloadXml(note);
    if (key === 'email') openEmailModal(note);
    if (key === 'cancel') openCancelModal(note);
    if (key === 'cce') openCceModal(note);
    if (key === 'return') setReturnModalOpen(true);
    if (key === 'reconcile') void reconcileNow();
  }, [handleDownloadDanfe, handleDownloadXml, handleViewDanfe, messageApi, openCancelModal, openCceModal, openDrawer, openEmailModal, reconcileNow]);

  const columns: TableProps<NotaFiscalRow>['columns'] = [
    {
      title: 'NF-e', dataIndex: 'numero', key: 'numero', width: 205, sorter: true,
      sortOrder: sortBy === 'numero' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: string, note) => {
        const emitted = formatDateParts(note.emissao);
        return value && value !== '—' ? <div className={styles.invoiceCell}>
          <button type="button" className={styles.invoiceLink} onClick={() => primaryAction(note) === 'danfe' ? void handleViewDanfe(note) : void openDrawer(note)}>NF-e {value}</button>
          <span className={styles.secondaryText}>{note.serie ? `Série ${note.serie}` : 'Série não informada'}{note.emissao ? ` · ${emitted.date} ${emitted.time}` : ''}</span>
        </div> : <div className={styles.invoiceCell}><span className={styles.missingText}>Ainda não emitida</span><span className={styles.secondaryText}>Sem data de emissão</span></div>;
      },
    },
    {
      title: 'Venda ML', dataIndex: 'pedido', key: 'pedido', width: 215, sorter: true,
      sortOrder: sortBy === 'pedido' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (_value, note) => {
        const primaryId = note.ml_pack_id || note.ml_order_id || String(note.pedido);
        const primaryLabel = note.ml_pack_id ? 'Pack' : 'Venda';
        const distinctOrder = note.ml_pack_id && note.ml_order_id && note.ml_pack_id !== note.ml_order_id;
        return <div className={styles.identifiersCell}>
          <button type="button" className={styles.orderLink} onClick={() => void openDrawer(note)}>{primaryLabel} #{primaryId}</button>
          {distinctOrder && <span>Venda #{note.ml_order_id}</span>}
        </div>;
      },
    },
    {
      title: 'Cliente', dataIndex: 'cliente', key: 'cliente', width: 240, sorter: true,
      sortOrder: sortBy === 'cliente' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: string, note) => <div className={styles.clientCell}>
        <span className={styles.clientName}>{value || 'Cliente não informado'}</span>
        <span className={styles.secondaryText}>{formatDocument(note.contato_documento)}</span>
      </div>,
    },
    {
      title: 'Valor', dataIndex: 'valor', key: 'valor', width: 120, sorter: true,
      sortOrder: sortBy === 'valor' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (value: number) => <span className={styles.valueText}>{formatCurrency(value)}</span>,
    },
    {
      title: 'Estado fiscal', dataIndex: 'status', key: 'status', width: 260, sorter: true,
      sortOrder: sortBy === 'status' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (_value, note) => {
        const presentation = getFiscalStatusPresentation(note);
        return <div className={styles.statusCell}>
          <Tag color={presentation.color}>{presentation.label}</Tag>
          {presentation.hint && <span className={styles.statusHint}>{presentation.hint}</span>}
          <span className={styles.nextAction}>{nextActionLabel(note)}</span>
        </div>;
      },
    },
    {
      title: 'Ações', key: 'actions', width: 180, fixed: 'right',
      render: (_value, note) => {
        const primary = primaryAction(note);
        const authorized = note.status === 'autorizada';
        const fixtureReason = note.is_homologation_fixture
          ? 'Amostra protegida — ação disponível apenas para demonstração.'
          : undefined;
        const secondary = [
          note.is_homologation_fixture && authorized
            ? { key: 'fixture-info', label: 'Amostra protegida — ações apenas para demonstração', disabled: true }
            : null,
          primary !== 'details' ? { key: 'details', label: 'Ver detalhes', icon: <EyeOutlined /> } : null,
          primary !== 'danfe' && authorized
            ? { key: 'view', label: 'Abrir DANFE', icon: <FilePdfOutlined />, disabled: Boolean(fixtureReason), title: fixtureReason }
            : null,
          authorized
            ? { key: 'download', label: 'Baixar DANFE', icon: <DownloadOutlined />, disabled: Boolean(fixtureReason), title: fixtureReason }
            : null,
          authorized
            ? {
                key: 'xml', label: 'Baixar XML', icon: <DownloadOutlined />,
                disabled: Boolean(fixtureReason || !note.xml_available),
                title: fixtureReason || (!note.xml_available ? 'XML ainda não disponível na Bentevi.' : undefined),
              }
            : null,
          canManageFiscal && authorized
            ? { key: 'email', label: 'Enviar por e-mail', icon: <MailOutlined />, disabled: Boolean(fixtureReason), title: fixtureReason }
            : null,
          canManageFiscal && authorized
            ? {
                key: 'cce', label: 'Emitir CC-e',
                disabled: Boolean(fixtureReason || !note.nfe_chave),
                title: fixtureReason || (!note.nfe_chave ? 'Chave de acesso não disponível.' : undefined),
              }
            : null,
          canManageFiscal && authorized
            ? {
                key: 'cancel', label: 'Cancelar NF-e', danger: true,
                disabled: Boolean(fixtureReason || !note.nfe_chave || isNfeCancelRejectedDeadlineStatus(note.nfe_status)),
                title: fixtureReason
                  || (!note.nfe_chave ? 'Chave de acesso não disponível.' : undefined)
                  || (isNfeCancelRejectedDeadlineStatus(note.nfe_status) ? 'Prazo de cancelamento excedido.' : undefined),
              }
            : null,
          canManageFiscal && authorized
            ? {
                key: 'return', label: 'Criar devolução/retorno',
                disabled: Boolean(fixtureReason || !note.nfe_chave || !note.xml_available),
                title: fixtureReason
                  || (!note.nfe_chave ? 'Chave de acesso não disponível.' : undefined)
                  || (!note.xml_available ? 'XML autorizado ainda não disponível.' : undefined),
              }
            : null,
          canManageFiscal && note.nfe_external_id && !['autorizada', 'cancelada'].includes(note.status) && !note.is_homologation_fixture
            ? { key: 'reconcile', label: 'Atualizar status', icon: <SyncOutlined /> } : null,
        ].filter(Boolean) as Array<{
          key: string;
          label: string;
          icon?: React.ReactNode;
          danger?: boolean;
          disabled?: boolean;
          title?: string;
        }>;
        const primaryLabel = primary === 'danfe' ? 'Abrir DANFE' : 'Ver detalhes';
        return <div className={styles.actionCell}>
          <Space.Compact>
            <Button
              className={styles.primaryAction}
              type={primary === 'danfe' ? 'primary' : 'default'}
              size="small"
              icon={primary === 'danfe' ? <FilePdfOutlined /> : <EyeOutlined />}
              loading={sendingRowId === note.id || actionRowId === note.id}
              onClick={() => runAction(primary === 'danfe' ? 'view' : 'details', note)}
            >{primaryLabel}</Button>
            {secondary.length > 0 && <Dropdown trigger={['click']} menu={{ items: secondary, onClick: ({ key }) => runAction(key, note) }}>
              <Button size="small" aria-label={`Mais ações da nota ${note.numero}`} icon={<EllipsisOutlined />} />
            </Dropdown>}
          </Space.Compact>
        </div>;
      },
    },
  ];

  const handleTableChange = (
    pagination: TablePaginationConfig,
    _filters: Record<string, (React.Key | boolean)[] | null>,
    sorter: SorterResult<NotaFiscalRow> | SorterResult<NotaFiscalRow>[],
  ) => {
    if (Array.isArray(sorter)) return;
    const nextSortBy = sorter.order && sorter.field ? String(sorter.field) : 'data';
    const nextSortOrder: SortOrder = sorter.order === 'ascend' ? 'asc' : 'desc';
    const sortChanged = nextSortBy !== sortBy || nextSortOrder !== sortOrder;
    setSortBy(nextSortBy);
    setSortOrder(nextSortOrder);
    setPage(sortChanged ? 1 : pagination.current || 1);
  };

  const activeFilters = useMemo(() => [
    lastSearch ? { key: 'search', label: `Busca: ${lastSearch}`, clear: () => { setSearch(''); setLastSearch(''); setPage(1); } } : null,
    statusFilter ? { key: 'status', label: `Status: ${statusOptions.find((item) => item.value === statusFilter)?.label || statusFilter}`, clear: () => { setStatusFilter(''); setPage(1); } } : null,
    dateRange[0] || dateRange[1] ? { key: 'date', label: `Venda: ${dateRange[0] || 'início'} — ${dateRange[1] || 'hoje'}`, clear: () => { setDateRange([null, null]); setPage(1); } } : null,
    valorMin !== null || valorMax !== null ? { key: 'value', label: `Valor: ${valorMin === null ? 'mínimo' : formatCurrency(valorMin)} — ${valorMax === null ? 'máximo' : formatCurrency(valorMax)}`, clear: () => { setValorMin(null); setValorMax(null); setPage(1); } } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>, [dateRange, lastSearch, statusFilter, valorMax, valorMin]);

  const datePickerValue: [Dayjs | null, Dayjs | null] = [
    dateRange[0] ? dayjs(dateRange[0]) : null,
    dateRange[1] ? dayjs(dateRange[1]) : null,
  ];
  const hasHomologationFixtures = rows.some((note) => note.is_homologation_fixture);

  return <div className={styles.page}>
    {contextHolder}
    <header className={styles.header}>
      <div>
        <Title level={2} className={styles.title}>Notas fiscais</Title>
        <Text type="secondary">Acompanhe a emissão, localize documentos e execute somente os eventos fiscais permitidos.</Text>
        <Text type="secondary" className={styles.updatedAt}>{lastUpdatedAt ? `Atualizado às ${lastUpdatedAt.toLocaleTimeString('pt-BR')}` : 'Aguardando primeira atualização'}</Text>
      </div>
      <Space wrap>
        {activeTab !== 'incoming' && canManageFiscal && <Button type="primary" icon={<PlusOutlined />} onClick={() => setReturnModalOpen(true)}>Criar devolução/retorno</Button>}
        {activeTab === 'sales' && canManageFiscal && <Button icon={<SyncOutlined />} loading={reconciling} onClick={() => void reconcileNow()}>Reconciliar agora</Button>}
        {activeTab === 'sales' && <Button type="primary" icon={<ReloadOutlined />} loading={listLoading || summaryLoading} onClick={() => void fetchNotas()}>Atualizar</Button>}
      </Space>
    </header>

    {activeTab === 'sales' && hasHomologationFixtures && <Alert type="info" showIcon message="Amostra real protegida para homologação" description="Os registros servem para avaliar o layout. Documentos, e-mails e eventos fiscais estão desabilitados nessa amostra." />}
    {activeTab === 'sales' && summaryError && <Alert type="warning" showIcon message="Resumo fiscal parcialmente indisponível" description={summaryError} action={<Button size="small" onClick={() => void fetchNotas()}>Tentar novamente</Button>} />}

    {activeTab === 'sales' && <section className={styles.summaryBand} aria-label="Resumo fiscal">
      {[
        ['Pendentes', summary.pendentes, 'Aguardando emissão ou processamento'],
        ['Emitidas', summary.emitidas, 'NF-e autorizadas nos filtros atuais'],
        ['Com erro', summary.com_erro, 'Interrompidas, rejeitadas ou não encontradas'],
        ['Valor autorizado', formatCurrency(summary.valor_autorizado), 'Somente vendas com NF-e autorizada'],
        [
          'Imposto estimado do mês',
          summary.imposto_estimado_mes?.estimatedAmount == null
            ? 'Indisponível'
            : formatCurrency(summary.imposto_estimado_mes.estimatedAmount),
          summary.imposto_estimado_mes
            ? `${summary.imposto_estimado_mes.competence} · base ${formatCurrency(summary.imposto_estimado_mes.grossRevenue)} · ${summary.imposto_estimado_mes.rate == null ? 'sem alíquota' : `${(summary.imposto_estimado_mes.rate * 100).toFixed(2)}%`} · confirmar no PGDAS-D`
            : 'Contexto tributário indisponível; nenhum percentual foi presumido',
        ],
      ].map(([label, value, hint]) => <div className={styles.summaryItem} key={String(label)} aria-busy={summaryLoading}>
        <span className={styles.summaryLabel}>{label}</span>
        <strong className={styles.summaryValue}>{summaryLoading && !lastUpdatedAt ? '—' : value}</strong>
        <span className={styles.summaryHint}>{hint}</span>
      </div>)}
    </section>}

    <Tabs
      activeKey={activeTab}
      onChange={(key) => setActiveTab(key as 'sales' | 'incoming' | 'returns')}
      items={[
        {
          key: 'sales',
          label: `NF-e de vendas (${summary.total})`,
          children: <>
    <Card size="small" className={styles.filterCard}>
      <Row gutter={[8, 8]} align="middle" className={styles.filterRow}>
        <Col flex="1 1 330px"><Input aria-label="Buscar notas fiscais" placeholder="Pedido, NF-e, cliente, Pack ou Venda ML" prefix={<SearchOutlined />} value={search} allowClear onChange={(event) => setSearch(event.target.value)} /></Col>
        <Col flex="0 1 210px"><Select aria-label="Filtrar status fiscal" placeholder="Status fiscal" value={statusFilter || undefined} options={statusOptions} allowClear style={{ width: '100%' }} onChange={(value) => { setStatusFilter(value || ''); setPage(1); }} /></Col>
        <Col flex="0 1 260px"><RangePicker aria-label="Filtrar período da venda" value={datePickerValue} format="DD/MM/YYYY" style={{ width: '100%' }} onChange={(dates) => { setDateRange([dates?.[0]?.format('YYYY-MM-DD') || null, dates?.[1]?.format('YYYY-MM-DD') || null]); setPage(1); }} /></Col>
        <Col flex="0 1 230px"><Space.Compact block>
          <InputNumber aria-label="Valor mínimo" placeholder="Valor mín." min={0} value={valorMin} style={{ width: '50%' }} onChange={(value) => { setValorMin(value ?? null); setPage(1); }} />
          <InputNumber aria-label="Valor máximo" placeholder="Valor máx." min={0} value={valorMax} style={{ width: '50%' }} onChange={(value) => { setValorMax(value ?? null); setPage(1); }} />
        </Space.Compact></Col>
      </Row>
      {activeFilters.length > 0 && <Space wrap className={styles.activeFilters}>
        <Text type="secondary">Filtros ativos:</Text>
        {activeFilters.map((filter) => <Tag key={filter.key} closable onClose={filter.clear}>{filter.label}</Tag>)}
        <Button type="link" size="small" onClick={() => { setSearch(''); setLastSearch(''); setStatusFilter(''); setDateRange([null, null]); setValorMin(null); setValorMax(null); setPage(1); }}>Limpar filtros</Button>
      </Space>}
    </Card>

    {listError && <Alert type="error" showIcon message="Falha ao atualizar as notas fiscais" description={`${listError}${rows.length > 0 ? ' Os dados anteriores foram preservados.' : ''}`} action={<Button size="small" onClick={() => void fetchNotas()}>Tentar novamente</Button>} />}
    <Card size="small" className={styles.tableCard}>
      {!listLoading && !listError && rows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhuma nota fiscal encontrada com os filtros atuais." /> : <ResizableTable<NotaFiscalRow>
        storageKey="notas-fiscais-bentevi-v2" dataSource={rows} columns={columns} rowKey="id" loading={listLoading}
        onChange={handleTableChange}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (count) => `${count} notas fiscais` }}
        scroll={{ x: 1365 }} size="small"
      />}
    </Card>

          </>,
        },
        {
          key: 'incoming',
          label: 'NF-e de entrada',
          children: <IncomingInvoicesPanel canManage={canManageFiscal} />,
        },
        {
          key: 'returns',
          label: 'Devoluções e retornos',
          children: <FiscalReturnsPanel canManage={canManageFiscal} refreshToken={returnsRefreshToken} />,
        },
      ]}
    />

    <NotaFiscalDetailsDrawer
      note={drawerNote} open={Boolean(drawerNote)} history={drawerHistory}
      historyLoading={drawerHistoryLoading} historyError={drawerHistoryError} onClose={closeDrawer}
      onViewDanfe={(note) => void handleViewDanfe(note)} onDownloadDanfe={(note) => void handleDownloadDanfe(note)}
      onDownloadXml={handleDownloadXml} onEmail={openEmailModal} onCancel={openCancelModal} onCce={openCceModal}
      onReturn={() => setReturnModalOpen(true)}
      canManage={canManageFiscal}
    />

    <Modal
      title={emailTarget ? `Enviar NF-e ${emailTarget.numero} por e-mail` : 'Enviar nota fiscal por e-mail'}
      open={emailModalOpen} onCancel={() => { setEmailModalOpen(false); setEmailTarget(null); }}
      onOk={() => void handleSendEmail()} okText="Enviar e-mail" cancelText="Cancelar"
      confirmLoading={Boolean(sendingRowId)} destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert type="info" showIcon message="A DANFE será anexada ao e-mail enviado pela Bentevi." />
        <Input type="email" placeholder="E-mail do destinatário (opcional se já cadastrado)" value={emailTo} onChange={(event) => setEmailTo(event.target.value)} />
        <Input placeholder="Assunto" value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
        <Input.TextArea rows={6} placeholder="Mensagem" value={emailBody} onChange={(event) => setEmailBody(event.target.value)} />
      </Space>
    </Modal>

    <Modal
      title={cancelTarget ? `Cancelar NF-e ${cancelTarget.numero}` : 'Cancelar NF-e'}
      open={cancelModalOpen} onCancel={() => { setCancelModalOpen(false); setCancelTarget(null); }}
      onOk={() => void submitCancelNfe()} okText="Cancelar NF-e" cancelText="Voltar"
      okButtonProps={{ danger: true, disabled: cancelConfirmText.trim().toUpperCase() !== 'CANCELAR' }}
      confirmLoading={actionRowId === cancelTarget?.id} destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert type="error" showIcon message="Esta ação será enviada ao provedor fiscal e não pode ser desfeita pela Bentevi." description="Revise a nota e a justificativa. Digite CANCELAR somente quando tiver certeza." />
        <Input.TextArea rows={4} placeholder="Justificativa do cancelamento" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
        <Input placeholder='Digite "CANCELAR"' value={cancelConfirmText} onChange={(event) => setCancelConfirmText(event.target.value)} />
      </Space>
    </Modal>

    <Modal
      title={cceTarget ? `Emitir CC-e da NF-e ${cceTarget.numero}` : 'Emitir carta de correção'}
      open={cceModalOpen} onCancel={() => { setCceModalOpen(false); setCceTarget(null); }}
      onOk={() => void submitCartaCorrecao()} okText="Enviar CC-e" cancelText="Cancelar"
      okButtonProps={{ disabled: cceText.trim().length < 15 }} confirmLoading={actionRowId === cceTarget?.id} destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert type="warning" showIcon message="O texto será enviado como evento fiscal ao provedor." description="Revise o conteúdo antes do envio. Esta ação não edita diretamente a NF-e original." />
        <InputNumber min={1} value={cceSeq} onChange={(value) => setCceSeq(Math.max(1, Number(value || 1)))} style={{ width: 180 }} addonBefore="Sequência" />
        <Input.TextArea rows={6} placeholder="Descreva a correção (mínimo 15 caracteres)" value={cceText} onChange={(event) => setCceText(event.target.value)} />
      </Space>
    </Modal>

    <FiscalReturnModal
      open={returnModalOpen}
      onClose={() => setReturnModalOpen(false)}
      onCreated={async () => {
        setActiveTab('returns');
        setReturnsRefreshToken((current) => current + 1);
        await fetchNotas({ background: true });
      }}
    />
  </div>;
}
