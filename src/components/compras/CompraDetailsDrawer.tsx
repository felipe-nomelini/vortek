'use client';

import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  List,
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

export type CompraDrawerTab = 'overview' | 'payment' | 'fiscal';

export interface CompraVendaItem {
  pedido_id: string;
  titulo: string;
  quantidade: number;
  seller_sku: string | null;
  ml_item_id: string | null;
}

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
  fornecedor_apelido: string | null;
  fornecedor_id: string | null;
  destinatario_nome: string | null;
  destinatario_documento: string | null;
  produto_descricao: string | null;
  produto_fornecedor_oferta_id: string | null;
  produto_sku: string | null;
  produto_sku_bentevi: string | null;
  produto_sku_fornecedor: string | null;
  produto_dslite_id: string | null;
  quantidade: number;
  itens_venda: CompraVendaItem[];
  supplier_payment_mode: 'postpaid' | 'prepaid_pix' | 'balance_account' | null;
  supplier_payment_status: 'pending' | 'paid' | 'failed' | 'cancelled' | null;
  supplier_payment_amount: number | null;
  supplier_payment_reference: string | null;
  supplier_payment_receipt_url: string | null;
  supplier_payment_receipt_path: string | null;
  supplier_payment_notes: string | null;
  supplier_payment_confirmed_at: string | null;
  supplier_pix_key: string | null;
  bkr1_pix_deferred: boolean;
  is_homologation_fixture: boolean;
}

type CompraDetailsDrawerProps = {
  purchase: CompraOperacional | null;
  open: boolean;
  activeTab: CompraDrawerTab;
  onTabChange: (tab: CompraDrawerTab) => void;
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
  if (value === 'paid') return <Tag color="green">PIX registrado</Tag>;
  if (value === 'failed') return <Tag color="red">Registro com falha</Tag>;
  if (value === 'cancelled') return <Tag>Pagamento cancelado</Tag>;
  if (value === 'pending') return <Tag color="gold">Aguardando confirmação</Tag>;
  return <Text type="secondary">Não aplicável</Text>;
}

export function getPurchaseSaleReference(purchase: CompraOperacional): string | null {
  return String(purchase.pedido_ml_pack_id || purchase.pedido_ml_order_id || '').trim() || null;
}

