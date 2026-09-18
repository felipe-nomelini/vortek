'use client';

import { userSafeMessage } from '@/lib/user-feedback';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Alert, Button, Descriptions, Drawer, Empty, Progress, Skeleton, Space, Table,
  Tabs, Tag, Timeline, Typography, theme,
} from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import OrderTrackingDetails from '@/components/pedidos/OrderTrackingDetails';
import { formatCurrency } from '@/lib/format';
import {
  ORDER_STATUS_LABELS,
  SALES_PROGRESS_STAGES,
  getOrderSalesProgress,
} from '@/lib/orders/operational-view';
import { getSkuLookupVariants } from '@/lib/sku';
import type {
  Order, PedidoOperacionalItemApiDto, PedidoVendaDetalheApiResponse,
  PedidoVendaGrupoDetalheApiDto,
} from '@/types/order';
import styles from './PedidoDetailsDrawer.module.css';

const { Text, Title } = Typography;

function getPedidoItemDisplaySku(sellerSku: string | null): string | null {
  if (!sellerSku) return null;
  return getSkuLookupVariants(sellerSku).find((sku) => /^VTK[A-Z0-9]+$/.test(sku)) || sellerSku;
}

function sanitizeMlTechnicalSuffix(name: string): string {
  const raw = String(name || '').trim();
  const match = raw.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (!match) return raw;
  const base = match[1].trim();
  const suffix = match[2].trim();
  if (!base) return raw;
  return /\d/.test(suffix) || /^[A-Z0-9_.-]+$/.test(suffix.toUpperCase()) ? base : raw;
}

export function getDisplayClientName(order: Pick<Order, 'contato'>): string {
  return sanitizeMlTechnicalSuffix(String(order.contato?.nome || '').trim()) || '—';
}

