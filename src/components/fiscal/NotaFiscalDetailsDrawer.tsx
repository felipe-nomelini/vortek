'use client';

import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography,
  theme,
} from 'antd';
import {
  DownloadOutlined,
  FilePdfOutlined,
  MailOutlined,
} from '@ant-design/icons';
import {
  BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS,
  isNfeCancelRejectedDeadlineStatus,
  nfeTechnicalStatusLabel,
  type NfeTechnicalStatus,
} from '@/lib/fiscal/nfe-status';
import { formatCurrency } from '@/lib/format';
import type { PedidoVendaHistoricoApiDto } from '@/types/order';

const { Text } = Typography;

export interface NotaFiscalRow {
  id: string;
  pedido: number;
  cliente: string;
  data: string | null;
  emissao: string | null;
  numero: string;
  serie: string | null;
  valor: number;
  status: NfeTechnicalStatus;
  ml_order_id: string | null;
  ml_pack_id: string | null;
  nfe_status: string | null;
  contato_documento: string | null;
  nfe_chave: string | null;
  nfe_danfe_url: string | null;
  nfe_protocolo: string | null;
  nfe_cfop: string | null;
  nfe_provider: string | null;
  nfe_external_id: string | null;
  nfe_last_sync_at: string | null;
  danfe_available: boolean;
  xml_available: boolean;
  is_homologation_fixture: boolean;
}

export type FiscalStatusPresentation = {
  label: string;
  color: string;
  hint: string | null;
};

