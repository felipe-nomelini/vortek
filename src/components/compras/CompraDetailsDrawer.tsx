'use client';

import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Space,
  Tabs,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  FilePdfOutlined,
  LinkOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';

const { Text } = Typography;

export interface CompraOperacional {
  id: string;
  dsid: string;
  pedido_vendas_id: string | null;
  pedido_vendas_numero: number | null;
  pedido_ml_order_id: string | null;
  pedido_ml_pack_id: string | null;
  pedido_nfe_status: string | null;
  pedido_nota_fiscal_emitida: boolean;
  status: string;
  status_dslite: string;
  nf_chave: string | null;
  nf_numero: string | null;
  valor_total: number;
  valor_frete: number;
  data_criacao: string;
  rastreio: string | null;
  fornecedor_nome: string | null;
  fornecedor_id: string | null;
  destinatario_nome: string | null;
  destinatario_documento: string | null;
  produto_descricao: string | null;
  produto_sku: string | null;
  quantidade: number;
  supplier_payment_mode: 'postpaid' | 'prepaid_pix' | 'balance_account' | null;
  supplier_payment_status: 'pending' | 'paid' | 'failed' | 'cancelled' | null;
  supplier_payment_amount: number | null;
  supplier_payment_reference: string | null;
  supplier_payment_receipt_url: string | null;
  supplier_payment_receipt_path: string | null;
  supplier_payment_notes: string | null;
  supplier_pix_key: string | null;
  bkr1_pix_deferred: boolean;
  is_homologation_fixture: boolean;
}