export function getDisplayFiscalClientName(order: Pick<Order, 'billing_nome'>): string {
  return String(order.billing_nome || '').trim();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function formatStatus(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '—';
  if (normalized in ORDER_STATUS_LABELS) {
    return ORDER_STATUS_LABELS[normalized as keyof typeof ORDER_STATUS_LABELS];
  }
  return normalized.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type DetailProductRow = Omit<PedidoOperacionalItemApiDto, 'quantidade' | 'valor_unitario' | 'valor_total_liquido'> & {
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total_liquido: number | null;
};

function detailItems(group: PedidoVendaGrupoDetalheApiDto): DetailProductRow[] {
  if (group.items.length > 0) return group.items;
  if (!group.purchase?.produto_descricao) return [];
  return [{
    titulo: group.purchase.produto_descricao,
    quantidade: group.purchase.quantidade,
    seller_sku: group.purchase.produto_sku,
    ml_item_id: null,
    valor_unitario: null,
    valor_total_liquido: group.purchase.valor_total,
    cmv_unitario_snapshot: null,
    cmv_total_snapshot: null,
    cmv_capturado_em: null,
  }];
}

type PedidoDetailsDrawerProps = {
  order: Order | null;
  detail: PedidoVendaDetalheApiResponse['data'] | null;
  open: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  canTrack: boolean;
  onOpenDanfe: (order: Order) => void;
  onDownloadXml: (order: Order) => void;
  actions?: ReactNode;
};

export default function PedidoDetailsDrawer({
  order, detail, open, loading, error, onRetry, onClose, canTrack,
  onOpenDanfe, onDownloadXml, actions,
}: PedidoDetailsDrawerProps) {
  const { token } = theme.useToken();
  const mlSaleId = order ? String(order.ml_order_id || order.numero) : '';
  const mlPackId = order ? String(order.ml_pack_id || '').trim() : '';
  const mlDetailReference = mlPackId || mlSaleId;
  const progress = order ? getOrderSalesProgress(order) : null;
  const progressColor = progress?.tone === 'error'
    ? token.colorError
    : progress?.tone === 'success' ? token.colorSuccess : token.colorPrimary;
  const profitColor = order?.lucro == null || order.lucro === 0
    ? token.colorTextSecondary
    : order.lucro > 0 ? token.colorSuccess : token.colorError;
  const hasPendingCmv = Boolean(detail?.groups.some((group) => (
    group.items.some((item) => item.cmv_total_snapshot == null)
  )));
  const profitDisplay = order?.lucro == null
    ? order?.profit_pending
      ? hasPendingCmv
        ? 'Pendente: custo do produto'
        : 'Pendente: frete, tarifa ou tributo'
      : '—'
    : formatCurrency(order.lucro);
  const address = (order?.billing_endereco || {}) as {
    street_name?: string; street_number?: string; complement?: string;
    neighborhood?: string; city_name?: string; state_id?: string; zip_code?: string;
  };
  const addressLines = [
    [address.street_name, address.street_number].filter(Boolean).join(', '),
    address.complement,
    address.neighborhood,
    [address.city_name, address.state_id].filter(Boolean).join(' - '),
    address.zip_code ? `CEP ${address.zip_code}` : '',
  ].filter(Boolean);

  const productContent = detail ? (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      {detail.groups.map((group, groupIndex) => {
        const items = detailItems(group);
        const purchase = group.purchase;
        const reference = group.ml_order_id || group.numero || group.pedido_id;
        const origin = group.fulfillment_source === 'internal' || group.envio_interno_at
          ? 'Estoque interno'
          : purchase?.fornecedor_nome || 'Fornecedor não definido';
        return (
          <section key={group.pedido_id} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, padding: 16 }}>
            <Space direction="vertical" size={2} style={{ marginBottom: 12 }}>
              <Title level={5} style={{ margin: 0 }}>
                {detail.groups.length > 1 ? `Pedido ${groupIndex + 1} de ${detail.groups.length}` : 'Produtos da venda'}
              </Title>
              <Text type="secondary">Venda ML #{reference}</Text>
            </Space>
            {items.length > 0 ? (
              <Table<DetailProductRow>
                size="small"
                pagination={false}
                rowKey={(item, index) => `${item.ml_item_id || item.seller_sku || item.titulo}-${index}`}
                dataSource={items}
                scroll={{ x: 880 }}
                columns={[
                  { title: 'Produto', dataIndex: 'titulo', key: 'titulo', width: 300, render: (value: string) => value || 'Produto não informado' },
                  {
                    title: 'SKU', dataIndex: 'seller_sku', key: 'seller_sku', width: 150,
                    render: (value: string | null) => {
                      const sku = getPedidoItemDisplaySku(value);
                      return sku ? <Link href={`/produtos?search=${encodeURIComponent(sku)}`}>{sku}</Link> : '—';
                    },
                  },
                  { title: 'Qtd.', dataIndex: 'quantidade', key: 'quantidade', width: 70, align: 'right', render: (value: number | null) => value ?? '—' },
                  { title: 'Unitário', dataIndex: 'valor_unitario', key: 'valor_unitario', width: 100, align: 'right', render: (value: number | null) => value == null ? '—' : formatCurrency(value) },
                  { title: 'Total', dataIndex: 'valor_total_liquido', key: 'valor_total_liquido', width: 100, align: 'right', render: (value: number | null) => value == null ? '—' : formatCurrency(value) },
                  { title: 'Custo unit.', dataIndex: 'cmv_unitario_snapshot', key: 'cmv_unitario_snapshot', width: 110, align: 'right', render: (value: number | null) => value == null ? 'Pendente' : formatCurrency(value) },
                  { title: 'CMV', dataIndex: 'cmv_total_snapshot', key: 'cmv_total_snapshot', width: 110, align: 'right', render: (value: number | null) => value == null ? 'Pendente' : formatCurrency(value) },
                ]}
              />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Itens ainda não sincronizados" />}
            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginTop: 16 }}>
              <Descriptions.Item label="Origem">{origin}</Descriptions.Item>
              <Descriptions.Item label="Pedido DSLite">
                {purchase?.dslite_id
                  ? <Link href={`/compras?search=${encodeURIComponent(purchase.dslite_id)}`}>#{purchase.dslite_id}</Link>
                  : 'Não criado'}
              </Descriptions.Item>
              <Descriptions.Item label="Status DSLite">{formatStatus(purchase?.status_dslite || group.dslite_status)}</Descriptions.Item>
              <Descriptions.Item label="Valor da compra">{purchase?.valor_total == null ? '—' : formatCurrency(purchase.valor_total)}</Descriptions.Item>
              <Descriptions.Item label="Frete da compra">{purchase?.valor_frete == null ? '—' : formatCurrency(purchase.valor_frete)}</Descriptions.Item>
              <Descriptions.Item label="Pagamento ao fornecedor">
                {purchase?.supplier_payment_amount == null
                  ? formatStatus(purchase?.supplier_payment_status)
                  : `${formatCurrency(purchase.supplier_payment_amount)} · ${formatStatus(purchase.supplier_payment_status)}`}
              </Descriptions.Item>
              {purchase?.supplier_settlement_id && <Descriptions.Item label="Liquidação consolidada">
                <Space direction="vertical" size={0}>
                  <Text>#{purchase.supplier_settlement_id.slice(0, 8)} · {purchase.supplier_settlement_status || 'estado indisponível'}</Text>
                  {purchase.supplier_settlement_credit_amount != null && <Text>Crédito alocado {formatCurrency(purchase.supplier_settlement_credit_amount)} · PIX alocado {formatCurrency(purchase.supplier_settlement_pix_amount || 0)}</Text>}
                  <Link href={`/compras?fornecedorId=${encodeURIComponent(purchase.fornecedor_id || '')}`}>Ver em Compras</Link>
                </Space>
              </Descriptions.Item>}
            </Descriptions>
          </section>
        );
      })}
      {detail.unmatchedPurchases.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Compra sem vínculo inequívoco"
          description={(
            <Space direction="vertical" size={2}>
              {detail.unmatchedPurchases.map((purchase) => (
                <Text key={purchase.id}>DSLite #{purchase.dslite_id} · {purchase.fornecedor_nome || 'Fornecedor não informado'}</Text>
              ))}
            </Space>
          )}
        />
      )}
    </Space>
  ) : null;

  const clientContent = order ? (
    <div className={styles.clientLayout}>
      <section className={styles.detailSection} aria-labelledby="sale-client-title">
        <h3 id="sale-client-title">Cliente</h3>
        <div className={styles.clientName}>
          {order.cliente_id
            ? <Link href={`/clientes/${order.cliente_id}`}>{getDisplayFiscalClientName(order) || getDisplayClientName(order)}</Link>
            : getDisplayFiscalClientName(order) || getDisplayClientName(order)}
        </div>
        <div className={styles.detailField}>
          <span>Documento</span>
          <strong>{order.contato.numeroDocumento || '—'}</strong>
        </div>
        <div className={styles.detailField}>
          <span>Endereço</span>
          <div className={styles.address}>
            {addressLines.length > 0
              ? addressLines.map((line) => <span key={line}>{line}</span>)
              : 'Endereço ainda não sincronizado'}
          </div>
        </div>
      </section>
      <div className={styles.rightColumn}>
        <section className={styles.detailSection} aria-labelledby="sale-delivery-title">
          <h3 id="sale-delivery-title">Entrega</h3>
          <div className={styles.fieldGrid}>
            <div className={styles.detailField}><span>Código do envio ML</span><strong>{order.ml_shipment_id || '—'}</strong></div>
            <div className={styles.detailField}><span>Código de rastreio</span><strong>{order.rastreio || '—'}</strong></div>
          </div>
          <div className={styles.externalLink}>
            {order.is_homologation_fixture
              ? 'Mercado Livre indisponível na amostra protegida'
              : <a href={`https://www.mercadolivre.com.br/vendas/${mlDetailReference}/detalhe`} target="_blank" rel="noopener noreferrer">Abrir venda{mlPackId ? ` / pack ${mlPackId}` : ''} no Mercado Livre</a>}
          </div>
        </section>
        <section className={styles.detailSection} aria-labelledby="sale-fiscal-title">
          <h3 id="sale-fiscal-title">Fiscal e entrega</h3>
          <div className={styles.fieldGrid}>
            <div className={styles.detailField}>
              <span>Nota fiscal</span>
              <strong>{(order.operational_invoice_numbers || []).length > 0
                ? (order.operational_invoice_numbers || []).join(', ')
                : order.notaFiscal?.numero || 'Não emitida'}</strong>
            </div>
            <div className={styles.detailField}><span>Situação da NF-e</span><strong>{formatStatus(order.nfe_status)}</strong></div>
          </div>
          <div className={styles.detailField}>
            <span>Chave da NF-e</span>
            <strong className={styles.invoiceKey}>{order.nfe_chave ? <Text copyable={{ text: order.nfe_chave }}>{order.nfe_chave}</Text> : '—'}</strong>
          </div>
          {order.notaFiscal?.emitida && (
            <Space wrap className={styles.documentActions}>
              <Button size="small" icon={<FilePdfOutlined />} disabled={order.is_homologation_fixture} onClick={() => onOpenDanfe(order)}>Abrir DANFE</Button>
              <Button size="small" disabled={order.is_homologation_fixture} onClick={() => onDownloadXml(order)}>Baixar XML</Button>
            </Space>
          )}
        </section>
      </div>
    </div>
  ) : null;

  const historyContent = detail ? (
    detail.history.length > 0 ? (
      <Timeline items={detail.history.map((event) => ({
        color: event.level === 'error' ? 'red' : event.level === 'warning' ? 'orange' : event.level === 'success' ? 'green' : 'blue',
        children: (
          <div>
            <Text strong>{event.label}</Text>
            {event.result && <Text type="secondary" style={{ display: 'block' }}>{formatStatus(event.result)}</Text>}
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{formatDateTime(event.date)}</Text>
          </div>
        ),
      }))} />
    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum evento operacional registrado" />
  ) : null;

  return (
    <Drawer
      title={order ? (
        <div>
          <Text strong>Venda #{mlSaleId}</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            {mlPackId && mlPackId !== mlSaleId ? `Pack #${mlPackId} · ` : ''}{formatDateTime(order.data)}
          </Text>
        </div>
      ) : 'Detalhes da venda'}
      open={open}
      onClose={onClose}
      width="min(960px, 100vw)"
      destroyOnHidden
      extra={order ? (
        <Tag color={order.situacao.valor === 'entregue' ? 'green' : order.situacao.valor === 'cancelado' ? 'default' : 'gold'}>
          {formatStatus(order.situacao.valor)}
        </Tag>
      ) : null}
      footer={order && actions ? <Space wrap>{actions}</Space> : null}
      styles={{ footer: { background: token.colorBgElevated } }}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {order?.has_split_fulfillment && (
          <Alert type="warning" showIcon message="Fluxo dividido" description="Esta venda reúne mais de um pedido, compra ou documento fiscal. Os vínculos abaixo são exibidos separadamente." />
        )}
        {order?.is_homologation_fixture && (
          <Alert type="info" showIcon message="Registro de demonstração protegido" description="Os dados podem ser consultados, mas ações externas, etiquetas e documentos fiscais estão desabilitados." />
        )}
        {error && (
          <Alert type="error" showIcon message="Não foi possível carregar o detalhe completo" description={userSafeMessage(error, 'Os dados da lista foram preservados. Tente novamente.')} action={<Button size="small" onClick={onRetry}>Tentar novamente</Button>} />
        )}
        {loading && !detail ? <Skeleton active paragraph={{ rows: 10 }} /> : null}
        {order && detail ? (
          <>
            <section className={styles.saleSummary}>
              <div className={styles.summaryAmounts}>
                <div><span>Total</span><strong>{formatCurrency(order.total)}</strong></div>
                <div><span>Lucro</span><strong style={{ color: profitColor }}>{profitDisplay}</strong></div>
              </div>
              {progress && (
                <div className={styles.summaryProgress}>
                  <Text strong>Etapa {progress.currentStep}/{SALES_PROGRESS_STAGES.length} — {progress.currentLabel}</Text>
                  <Progress
                    aria-label={`Progresso da venda: ${progress.completedSteps} de ${SALES_PROGRESS_STAGES.length} etapas concluídas`}
                    percent={(progress.completedSteps / SALES_PROGRESS_STAGES.length) * 100}
                    steps={SALES_PROGRESS_STAGES.length}
                    showInfo={false}
                    strokeColor={progressColor}
                    style={{ display: 'block', margin: '8px 0 2px' }}
                  />
                  <Text type="secondary">Próxima: {progress.nextLabel}</Text>
                </div>
              )}
            </section>
            <Tabs items={[
              { key: 'products', label: 'Produtos e compras', children: productContent },
              { key: 'client', label: 'Cliente, fiscal e entrega', children: clientContent },
              {
                key: 'tracking',
                label: 'Acompanhamento',
                children: (
                  <OrderTrackingDetails
                    orderId={order.dbId}
                    orderStatus={order.situacao.valor}
                    enabled={canTrack && Boolean(order.ml_shipment_id) && !order.is_homologation_fixture}
                    disabledReason={order.is_homologation_fixture
                      ? 'A consulta ao Mercado Livre não está disponível para este registro de demonstração.'
                      : !order.ml_shipment_id
                        ? 'Esta venda ainda não possui um código de envio do Mercado Livre.'
                        : 'Seu perfil não possui permissão para acompanhar esta entrega.'}
                  />
                ),
              },
              { key: 'history', label: 'Histórico operacional', children: historyContent },
            ]} />
          </>
        ) : null}
      </Space>
    </Drawer>
  );
}