export function getFiscalStatusPresentation(note: NotaFiscalRow): FiscalStatusPresentation {
  if (note.nfe_status === BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS) {
    return {
      label: 'Não encontrada',
      color: 'red',
      hint: 'A busca no provedor terminou sem correspondência.',
    };
  }
  if (isNfeCancelRejectedDeadlineStatus(note.nfe_status)) {
    return {
      label: 'Autorizada',
      color: 'gold',
      hint: 'Cancelamento fora do prazo.',
    };
  }

  const colors: Record<NfeTechnicalStatus, string> = {
    autorizada: 'green',
    cancelada: 'default',
    pendente: 'gold',
    interrompida: 'orange',
    rejeitada: 'red',
    processando: 'blue',
    outro: 'default',
  };
  return {
    label: nfeTechnicalStatusLabel(note.status),
    color: colors[note.status],
    hint: null,
  };
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDocument(value: string | null | undefined): string {
  const document = String(value || '').replace(/\D/g, '');
  if (document.length === 11) {
    return `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`;
  }
  if (document.length === 14) {
    return `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
  }
  return value || '—';
}

function formatProvider(value: string | null | undefined): string {
  const provider = String(value || '').trim();
  if (!provider) return 'Não informado';
  if (/brasilnfe/i.test(provider)) return 'Brasil NFe';
  return provider;
}

type NotaFiscalDetailsDrawerProps = {
  note: NotaFiscalRow | null;
  open: boolean;
  history: PedidoVendaHistoricoApiDto[];
  historyLoading: boolean;
  historyError: string | null;
  onClose: () => void;
  onViewDanfe: (note: NotaFiscalRow) => void;
  onDownloadDanfe: (note: NotaFiscalRow) => void;
  onDownloadXml: (note: NotaFiscalRow) => void;
  onEmail: (note: NotaFiscalRow) => void;
  onCancel: (note: NotaFiscalRow) => void;
  onCce: (note: NotaFiscalRow) => void;
  canManage: boolean;
};

export default function NotaFiscalDetailsDrawer({
  note,
  open,
  history,
  historyLoading,
  historyError,
  onClose,
  onViewDanfe,
  onDownloadDanfe,
  onDownloadXml,
  onEmail,
  onCancel,
  onCce,
  canManage,
}: NotaFiscalDetailsDrawerProps) {
  const { token } = theme.useToken();
  const presentation = note ? getFiscalStatusPresentation(note) : null;
  const canUseDocuments = Boolean(note && !note.is_homologation_fixture && note.numero !== '—');
  const canCancel = Boolean(
    note
      && canManage
      && !note.is_homologation_fixture
      && note.status === 'autorizada'
      && note.nfe_chave
      && !isNfeCancelRejectedDeadlineStatus(note.nfe_status),
  );
  const canCce = Boolean(
    note
      && canManage
      && !note.is_homologation_fixture
      && note.status === 'autorizada'
      && note.nfe_chave,
  );

  const overview = note ? (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      {note.nfe_status === BRASIL_NFE_TERMINAL_NOT_FOUND_STATUS && (
        <Alert
          type="error"
          showIcon
          message="NF-e não encontrada no provedor"
          description="A reconciliação automática não repetirá esta busca enquanto o estado fiscal não mudar. Revise a emissão antes de reconciliar novamente."
        />
      )}
      {isNfeCancelRejectedDeadlineStatus(note.nfe_status) && (
        <Alert
          type="warning"
          showIcon
          message="Prazo de cancelamento excedido"
          description="A NF-e continua autorizada, mas o cancelamento pelo fluxo padrão está indisponível."
        />
      )}
      <Descriptions title="Documento fiscal" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Número">{note.numero === '—' ? 'Ainda não emitida' : note.numero}</Descriptions.Item>
        <Descriptions.Item label="Série">{note.serie || '—'}</Descriptions.Item>
        <Descriptions.Item label="Chave de acesso" span={2}>{note.nfe_chave || '—'}</Descriptions.Item>
        <Descriptions.Item label="Protocolo">{note.nfe_protocolo || '—'}</Descriptions.Item>
        <Descriptions.Item label="CFOP">{note.nfe_cfop || '—'}</Descriptions.Item>
        <Descriptions.Item label="Provedor">{formatProvider(note.nfe_provider)}</Descriptions.Item>
        <Descriptions.Item label="ID no provedor">{note.nfe_external_id || '—'}</Descriptions.Item>
        <Descriptions.Item label="Emissão">{formatDateTime(note.emissao)}</Descriptions.Item>
        <Descriptions.Item label="Última sincronização">{formatDateTime(note.nfe_last_sync_at)}</Descriptions.Item>
        <Descriptions.Item label="Valor">{formatCurrency(note.valor)}</Descriptions.Item>
        <Descriptions.Item label="Estado">{presentation ? <Tag color={presentation.color}>{presentation.label}</Tag> : '—'}</Descriptions.Item>
      </Descriptions>

      <Descriptions title="Venda e cliente" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Pedido interno">#{String(note.pedido).padStart(6, '0')}</Descriptions.Item>
        <Descriptions.Item label="Data da venda">{formatDateTime(note.data)}</Descriptions.Item>
        <Descriptions.Item label="Pack ML">{note.ml_pack_id ? `#${note.ml_pack_id}` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Venda / Order ML">{note.ml_order_id ? `#${note.ml_order_id}` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Cliente">{note.cliente}</Descriptions.Item>
        <Descriptions.Item label="Documento">{formatDocument(note.contato_documento)}</Descriptions.Item>
      </Descriptions>
    </Space>
  ) : null;

  const documents = note ? (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {note.is_homologation_fixture && (
        <Alert
          type="info"
          showIcon
          message="Amostra real protegida para homologação"
          description="Documentos e ações externas estão desabilitados neste registro."
        />
      )}
      <div style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: 16,
      }}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>DANFE</Text>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Consulte ou baixe a representação da NF-e quando o documento estiver disponível.
        </Text>
        <Space wrap>
          <Button icon={<FilePdfOutlined />} disabled={!canUseDocuments} onClick={() => onViewDanfe(note)}>Abrir DANFE</Button>
          <Button icon={<DownloadOutlined />} disabled={!canUseDocuments} onClick={() => onDownloadDanfe(note)}>Baixar DANFE</Button>
        </Space>
      </div>
      <div style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: 16,
      }}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>XML autorizado</Text>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {note.xml_available ? 'Arquivo XML disponível na Bentevi.' : 'XML ainda não disponível na Bentevi.'}
        </Text>
        <Button icon={<DownloadOutlined />} disabled={!canUseDocuments || !note.xml_available} onClick={() => onDownloadXml(note)}>Baixar XML</Button>
      </div>
      <div style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: 16,
      }}>
        <Text strong style={{ display: 'block', marginBottom: 4 }}>Envio por e-mail</Text>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Envie a DANFE anexada ao destinatário informado.
        </Text>
        <Button icon={<MailOutlined />} disabled={!canManage || !canUseDocuments} onClick={() => onEmail(note)}>Enviar por e-mail</Button>
      </div>
      {(canCancel || canCce) && (
        <div style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          padding: 16,
        }}>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Eventos fiscais</Text>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Estas ações alteram o documento no provedor fiscal e exigem revisão antes do envio.
          </Text>
          <Space wrap>
            {canCce && <Button onClick={() => onCce(note)}>Emitir CC-e</Button>}
            {canCancel && <Button danger onClick={() => onCancel(note)}>Cancelar NF-e</Button>}
          </Space>
        </div>
      )}
    </Space>
  ) : null;

  const fiscalHistory = history.filter((event) => /(?:nfe|nf-e|nota_fiscal|fiscal|invoice|brasilnfe|danfe|xml)/i.test(event.event));
  const historyContent = historyError ? (
    <Alert type="warning" showIcon message="Histórico fiscal indisponível" description={historyError} />
  ) : fiscalHistory.length > 0 ? (
    <Timeline
      pending={historyLoading ? 'Atualizando histórico...' : undefined}
      items={fiscalHistory.map((event) => ({
        color: event.level === 'error' ? 'red' : event.level === 'warning' ? 'orange' : event.level === 'success' ? 'green' : 'blue',
        children: (
          <div>
            <Text strong>{event.label}</Text>
            {event.result && <Text type="secondary" style={{ display: 'block' }}>{event.result}</Text>}
            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{formatDateTime(event.date)}</Text>
          </div>
        ),
      }))}
    />
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={historyLoading ? 'Carregando histórico fiscal...' : 'Nenhum evento fiscal registrado.'} />
  );

  return (
    <Drawer
      title={note ? (
        <div>
          <Space size={8} wrap>
            <Text strong>{note.numero === '—' ? `Pedido #${String(note.pedido).padStart(6, '0')}` : `NF-e ${note.numero}${note.serie ? ` · Série ${note.serie}` : ''}`}</Text>
            {presentation && <Tag color={presentation.color}>{presentation.label}</Tag>}
          </Space>
          <Text type="secondary" style={{ display: 'block', marginTop: 3, fontSize: 12 }}>
            {note.cliente}
          </Text>
        </div>
      ) : 'Detalhes da nota fiscal'}
      open={open}
      size="large"
      destroyOnHidden
      onClose={onClose}
    >
      <Tabs items={[
        { key: 'overview', label: 'Visão geral', children: overview },
        { key: 'documents', label: 'Documentos e eventos', children: documents },
        { key: 'history', label: 'Histórico fiscal', children: historyContent },
      ]} />
    </Drawer>
  );
}