export default function CompraDetailsDrawer({
  purchase,
  open,
  activeTab,
  onTabChange,
  onClose,
  actions,
  onTrack,
  onOpenSale,
  onOpenDanfe,
}: CompraDetailsDrawerProps) {
  const { token } = theme.useToken();
  const saleReference = purchase ? getPurchaseSaleReference(purchase) : null;
  const saleItems = purchase?.itens_venda || [];

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
          ['Compra DSLite', `#${purchase.dsid}`],
          ['Fornecedor', purchase.fornecedor_apelido || purchase.fornecedor_nome || 'Não informado'],
          ['Situação', purchase.status || 'Sem status'],
        ].map(([label, value]) => (
          <div key={label} style={{ minWidth: 0, padding: 16, background: token.colorBgContainer }}>
            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{label}</Text>
            <Text strong ellipsis style={{ display: 'block', marginTop: 4 }}>{value}</Text>
          </div>
        ))}
      </div>

      <Descriptions title="Relação com a venda" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Pack ML">{purchase.pedido_ml_pack_id ? `#${purchase.pedido_ml_pack_id}` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Venda / Order ML">{purchase.pedido_ml_order_id ? `#${purchase.pedido_ml_order_id}` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Número interno Vortek">{purchase.pedido_vendas_numero ? `#${purchase.pedido_vendas_numero}` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Compra criada em">{formatDateTime(purchase.data_criacao)}</Descriptions.Item>
        <Descriptions.Item label="Destinatário">{purchase.destinatario_nome || '—'}</Descriptions.Item>
        <Descriptions.Item label="Documento">{purchase.destinatario_documento || '—'}</Descriptions.Item>
      </Descriptions>

      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>Itens da venda</Text>
        {saleItems.length > 0 ? (
          <List
            size="small"
            bordered
            dataSource={saleItems}
            renderItem={(item) => (
              <List.Item>
                <div style={{ minWidth: 0 }}>
                  <Text strong>{item.titulo || 'Produto sem descrição'}</Text>
                  <Text type="secondary" style={{ display: 'block', marginTop: 3, fontSize: 12 }}>
                    Qtd. {Number(item.quantidade || 1)} · SKU da venda {item.seller_sku || '—'} · Item ML {item.ml_item_id || '—'}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        ) : <Text type="secondary">Itens da venda não disponíveis.</Text>}
      </div>

      <Descriptions title="Produto vinculado à compra" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Descrição" span={2}>{purchase.produto_descricao || '—'}</Descriptions.Item>
        <Descriptions.Item label="Quantidade comprada">{purchase.quantidade || 1}</Descriptions.Item>
        <Descriptions.Item label="SKU Bentevi">{purchase.produto_sku_bentevi || 'Não vinculado'}</Descriptions.Item>
        <Descriptions.Item label="SKU do fornecedor">{purchase.produto_sku_fornecedor || 'Não vinculado'}</Descriptions.Item>
        <Descriptions.Item label="ID do produto DSLite">{purchase.produto_dslite_id || purchase.produto_sku || '—'}</Descriptions.Item>
      </Descriptions>

      <Descriptions title="Valores" size="small" bordered column={{ xs: 1, sm: 3 }}>
        <Descriptions.Item label="Fornecedor">
          {purchase.supplier_payment_amount == null ? 'A definir' : formatCurrency(purchase.supplier_payment_amount)}
        </Descriptions.Item>
        <Descriptions.Item label="Venda (Vortek)">{formatCurrency(purchase.valor_total || 0)}</Descriptions.Item>
        <Descriptions.Item label="Frete da compra">{formatCurrency(purchase.valor_frete || 0)}</Descriptions.Item>
      </Descriptions>
    </Space>
  ) : null;

  const payment = purchase ? (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {purchase.supplier_payment_mode === 'prepaid_pix' && (
        <Alert
          type="info"
          showIcon
          message="O Vortek não realiza a transferência"
          description="Faça o PIX no banco e use esta tela apenas para registrar o pagamento e anexar o comprovante."
        />
      )}
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
          message="O registro do PIX aguarda a etiqueta real do Mercado Livre"
        />
      )}
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Modalidade">{paymentModeLabel(purchase.supplier_payment_mode)}</Descriptions.Item>
        <Descriptions.Item label="Situação no Vortek">{paymentStatusTag(purchase.supplier_payment_status)}</Descriptions.Item>
        <Descriptions.Item label="Valor do fornecedor">
          {purchase.supplier_payment_amount == null ? 'A definir' : formatCurrency(purchase.supplier_payment_amount)}
        </Descriptions.Item>
        <Descriptions.Item label="Registrado em">{formatDateTime(purchase.supplier_payment_confirmed_at)}</Descriptions.Item>
        <Descriptions.Item label="Comprovante">
          {purchase.supplier_payment_receipt_path || purchase.supplier_payment_receipt_url ? 'Anexado' : 'Não anexado'}
        </Descriptions.Item>
        <Descriptions.Item label="Referência">{purchase.supplier_payment_reference || '—'}</Descriptions.Item>
        <Descriptions.Item label="Observações" span={2}>{purchase.supplier_payment_notes || '—'}</Descriptions.Item>
      </Descriptions>
    </Space>
  ) : null;

  const fiscalAndShipping = purchase ? (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Descriptions title="Fornecedor / DSLite" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Nota do fornecedor">{purchase.nf_numero || 'Não informada'}</Descriptions.Item>
        <Descriptions.Item label="Status da compra DSLite">{formatStatus(purchase.status_dslite)}</Descriptions.Item>
        <Descriptions.Item label="Chave da nota" span={2}>{purchase.nf_chave || '—'}</Descriptions.Item>
        <Descriptions.Item label="Código de rastreio" span={2}>{purchase.rastreio || '—'}</Descriptions.Item>
      </Descriptions>

      <Descriptions title="Venda / Vortek-Brasil NFe" size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Estado fiscal">{formatStatus(purchase.pedido_nfe_status)}</Descriptions.Item>
        <Descriptions.Item label="DANFE">{purchase.pedido_nota_fiscal_emitida ? 'Disponível' : 'Não disponível'}</Descriptions.Item>
      </Descriptions>

      <Space wrap>
        {purchase.pedido_nota_fiscal_emitida && purchase.pedido_vendas_id && (
          <Button
            icon={<FilePdfOutlined />}
            disabled={purchase.is_homologation_fixture}
            onClick={() => onOpenDanfe(purchase)}
          >
            Abrir DANFE da venda
          </Button>
        )}
        {purchase.rastreio && (
          <Button icon={<TruckOutlined />} onClick={() => onTrack(purchase)}>Rastrear compra</Button>
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
        activeKey={activeTab}
        onChange={(key) => onTabChange(key as CompraDrawerTab)}
        items={[
          { key: 'overview', label: 'Visão geral', children: overview },
          { key: 'payment', label: 'Pagamento', children: payment },
          { key: 'fiscal', label: 'Fiscal e entrega', children: fiscalAndShipping },
        ]}
      />
    </Drawer>
  );
}
