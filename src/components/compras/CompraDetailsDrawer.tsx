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
} from 'antd';
import {
  FilePdfOutlined,
  LinkOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import styles from './CompraDetailsDrawer.module.css';

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
  pedido_label_type: 'provisional' | 'real' | null;
  pedido_label_delivery_channel: 'dslite' | 'whatsapp' | null;
  pedido_label_delivered_at: string | null;
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
  supplier_settlement_id: string | null;
  supplier_payment_reference: string | null;
  supplier_payment_receipt_url: string | null;
  supplier_payment_receipt_path: string | null;
  supplier_payment_notes: string | null;
  supplier_payment_confirmed_at: string | null;
  supplier_pix_key: string | null;
  supply_status: 'unknown' | 'ready' | 'blocked' | 'cancelled';
  supply_status_note: string | null;
  supply_status_changed_at: string | null;
  supply_status_changed_by: string | null;
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
  const saleReference = purchase ? getPurchaseSaleReference(purchase) : null;
  const saleItems = purchase?.itens_venda || [];

  const overview = purchase ? (
    <div className={styles.overview}>
      <section className={styles.amounts} aria-label="Valores da compra">
        <div className={styles.mainAmount}>
          <span>Custo do fornecedor</span>
          <strong>{purchase.supplier_payment_amount == null ? 'A definir' : formatCurrency(purchase.supplier_payment_amount)}</strong>
        </div>
        <div className={styles.otherAmount}>
          <span>Venda (Bentevi)</span>
          <strong>{formatCurrency(purchase.valor_total || 0)}</strong>
        </div>
        <div className={styles.otherAmount}>
          <span>Frete da compra</span>
          <strong>{formatCurrency(purchase.valor_frete || 0)}</strong>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="purchase-product-title">
        <div className={styles.sectionHeader}>
          <h3 id="purchase-product-title">Produto vinculado à compra</h3>
          <span className={styles.quantity}>Quantidade comprada: {purchase.quantidade || 1}</span>
        </div>
        <p className={styles.productName}>{purchase.produto_descricao || 'Produto não informado'}</p>
        <div className={styles.metadataGrid}>
          <div><span>SKU Bentevi</span><strong>{purchase.produto_sku_bentevi || 'Não vinculado'}</strong></div>
          <div><span>SKU do fornecedor</span><strong>{purchase.produto_sku_fornecedor || 'Não vinculado'}</strong></div>
          <div><span>ID do produto DSLite</span><strong>{purchase.produto_dslite_id || purchase.produto_sku || '—'}</strong></div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="purchase-sale-title">
        <h3 id="purchase-sale-title">Relação com a venda</h3>
        <div className={styles.referenceGrid}>
          <div><span>Pack ML</span><strong>{purchase.pedido_ml_pack_id ? <Text copyable={{ text: purchase.pedido_ml_pack_id }}>#{purchase.pedido_ml_pack_id}</Text> : '—'}</strong></div>
          <div><span>Venda no Mercado Livre</span><strong>{purchase.pedido_ml_order_id ? <Text copyable={{ text: purchase.pedido_ml_order_id }}>#{purchase.pedido_ml_order_id}</Text> : '—'}</strong></div>
          <div><span>Número interno Bentevi</span><strong>{purchase.pedido_vendas_numero ? <Text copyable={{ text: String(purchase.pedido_vendas_numero) }}>#{purchase.pedido_vendas_numero}</Text> : '—'}</strong></div>
          <div><span>Destinatário</span><strong>{purchase.destinatario_nome || '—'}</strong></div>
          <div><span>Documento</span><strong>{purchase.destinatario_documento || '—'}</strong></div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="purchase-items-title">
        <h3 id="purchase-items-title">Itens da venda</h3>
        {saleItems.length > 0 ? (
          <List
            size="small"
            dataSource={saleItems}
            className={styles.itemList}
            renderItem={(item) => (
              <List.Item>
                <div className={styles.item}>
                  <strong>{item.titulo || 'Produto sem descrição'}</strong>
                  <Text type="secondary">
                    Qtd. {Number(item.quantidade || 1)} · SKU da venda {item.seller_sku || '—'} · Item ML {item.ml_item_id || '—'}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        ) : <Text type="secondary">Itens da venda não disponíveis.</Text>}
      </section>
    </div>
  ) : null;

  const payment = purchase ? (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {purchase.supplier_payment_mode === 'prepaid_pix' && (
        <Alert
          type="info"
          showIcon
          message="A Bentevi não realiza a transferência"
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
        <Descriptions.Item label="Situação na Bentevi">{paymentStatusTag(purchase.supplier_payment_status)}</Descriptions.Item>
        {purchase.supplier_settlement_id && <Descriptions.Item label="Liquidação consolidada">#{purchase.supplier_settlement_id.slice(0, 8)}</Descriptions.Item>}
        <Descriptions.Item label="Valor do fornecedor">
          {purchase.supplier_payment_amount == null ? 'A definir' : formatCurrency(purchase.supplier_payment_amount)}
        </Descriptions.Item>
        <Descriptions.Item label="Registrado em">{formatDateTime(purchase.supplier_payment_confirmed_at)}</Descriptions.Item>
        <Descriptions.Item label="Comprovante">
          {purchase.supplier_settlement_id ? 'Consulte na liquidação' : purchase.supplier_payment_receipt_path || purchase.supplier_payment_receipt_url ? 'Anexado' : 'Não anexado'}
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

      <Descriptions title="Venda / Bentevi-Brasil NFe" size="small" bordered column={{ xs: 1, sm: 2 }}>
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
      className={styles.drawer}
      title={purchase ? (
        <div className={styles.drawerTitle}>
          <Space size={8} wrap>
            <Text strong>Compra DSLite #{purchase.dsid}</Text>
            <Tag color="gold">{formatStatus(purchase.status)}</Tag>
          </Space>
          <Text type="secondary" style={{ display: 'block', marginTop: 3, fontSize: 12 }}>
            {purchase.fornecedor_apelido || purchase.fornecedor_nome || 'Fornecedor não informado'} · Compra criada em {formatDateTime(purchase.data_criacao)}
          </Text>
        </div>
      ) : 'Detalhes da compra'}
      extra={actions}
      open={open}
      width="min(736px, 100vw)"
      destroyOnHidden
      onClose={onClose}
    >
      {purchase?.is_homologation_fixture && (
        <Alert
          type="info"
          showIcon
          message="Registro de demonstração protegido"
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
