'use client';

import { useState, useEffect } from 'react';
import { Modal, Timeline, Tag, Spin, Alert, Button, Typography, Empty, Divider } from 'antd';
import { LoadingOutlined, CarOutlined, WarningOutlined, CheckCircleOutlined, FileTextOutlined, ArrowRightOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import type { OrderStatus } from '@/types/order';

const { Title, Text } = Typography;

interface TrackingHistoryItem {
  status: string;
  substatus: string;
  date: string;
  description: string;
}

interface ReturnHistoryItem extends TrackingHistoryItem {
  shipmentId: string;
}

interface ReturnShipment {
  shipmentId: string;
  status: string;
  trackingNumber: string | null;
  type: string;
  destination: string;
}

interface TrackingData {
  currentStatus: string;
  currentSubstatus: string | null;
  carrier: { name: string; trackingUrl: string | null } | null;
  history: TrackingHistoryItem[];
  returnHistory: ReturnHistoryItem[];
  returnShipments: ReturnShipment[];
  claim: { id: string; status: string; type: string; stage: string; reason: string } | null;
  rastreio: string | null;
}

interface TrackingModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderStatus: OrderStatus;
}

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
  cancelado: 'default',
  aberto: 'processing',
  atendido: 'processing',
  faturado: 'purple',
};

const statusLabelMap: Record<string, string> = {
  pendente: 'Pendente',
  preparando: 'Preparando',
  etiqueta_impressa: 'Etiqueta Impressa',
  coletado: 'Coletado',
  em_transito: 'Em Trânsito',
  saiu_entrega: 'Saiu para Entrega',
  dest_ausente: 'Destinatário Ausente',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  cancelado: 'Cancelado',
  aberto: 'Aberto',
  atendido: 'Atendido',
  faturado: 'Faturado',
};

