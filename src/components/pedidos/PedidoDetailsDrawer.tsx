'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Alert, Button, Descriptions, Divider, Drawer, Space, Tag, Timeline, Typography } from 'antd';
import { CarOutlined, FilePdfOutlined } from '@ant-design/icons';
import { formatCurrency } from '@/lib/format';
import { getSkuLookupVariants } from '@/lib/sku';
import type { Order } from '@/types/order';

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

function buildTimeline(order: Order) {
  const events = [
    { at: order.dataCriacao || order.data, label: 'Venda registrada' },
    { at: order.fulfillment_selected_at, label: 'Fulfillment definido' },
    { at: order.envio_interno_at, label: 'Envio interno processado' },
    { at: order.dslite_label_operational_updated_at, label: 'Etiqueta DSLite atualizada' },
    { at: order.whatsapp_label_updated_at, label: 'WhatsApp do fornecedor atualizado' },
    { at: order.dataSaida, label: 'Pedido despachado' },
  ].filter((event): event is { at: string; label: string } => Boolean(event.at));

  return events
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map((event) => ({ children: <><Text strong>{event.label}</Text><br /><Text type="secondary">{formatDateTime(event.at)}</Text></> }));
}

type PedidoDetailsDrawerProps = {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onTrack: (order: Order) => void;
  onOpenDanfe: (order: Order) => void;
  onDownloadXml: (order: Order) => void;
  actions?: ReactNode;
};