type CompraDetailsDrawerProps = {
  purchase: CompraOperacional | null;
  open: boolean;
  onClose: () => void;
  actions?: ReactNode;
  onTrack: (purchase: CompraOperacional) => void;
  onOpenSale: (purchase: CompraOperacional) => void;
  onOpenDanfe: (purchase: CompraOperacional) => void;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function formatStatus(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '—';
  return normalized.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paymentModeLabel(value: CompraOperacional['supplier_payment_mode']): string {
  if (value === 'prepaid_pix') return 'PIX pré-pago';
  if (value === 'postpaid') return 'Pós-pago (histórico)';
  if (value === 'balance_account') return 'Conta-saldo aposentada';
  return 'Não informado';
}

function paymentStatusTag(value: CompraOperacional['supplier_payment_status']) {
  if (value === 'paid') return <Tag color="green">PIX pago</Tag>;
  if (value === 'failed') return <Tag color="red">PIX falhou</Tag>;
  if (value === 'cancelled') return <Tag>PIX cancelado</Tag>;
  if (value === 'pending') return <Tag color="gold">PIX pendente</Tag>;
  return <Text type="secondary">Não aplicável</Text>;
}

export function getPurchaseSaleReference(purchase: CompraOperacional): string | null {
  return String(
    purchase.pedido_ml_pack_id
      || purchase.pedido_ml_order_id
      || purchase.pedido_vendas_numero
      || '',
  ).trim() || null;
}

export default function CompraDetailsDrawer({
  purchase,
  open,
  onClose,
  actions,
  onTrack,
  onOpenSale,
  onOpenDanfe,
}: CompraDetailsDrawerProps) {
  const { token } = theme.useToken();
  const saleReference = purchase ? getPurchaseSaleReference(purchase) : null;

  const overview = purchase ? (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 1,
        overflow: 'hidden',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        background: token.colorBorderSecondary,
      }}>
        {[
          ['Venda vinculada', saleReference ? `#${saleReference}` : 'Não identificada'],
          ['Compra DSLite', `#${purchase.dsid}`],
          ['Fornecedor', purchase.fornecedor_nome || 'Não informado'],
        ].map(([label, value]) => (
          <div key={label} style={{ minWidth: 0, padding: 16, background: token.colorBgContainer }}>
            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{label}</Text>
            <Text strong ellipsis style={{ display: 'block', marginTop: 4 }}>{value}</Text>
          </div>
        ))}
      </div>

      <Descriptions title="Compra e destinatário" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Criada em">{formatDateTime(purchase.data_criacao)}</Descriptions.Item>
        <Descriptions.Item label="Status DSLite">{formatStatus(purchase.status_dslite)}</Descriptions.Item>
        <Descriptions.Item label="Destinatário">{purchase.destinatario_nome || '—'}</Descriptions.Item>
        <Descriptions.Item label="Documento">{purchase.destinatario_documento || '—'}</Descriptions.Item>
      </Descriptions>

      <Descriptions title="Produto" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Descrição" span={2}>{purchase.produto_descricao || '—'}</Descriptions.Item>
        <Descriptions.Item label="SKU">{purchase.produto_sku || '—'}</Descriptions.Item>
        <Descriptions.Item label="Quantidade">{purchase.quantidade || 1}</Descriptions.Item>
      </Descriptions>

      <Descriptions title="Valores" size="small" bordered column={{ xs: 1, sm: 3 }}>
        <Descriptions.Item label="Devido ao fornecedor">
          {purchase.supplier_payment_amount == null ? 'A definir' : formatCurrency(purchase.supplier_payment_amount)}
        </Descriptions.Item>
        <Descriptions.Item label="Valor da venda">{formatCurrency(purchase.valor_total || 0)}</Descriptions.Item>
        <Descriptions.Item label="Frete da compra">{formatCurrency(purchase.valor_frete || 0)}</Descriptions.Item>
      </Descriptions>
    </Space>
  ) : null;

  const payment = purchase ? (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {purchase.supplier_payment_mode === 'balance_account' && (
        <Alert
          type="info"
          showIcon
          message="Conta-saldo aposentada"
          description="Este registro é somente histórico. Nenhuma operação Hayamax está disponível."
        />
      )}
      {purchase.bkr1_pix_deferred && (
        <Alert
          type="warning"
          showIcon
          message="Pagamento aguarda a etiqueta real do Mercado Livre"
        />
      )}
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Modalidade">{paymentModeLabel(purchase.supplier_payment_mode)}</Descriptions.Item>
        <Descriptions.Item label="Situação">{paymentStatusTag(purchase.supplier_payment_status)}</Descriptions.Item>
        <Descriptions.Item label="Valor devido">
          {purchase.supplier_payment_amount == null ? 'A definir' : formatCurrency(purchase.supplier_payment_amount)}
        </Descriptions.Item>
        <Descriptions.Item label="Comprovante">
          {purchase.supplier_payment_receipt_path || purchase.supplier_payment_receipt_url ? 'Anexado' : 'Não anexado'}
        </Descriptions.Item>
        <Descriptions.Item label="Referência" span={2}>{purchase.supplier_payment_reference || '—'}</Descriptions.Item>
        <Descriptions.Item label="Observações" span={2}>{purchase.supplier_payment_notes || '—'}</Descriptions.Item>
      </Descriptions>
    </Space>
  ) : null;

  const fiscalAndShipping = purchase ? (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Nota fiscal">{purchase.nf_numero || 'Não emitida'}</Descriptions.Item>
        <Descriptions.Item label="Estado fiscal">{formatStatus(purchase.pedido_nfe_status)}</Descriptions.Item>
        <Descriptions.Item label="Chave NF" span={2}>{purchase.nf_chave || '—'}</Descriptions.Item>
        <Descriptions.Item label="Status DSLite">{formatStatus(purchase.status_dslite)}</Descriptions.Item>
        <Descriptions.Item label="Código de rastreio">{purchase.rastreio || '—'}</Descriptions.Item>
      </Descriptions>
      <Space wrap>
        {purchase.pedido_nota_fiscal_emitida && purchase.pedido_vendas_id && (
          <Button
            icon={<FilePdfOutlined />}
            disabled={purchase.is_homologation_fixture}
            onClick={() => onOpenDanfe(purchase)}
          >
            Abrir DANFE
          </Button>
        )}
        {purchase.rastreio && (
          <Button icon={<TruckOutlined />} onClick={() => onTrack(purchase)}>Rastrear</Button>
        )}
        {saleReference && (
          <Button
            icon={<LinkOutlined />}
            disabled={purchase.is_homologation_fixture}
            onClick={() => onOpenSale(purchase)}
          >
            Abrir venda no ML
          </Button>
        )}
      </Space>
    </Space>
  ) : null;

  return (
    <Drawer
      title={purchase ? (
        <div>
          <Space size={8} wrap>
            <Text strong>Compra DSLite #{purchase.dsid}</Text>
            <Tag color="gold">{purchase.status || 'Sem status'}</Tag>
          </Space>
          <Text type="secondary" style={{ display: 'block', marginTop: 3, fontSize: 12 }}>
            {formatDateTime(purchase.data_criacao)}
          </Text>
        </div>
      ) : 'Detalhes da compra'}
      extra={actions}
      open={open}
      size="large"
      destroyOnHidden
      onClose={onClose}
    >
      {purchase?.is_homologation_fixture && (
        <Alert
          type="info"
          showIcon
          message="Amostra real protegida para homologação"
          description="Documentos e ações externas estão desabilitados para este registro."
          style={{ marginBottom: 16 }}
        />
      )}
      <Tabs
        items={[
          { key: 'overview', label: 'Visão geral', children: overview },
          { key: 'payment', label: 'Pagamento', children: payment },
          { key: 'fiscal', label: 'Fiscal e envio', children: fiscalAndShipping },
        ]}
      />
    </Drawer>
  );
}
