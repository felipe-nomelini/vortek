'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
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
  cliente_id: string | null;
  cliente_nome: string | null;
  produto_descricao: string | null;
  produto_fornecedor_oferta_id: string | null;
  produto_sku: string | null;
  produto_bentevi_id: string | null;
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

export function getPurchaseDsliteProductUrl(purchase: CompraOperacional): string | null {
  const supplierId = String(purchase.fornecedor_id || '').trim();
  const productId = String(purchase.produto_dslite_id || '').trim();
  if (!/^\d+$/.test(supplierId) || !/^\d+$/.test(productId)) return null;
  return `https://app.dslite.com.br/modules/admin/Produto/visualizar/${supplierId}/7945/${productId}`;
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
  const mlSaleUrl = purchase && saleReference && !purchase.is_homologation_fixture
    ? `https://www.mercadolivre.com.br/vendas/${encodeURIComponent(saleReference)}/detalhe`
    : null;
  const dsliteProductUrl = purchase && !purchase.is_homologation_fixture
    ? getPurchaseDsliteProductUrl(purchase)
    : null;
  const benteviProductUrl = purchase?.produto_bentevi_id && !purchase.is_homologation_fixture
    ? `/produtos/${encodeURIComponent(purchase.produto_bentevi_id)}`
    : null;
  const customerUrl = purchase?.cliente_id && !purchase.is_homologation_fixture
    ? `/clientes/${encodeURIComponent(purchase.cliente_id)}`
    : null;
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
        <p className={styles.productName}>{benteviProductUrl
          ? <Link href={benteviProductUrl}>{purchase.produto_descricao || 'Produto não informado'}</Link>
          : purchase.produto_descricao || 'Produto não informado'}</p>
        <div className={styles.metadataGrid}>
          <div><span>SKU Bentevi</span><strong>{benteviProductUrl && purchase.produto_sku_bentevi
            ? <Link href={benteviProductUrl}>{purchase.produto_sku_bentevi}</Link>
            : purchase.produto_sku_bentevi || 'Não vinculado'}</strong></div>
          <div><span>SKU do fornecedor</span><strong>{dsliteProductUrl && purchase.produto_sku_fornecedor
            ? <a href={dsliteProductUrl} target="_blank" rel="noopener noreferrer">{purchase.produto_sku_fornecedor}</a>
            : purchase.produto_sku_fornecedor || 'Não vinculado'}</strong></div>
          <div><span>ID do produto DSLite</span><strong>{dsliteProductUrl
            ? <a href={dsliteProductUrl} target="_blank" rel="noopener noreferrer">{purchase.produto_dslite_id}</a>
            : purchase.produto_dslite_id || purchase.produto_sku || '—'}</strong></div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="purchase-sale-title">
        <h3 id="purchase-sale-title">Relação com a venda</h3>
        <div className={styles.referenceGrid}>
          <div><span>Pack ML</span><strong>{purchase.pedido_ml_pack_id ? <span className={styles.linkWithCopy}>{mlSaleUrl
            ? <a href={mlSaleUrl} target="_blank" rel="noopener noreferrer">#{purchase.pedido_ml_pack_id}</a>
            : `#${purchase.pedido_ml_pack_id}`}<Text copyable={{ text: purchase.pedido_ml_pack_id }} /></span> : '—'}</strong></div>
          <div><span>Venda no Mercado Livre</span><strong>{purchase.pedido_ml_order_id ? <span className={styles.linkWithCopy}>{mlSaleUrl
            ? <a href={mlSaleUrl} target="_blank" rel="noopener noreferrer">#{purchase.pedido_ml_order_id}</a>
            : `#${purchase.pedido_ml_order_id}`}<Text copyable={{ text: purchase.pedido_ml_order_id }} /></span> : '—'}</strong></div>
          <div><span>Número interno Bentevi</span><strong>{purchase.pedido_vendas_numero ? <Text copyable={{ text: String(purchase.pedido_vendas_numero) }}>#{purchase.pedido_vendas_numero}</Text> : '—'}</strong></div>
          {purchase.cliente_nome && <div><span>Cliente</span><strong>{customerUrl
            ? <Link href={customerUrl}>{purchase.cliente_nome}</Link>
            : purchase.cliente_nome}</strong></div>}
          {(!purchase.cliente_nome || purchase.cliente_nome.trim().toLocaleLowerCase('pt-BR') !== String(purchase.destinatario_nome || '').trim().toLocaleLowerCase('pt-BR')) && (
            <div><span>Destinatário</span><strong>{purchase.destinatario_nome || '—'}</strong></div>
          )}
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
    <div className={styles.tabContent}>
      <section className={styles.paymentSummary} aria-label="Pagamento ao fornecedor">
        <div>
          <span className={styles.eyebrow}>Pagamento ao fornecedor</span>
          <strong className={styles.paymentAmount}>
            {purchase.supplier_payment_amount == null ? 'A definir' : formatCurrency(purchase.supplier_payment_amount)}
          </strong>
          <span className={styles.paymentMeta}>
            {paymentModeLabel(purchase.supplier_payment_mode)}
            {purchase.supplier_payment_confirmed_at && ` · Registrado em ${formatDateTime(purchase.supplier_payment_confirmed_at)}`}
          </span>
        </div>
        <div className={styles.paymentState}>
          <span className={styles.eyebrow}>Situação na Bentevi</span>
          {paymentStatusTag(purchase.supplier_payment_status)}
        </div>
      </section>
      {purchase.supplier_payment_mode === 'prepaid_pix' && (
        <Alert
          className={styles.guidance}
          type="info"
          showIcon
          message="A Bentevi não realiza a transferência"
          description="Faça o PIX no banco e use esta tela apenas para registrar o pagamento e anexar o comprovante."
        />
      )}
      {purchase.supplier_payment_mode === 'balance_account' && (
        <Alert
          className={styles.guidance}
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
      <section className={styles.section} aria-labelledby="purchase-payment-detail-title">
        <h3 id="purchase-payment-detail-title">Registro do pagamento</h3>
        <div className={styles.detailGrid}>
          <div><span>Comprovante</span><strong>{purchase.supplier_settlement_id
            ? 'Consulte na liquidação'
            : purchase.supplier_payment_receipt_path || purchase.supplier_payment_receipt_url ? 'Anexado' : 'Não anexado'}</strong></div>
          <div><span>Referência</span><strong>{purchase.supplier_payment_reference || '—'}</strong></div>
          {purchase.supplier_settlement_id && <div><span>Liquidação consolidada</span><strong>#{purchase.supplier_settlement_id.slice(0, 8)}</strong></div>}
          <div className={styles.fullWidth}><span>Observações</span><strong>{purchase.supplier_payment_notes || '—'}</strong></div>
        </div>
      </section>
    </div>
  ) : null;

  const fiscalAndShipping = purchase ? (
    <div className={styles.tabContent}>
      <section className={styles.fiscalSection} aria-labelledby="purchase-supplier-fiscal-title">
        <h3 id="purchase-supplier-fiscal-title">Fornecedor / DSLite</h3>
        <div className={styles.detailGrid}>
          <div><span>Status da compra DSLite</span><strong className={styles.fiscalState}>{formatStatus(purchase.status_dslite)}</strong></div>
          <div><span>Nota do fornecedor</span><strong>{purchase.nf_numero || 'Não informada'}</strong></div>
          <div className={styles.fullWidth}><span>Chave da nota</span><strong className={styles.longValue}>{purchase.nf_chave
            ? <Text copyable={{ text: purchase.nf_chave }}>{purchase.nf_chave}</Text> : '—'}</strong></div>
          <div className={styles.fullWidth}><span>Código de rastreio</span><strong>{purchase.rastreio || '—'}</strong></div>
        </div>
        {purchase.rastreio && <Button icon={<TruckOutlined />} onClick={() => onTrack(purchase)}>Rastrear compra</Button>}
      </section>

      <section className={styles.fiscalSection} aria-labelledby="purchase-sale-fiscal-title">
        <h3 id="purchase-sale-fiscal-title">Venda / Bentevi-Brasil NFe</h3>
        <div className={styles.detailGrid}>
          <div><span>Estado fiscal</span><strong className={styles.fiscalState}>{formatStatus(purchase.pedido_nfe_status)}</strong></div>
          <div><span>DANFE</span><strong>{purchase.pedido_nota_fiscal_emitida ? 'Disponível' : 'Não disponível'}</strong></div>
        </div>
        <Space wrap>
          {purchase.pedido_nota_fiscal_emitida && purchase.pedido_vendas_id && (
            <Button icon={<FilePdfOutlined />} disabled={purchase.is_homologation_fixture} onClick={() => onOpenDanfe(purchase)}>
              Abrir DANFE da venda
            </Button>
          )}
          {saleReference && (
            <Button icon={<LinkOutlined />} disabled={purchase.is_homologation_fixture} onClick={() => onOpenSale(purchase)}>
              Abrir venda no ML
            </Button>
          )}
        </Space>
      </section>
    </div>
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
