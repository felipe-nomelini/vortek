'use client';

import type { ReactNode } from 'react';
import { Alert, Button, Descriptions, Drawer, Space, Tabs, Tag, Timeline, Typography } from 'antd';

export type EstoqueDrawerItem = {
  id: string;
  kind: 'entrada' | 'reserva' | 'despacho';
  produtoId: string;
  pedidoId: string | null;
  sku: string;
  nome: string;
  quantidade: number;
  origem: string;
  motivo: string;
  statusLabel: string;
  statusColor: string;
  statusHint: string;
  mlOrderId: string | null;
  mlPackId: string | null;
  registradoEm: string | null;
  despachadoEm: string | null;
};

type EstoqueDetailsDrawerProps = {
  item: EstoqueDrawerItem | null;
  open: boolean;
  actions?: ReactNode;
  onClose: () => void;
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR');
}

function movementLabel(kind: EstoqueDrawerItem['kind']): string {
  if (kind === 'reserva') return 'Reserva de estoque';
  if (kind === 'despacho') return 'Saída despachada';
  return 'Entrada de estoque';
}

export default function EstoqueDetailsDrawer({ item, open, actions, onClose }: EstoqueDetailsDrawerProps) {
  const saleUrl = item?.pedidoId ? `/pedidos?venda=${encodeURIComponent(item.pedidoId)}` : null;
  const mlReference = item?.mlPackId || item?.mlOrderId;
  const mlUrl = mlReference
    ? `https://www.mercadolivre.com.br/vendas/${encodeURIComponent(mlReference)}/detalhe`
    : null;

  const overview = item ? (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Descriptions column={1} bordered size="small" title="Produto e quantidade">
        <Descriptions.Item label="Produto">{item.nome}</Descriptions.Item>
        <Descriptions.Item label="SKU Bentevi">{item.sku}</Descriptions.Item>
        <Descriptions.Item label="Quantidade">{item.quantidade} un.</Descriptions.Item>
      </Descriptions>

      <Descriptions column={1} bordered size="small" title="Origem e venda">
        <Descriptions.Item label="Origem">{item.origem}</Descriptions.Item>
        <Descriptions.Item label="Pack ML">{item.mlPackId ? `#${item.mlPackId}` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Venda ML">{item.mlOrderId ? `#${item.mlOrderId}` : '—'}</Descriptions.Item>
        <Descriptions.Item label="Motivo">{item.motivo}</Descriptions.Item>
      </Descriptions>

      <Descriptions column={1} bordered size="small" title="Estado atual">
        <Descriptions.Item label="Situação">
          <Space direction="vertical" size={3}>
            <Tag color={item.statusColor}>{item.statusLabel}</Tag>
            <Typography.Text type="secondary">{item.statusHint}</Typography.Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Registrado em">{formatDateTime(item.registradoEm)}</Descriptions.Item>
        {item.kind === 'despacho' && (
          <Descriptions.Item label="Despachado em">{formatDateTime(item.despachadoEm)}</Descriptions.Item>
        )}
      </Descriptions>

      {(saleUrl || mlUrl) && (
        <Space wrap>
          {saleUrl && <Button href={saleUrl}>Abrir venda na Bentevi</Button>}
          {mlUrl && <Button href={mlUrl} target="_blank" rel="noopener noreferrer">Abrir no Mercado Livre</Button>}
        </Space>
      )}
    </Space>
  ) : null;

  const traceability = item ? (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Rastreabilidade do movimento"
        description="São exibidos somente marcos com data registrada no ledger. A Bentevi não fabrica um histórico de transições sem timestamp."
      />
      <Timeline
        items={[
          {
            color: 'gray',
            children: (
              <div>
                <Typography.Text strong>{movementLabel(item.kind)} registrada</Typography.Text><br />
                <Typography.Text type="secondary">{formatDateTime(item.registradoEm)}</Typography.Text>
              </div>
            ),
          },
          ...(item.kind === 'despacho' ? [{
            color: 'green',
            children: (
              <div>
                <Typography.Text strong>Saída física confirmada</Typography.Text><br />
                <Typography.Text type="secondary">{formatDateTime(item.despachadoEm)}</Typography.Text>
              </div>
            ),
          }] : []),
        ]}
      />
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="Estado atual">
          <Tag color={item.statusColor}>{item.statusLabel}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Observação">{item.statusHint}</Descriptions.Item>
        <Descriptions.Item label="ID do movimento">{item.id}</Descriptions.Item>
      </Descriptions>
    </Space>
  ) : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={736}
      title={item ? (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Typography.Text strong>{item.nome}</Typography.Text>
            <Tag color={item.statusColor}>{item.statusLabel}</Tag>
          </Space>
          <Typography.Text type="secondary">{item.sku} · {movementLabel(item.kind)}</Typography.Text>
        </Space>
      ) : 'Detalhes do estoque'}
      extra={actions}
      destroyOnHidden
    >
      <Tabs items={[
        { key: 'overview', label: 'Visão geral', children: overview },
        { key: 'traceability', label: 'Rastreabilidade', children: traceability },
      ]} />
    </Drawer>
  );
}
