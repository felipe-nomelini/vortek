'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Skeleton,
  Space,
  Tag,
  Timeline,
  Typography,
  theme,
} from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CarOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { OrderStatus, PedidoTrackingApiDto } from '@/types/order';

const { Text, Title } = Typography;

const statusColorMap: Record<string, string> = {
  pendente: 'orange',
  preparando: 'blue',
  etiqueta_impressa: 'blue',
  coletado: 'geekblue',
  em_transito: 'purple',
  saiu_entrega: 'cyan',
  dest_ausente: 'red',
  entregue: 'green',
  recusado: 'red',
  devolvido: 'magenta',
  concretizada_ml: 'gold',
  cancelado: 'default',
  aberto: 'processing',
  atendido: 'processing',
  faturado: 'purple',
  delivered: 'green',
  shipped: 'purple',
  ready_to_ship: 'blue',
  handling: 'orange',
  not_delivered: 'red',
};

const statusLabelMap: Record<string, string> = {
  pendente: 'Pendente',
  preparando: 'Preparando',
  etiqueta_impressa: 'Etiqueta impressa',
  coletado: 'Coletado',
  em_transito: 'Em trânsito',
  saiu_entrega: 'Saiu para entrega',
  dest_ausente: 'Destinatário ausente',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  concretizada_ml: 'Concretizada pelo ML',
  cancelado: 'Cancelado',
  aberto: 'Aberto',
  atendido: 'Atendido',
  faturado: 'Faturado',
  delivered: 'Entregue',
  shipped: 'Enviado',
  ready_to_ship: 'Pronto para envio',
  handling: 'Em preparação',
  not_delivered: 'Não entregue',
};

function formatStatus(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Desconhecido';
  return statusLabelMap[normalized]
    || normalized.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type OrderTrackingDetailsProps = {
  orderId: string;
  orderStatus: OrderStatus;
  enabled?: boolean;
  disabledReason?: string;
};

export default function OrderTrackingDetails({
  orderId,
  orderStatus,
  enabled = true,
  disabledReason,
}: OrderTrackingDetailsProps) {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PedidoTrackingApiDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled || !orderId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/pedidos/${encodeURIComponent(orderId)}/tracking`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as (PedidoTrackingApiDto & {
          erro?: string;
          error?: { message?: string };
        }) | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error?.message || payload?.erro || 'Não foi possível carregar o acompanhamento da entrega.');
        }
        setData({ ...payload, warnings: Array.isArray(payload.warnings) ? payload.warnings : [] });
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setData(null);
        setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o acompanhamento da entrega.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled, orderId, retry]);

  if (!enabled) {
    return (
      <Alert
        type="info"
        showIcon
        message="Acompanhamento indisponível"
        description={disabledReason || 'Esta venda ainda não possui um envio rastreável.'}
      />
    );
  }

  if (loading && !data) return <Skeleton active paragraph={{ rows: 8 }} />;

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Falha ao carregar o acompanhamento"
        description={error}
        action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</Button>}
      />
    );
  }

  if (!data) return null;

  const currentStatus = data.currentStatus === 'desconhecido' ? orderStatus : data.currentStatus;
  const hasForwardHistory = data.history.length > 0;
  const hasReturnData = data.returnHistory.length > 0 || data.returnShipments.length > 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {data.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Acompanhamento carregado parcialmente"
          description={data.warnings.join(' ')}
        />
      )}

      <Card size="small">
        <Space direction="vertical" size={8} style={{ width: '100%', textAlign: 'center' }}>
          <Space style={{ justifyContent: 'center' }}>
            <CarOutlined style={{ color: token.colorPrimary }} />
            <Tag color={statusColorMap[currentStatus] || 'default'} style={{ marginInlineEnd: 0 }}>
              {formatStatus(currentStatus)}
            </Tag>
          </Space>
          {data.currentSubstatus && (
            <Text type="secondary">{formatStatus(data.currentSubstatus)}</Text>
          )}
          {data.rastreio && (
            <Text>
              Código: <Text code copyable>{data.rastreio}</Text>
            </Text>
          )}
          {data.carrier && (
            <div>
              <Text type="secondary">Transportadora</Text>
              <Text strong style={{ display: 'block' }}>{data.carrier.name}</Text>
              {data.carrier.trackingUrl && (
                <Button
                  type="link"
                  size="small"
                  href={data.carrier.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={<FileTextOutlined />}
                >
                  Rastrear no site da transportadora
                </Button>
              )}
            </div>
          )}
        </Space>
      </Card>

      <section>
        <Title level={5}><ArrowRightOutlined style={{ color: token.colorSuccess }} /> Envio ao cliente</Title>
        {hasForwardHistory ? (
          <Timeline
            items={data.history.map((event, index) => ({
              color: index === data.history.length - 1 ? 'green' : 'gray',
              dot: index === data.history.length - 1 ? <CheckCircleOutlined /> : undefined,
              children: (
                <div>
                  <Text strong>{event.description || formatStatus(event.substatus || event.status)}</Text>
                  {event.substatus && event.description !== event.substatus && (
                    <Text type="secondary" style={{ display: 'block' }}>{formatStatus(event.substatus)}</Text>
                  )}
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{formatDate(event.date)}</Text>
                </div>
              ),
            }))}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sem eventos de entrega disponíveis" />
        )}
      </section>

      {hasReturnData && (
        <section>
          <Title level={5}><ArrowLeftOutlined style={{ color: token.colorWarning }} /> Devolução</Title>
          {data.returnShipments.length > 0 && (
            <Space wrap style={{ marginBottom: 16 }}>
              {data.returnShipments.map((shipment) => (
                <Card key={shipment.shipmentId} size="small">
                  <Text type="secondary">{shipment.type === 'return_from_triage' ? 'Triagem' : 'Devolução'}</Text>
                  <Text strong style={{ display: 'block' }}>{shipment.trackingNumber || `Envio #${shipment.shipmentId}`}</Text>
                  <Text type="secondary">{formatStatus(shipment.status)}</Text>
                </Card>
              ))}
            </Space>
          )}
          {data.returnHistory.length > 0 ? (
            <Timeline
              items={data.returnHistory.map((event, index) => ({
                color: index === data.returnHistory.length - 1 ? 'orange' : 'gray',
                dot: index === data.returnHistory.length - 1 ? <CheckCircleOutlined /> : undefined,
                children: (
                  <div>
                    <Text strong>{event.description || formatStatus(event.substatus || event.status)}</Text>
                    <Text type="secondary" style={{ display: 'block' }}>Envio #{event.shipmentId}</Text>
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{formatDate(event.date)}</Text>
                  </div>
                ),
              }))}
            />
          ) : null}
        </section>
      )}

      {data.claim && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={`Reclamação #${data.claim.id}`}
          description={`${data.claim.reason} · ${formatStatus(data.claim.status)} · ${formatStatus(data.claim.type)}`}
        />
      )}
    </Space>
  );
}