export default function TrackingModal({ open, onClose, orderId, orderStatus }: TrackingModalProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TrackingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orderId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/pedidos/${orderId}/tracking`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Erro ao buscar rastreamento');
        return res.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, orderId]);

  const currentColor = statusColorMap[orderStatus] || 'default';
  const currentLabel = statusLabelMap[orderStatus] || orderStatus;

  const hasReturnData = data && (data.returnHistory.length > 0 || data.returnShipments.length > 0);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          Fechar
        </Button>,
      ]}
      width={680}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CarOutlined style={{ color: '#1677ff' }} />
          <span>Rastreamento do Pedido</span>
        </div>
      }
      styles={{ body: { background: '#0a0a0a', padding: 0 } }}
    >
      <div style={{ background: '#141414', borderRadius: 8, padding: 20 }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: '#1677ff' }} spin />} />
            <div style={{ marginTop: 12, color: '#a0a0a0' }}>Carregando rastreamento...</div>
          </div>
        )}

        {error && (
          <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />
        )}

        {!loading && !error && data && (
          <>
            {/* Status Atual */}
            <div style={{ marginBottom: 20, textAlign: 'center' }}>
              <Tag color={currentColor} style={{ fontSize: 16, padding: '6px 16px', fontWeight: 600 }}>
                {currentLabel}
              </Tag>
              {data.rastreio && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 13 }}>Código:</Text>
                  <Text style={{ fontFamily: 'monospace', marginLeft: 8, fontSize: 14 }}>{data.rastreio}</Text>
                </div>
              )}
            </div>

            {/* Transportadora */}
            {data.carrier && (
              <div style={{ background: '#1a1a1a', borderRadius: 6, padding: 12, marginBottom: 16, textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Transportadora</Text>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{data.carrier.name}</div>
                {data.carrier.trackingUrl && (
                  <Button
                    type="link"
                    size="small"
                    href={data.carrier.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    icon={<FileTextOutlined />}
                    style={{ marginTop: 4 }}
                  >
                    Rastrear no site oficial
                  </Button>
                )}
              </div>
            )}

            {/* ENVIO (Forward) */}
            <div style={{ marginBottom: 16 }}>
              <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ArrowRightOutlined style={{ color: '#52c41a' }} />
                ENVIO (Vendedor → Cliente)
              </Title>
              {data.history.length === 0 ? (
                <EmptyReturnMessage carrierUrl={data.carrier?.trackingUrl} />
              ) : (
                <Timeline
                  mode="left"
                  items={data.history.map((h, idx) => ({
                    label: formatDate(h.date),
                    children: (
                      <div>
                        <Text strong style={{ color: '#e0e0e0' }}>{h.description}</Text>
                        {h.substatus && h.substatus !== h.status && (
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>{h.substatus}</Text>
                          </div>
                        )}
                      </div>
                    ),
                    color: idx === data.history.length - 1 ? '#52c41a' : '#555',
                    dot: idx === data.history.length - 1 ? <CheckCircleOutlined /> : undefined,
                  }))}
                />
              )}
            </div>

            {/* DEVOLUÇÃO (Return) */}
            {hasReturnData && (
              <>
                <Divider style={{ borderColor: '#303030', margin: '16px 0' }} />
                <div style={{ marginBottom: 16 }}>
                  <Title level={5} style={{ color: '#e0e0e0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ArrowLeftOutlined style={{ color: '#faad14' }} />
                    DEVOLUÇÃO (Cliente → Vendedor)
                  </Title>

                  {/* Códigos de rastreio da devolução */}
                  {data.returnShipments.length > 0 && (
                    <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {data.returnShipments.map((rs) => (
                        rs.trackingNumber && (
                          <div key={rs.shipmentId} style={{ background: '#1a1a1a', borderRadius: 4, padding: '6px 12px' }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {rs.type === 'return_from_triage' ? 'Triagem' : 'Devolução'}
                              {rs.destination === 'seller_address' ? ' → Vendedor' : rs.destination === 'warehouse' ? ' → Warehouse' : ''}
                            </Text>
                            <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#faad14' }}>
                              {rs.trackingNumber}
                            </div>
                            <Tag style={{ marginTop: 4, fontSize: 11, padding: '0px 4px', lineHeight: '16px' }}>
                              {rs.status}
                            </Tag>
                          </div>
                        )
                      ))}
                    </div>
                  )}

                  {data.returnHistory.length === 0 ? (
                    <EmptyReturnMessage carrierUrl={null} />
                  ) : (
                    <Timeline
                      mode="left"
                      items={data.returnHistory.map((h, idx) => ({
                        label: formatDate(h.date),
                        children: (
                          <div>
                            <Text strong style={{ color: '#e0e0e0' }}>{h.description}</Text>
                            {h.substatus && h.substatus !== h.status && (
                              <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>{h.substatus}</Text>
                              </div>
                            )}
                            <div>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                Envio #{h.shipmentId.slice(-6)}
                              </Text>
                            </div>
                          </div>
                        ),
                        color: idx === data.returnHistory.length - 1 ? '#faad14' : '#555',
                        dot: idx === data.returnHistory.length - 1 ? <CheckCircleOutlined /> : undefined,
                      }))}
                    />
                  )}
                </div>
              </>
            )}

            {/* Reclamação */}
            {data.claim && (
              <Alert
                message={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <WarningOutlined style={{ color: '#faad14' }} />
                    <span>Reclamação</span>
                  </div>
                }
                description={
                  <div style={{ marginTop: 8 }}>
                    <div><strong>Motivo:</strong> {data.claim.reason}</div>
                    <div><strong>Status:</strong> {data.claim.status}</div>
                    <div><strong>Tipo:</strong> {data.claim.type} ({data.claim.stage})</div>
                  </div>
                }
                type="warning"
                showIcon={false}
                style={{ marginTop: 12, background: '#2b2111', borderColor: '#594214' }}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function EmptyReturnMessage({ carrierUrl }: { carrierUrl: string | null | undefined }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <Empty
        description={
          <div>
            <div style={{ color: '#a0a0a0', marginBottom: 8 }}>Sem histórico detalhado disponível</div>
            <div style={{ fontSize: 12, color: '#666' }}>
              A API do Mercado Livre ainda não possui eventos de rastreamento para este envio.
            </div>
          </div>
        }
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
      {carrierUrl && (
        <Button
          type="link"
          href={carrierUrl}
          target="_blank"
          rel="noopener noreferrer"
          icon={<FileTextOutlined />}
          style={{ marginTop: 8 }}
        >
          Rastrear no site da transportadora
        </Button>
      )}
    </div>
  );
}