export default function PedidoDetailsDrawer({
  order,
  open,
  onClose,
  onTrack,
  onOpenDanfe,
  onDownloadXml,
  actions,
}: PedidoDetailsDrawerProps) {
  const address = (order?.billing_endereco || {}) as {
    street_name?: string;
    street_number?: string;
    complement?: string;
    neighborhood?: string;
    city_name?: string;
    state_id?: string;
    zip_code?: string;
  };
  const addressLines = [
    [address.street_name, address.street_number].filter(Boolean).join(', '),
    address.complement,
    address.neighborhood,
    [address.city_name, address.state_id].filter(Boolean).join(' - '),
    address.zip_code ? `CEP ${address.zip_code}` : '',
  ].filter(Boolean);

  return (
    <Drawer
      title={order ? `Pedido #${order.ml_pack_id || order.numero}` : 'Detalhes do pedido'}
      open={open}
      onClose={onClose}
      width={760}
      destroyOnHidden
      extra={order ? <Tag color="gold">{formatCurrency(order.total)}</Tag> : null}
      footer={order && actions ? <Space wrap>{actions}</Space> : null}
    >
      {order && (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          {order.has_split_fulfillment && (
            <Alert
              type="warning"
              showIcon
              message="Fluxo legado dividido"
              description="Este carrinho preserva múltiplos pedidos DSLite ou notas fiscais. Revise o histórico antes de agir."
            />
          )}

          {order.is_homologation_fixture && (
            <Alert
              type="info"
              showIcon
              message="Amostra protegida de homologação"
              description="Os dados são reais, mas rastreamento, links externos, etiquetas e documentos fiscais estão desabilitados."
            />
          )}

          <div>
            <Title level={5}>Resumo operacional</Title>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
              <Descriptions.Item label="Cliente">
                {order.cliente_id ? (
                  <Link href={`/clientes/${order.cliente_id}`}>{getDisplayFiscalClientName(order) || getDisplayClientName(order)}</Link>
                ) : getDisplayFiscalClientName(order) || getDisplayClientName(order)}
              </Descriptions.Item>
              <Descriptions.Item label="Documento">{order.contato.numeroDocumento || '—'}</Descriptions.Item>
              <Descriptions.Item label="Venda">{formatDateTime(order.data)}</Descriptions.Item>
              <Descriptions.Item label="Status">{order.situacao.valor.replaceAll('_', ' ')}</Descriptions.Item>
              <Descriptions.Item label="Fulfillment">{order.envio_interno_at ? 'Estoque interno' : order.fornecedor_nome || 'Fornecedor não definido'}</Descriptions.Item>
              <Descriptions.Item label="Lucro">{order.lucro === null ? (order.profit_pending ? 'Calculando' : '—') : formatCurrency(order.lucro)}</Descriptions.Item>
            </Descriptions>
          </div>

          <div>
            <Title level={5}>Linha do tempo</Title>
            <Timeline items={buildTimeline(order)} />
          </div>

          <div>
            <Title level={5}>Itens</Title>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {(order.pedido_itens || []).length > 0 ? order.pedido_itens?.map((item, index) => {
                const sku = getPedidoItemDisplaySku(item.seller_sku);
                return (
                  <div key={`${item.ml_item_id || item.seller_sku || item.titulo}-${index}`}>
                    <Text>{item.titulo}</Text><br />
                    <Text type="secondary">
                      SKU: {sku ? <Link href={`/produtos?search=${encodeURIComponent(sku)}`}>{sku}</Link> : '—'} · Qtd: {item.quantidade} · {formatCurrency(item.valor_total_liquido)}
                    </Text>
                  </div>
                );
              }) : (
                <Text type="secondary">
                  {order.compra_produto_descricao || 'Produto ainda não sincronizado'}
                  {order.compra_quantidade ? ` · Qtd: ${order.compra_quantidade}` : ''}
                </Text>
              )}
            </Space>
          </div>

          <div>
            <Title level={5}>Entrega</Title>
            {addressLines.length > 0
              ? addressLines.map((line) => <Text key={line} type="secondary" style={{ display: 'block' }}>{line}</Text>)
              : <Text type="secondary">Endereço ainda não sincronizado</Text>}
          </div>

          <div>
            <Title level={5}>Fulfillment e pagamento</Title>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Pedidos DSLite">
                {(order.operational_dslite_ids || []).length > 0
                  ? (order.operational_dslite_ids || []).map((id) => <Link key={id} href={`/compras?search=${encodeURIComponent(id)}`} style={{ marginRight: 8 }}>#{id}</Link>)
                  : order.dslite_id ? <Link href={`/compras?search=${encodeURIComponent(order.dslite_id)}`}>#{order.dslite_id}</Link> : 'Não criado'}
              </Descriptions.Item>
              <Descriptions.Item label="Próxima etapa">{order.dslite_next_action_label || order.dslite_next_action || '—'}</Descriptions.Item>
              <Descriptions.Item label="Pagamento">
                {order.supplier_payment_amount !== null && order.supplier_payment_amount !== undefined
                  ? `${formatCurrency(order.supplier_payment_amount)} · ${order.supplier_payment_status || 'pendente'}`
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
          </div>

          <div>
            <Title level={5}>Fiscal e rastreio</Title>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Nota fiscal">
                {(order.operational_invoice_numbers || []).length > 1
                  ? (order.operational_invoice_numbers || []).join(', ')
                  : order.notaFiscal?.numero || 'Não emitida'}
              </Descriptions.Item>
              <Descriptions.Item label="Rastreio">
                {order.ml_shipment_id ? (
                  <Button type="link" size="small" icon={<CarOutlined />} disabled={order.is_homologation_fixture} onClick={() => onTrack(order)}>
                    {order.rastreio || order.ml_shipment_id}
                  </Button>
                ) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Pedido ML">
                {order.is_homologation_fixture
                  ? <Text>{order.ml_pack_id || order.ml_order_id || order.numero}</Text>
                  : (
                    <a href={`https://www.mercadolivre.com.br/vendas/${order.ml_pack_id || order.ml_order_id || order.numero}/detalhe`} target="_blank" rel="noopener noreferrer">
                      {order.ml_pack_id || order.ml_order_id || order.numero}
                    </a>
                  )}
              </Descriptions.Item>
            </Descriptions>
            {order.notaFiscal?.emitida && (
              <Space style={{ marginTop: 12 }}>
                <Button size="small" icon={<FilePdfOutlined />} disabled={order.is_homologation_fixture} onClick={() => onOpenDanfe(order)}>DANFE</Button>
                <Button size="small" disabled={order.is_homologation_fixture} onClick={() => onDownloadXml(order)}>XML</Button>
              </Space>
            )}
          </div>

          <Divider style={{ margin: 0 }} />
        </Space>
      )}
    </Drawer>
  );
}
