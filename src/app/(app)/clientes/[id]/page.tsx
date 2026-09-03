'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ArrowLeftOutlined,
  CarOutlined,
  EditOutlined,
  EyeOutlined,
  LoadingOutlined,
  MailOutlined,
  PhoneOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import TrackingModal from '@/components/modals/TrackingModal';
import { formatCurrency } from '@/lib/format';
import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS } from '@/lib/orders/operational-view';
import { hasPermission, type VortekRole } from '@/lib/permissions';
import type {
  ClienteContactUpdate,
  ClienteDetailItem,
  ClienteDetailOrder,
  ClienteDetailResponse,
} from '@/types/clientes';
import styles from './cliente-detalhe.module.css';

const { Text, Title } = Typography;
const VALID_ROLES: VortekRole[] = ['admin', 'gerente', 'operador', 'visualizador'];

function formatDocument(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value || 'Não informado';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function personTypeLabel(value: string): string {
  if (value === 'J') return 'Pessoa jurídica';
  if (value === 'F') return 'Pessoa física';
  return 'Tipo não informado';
}

function readValue(value: string | null | undefined): string {
  return String(value || '').trim() || 'Não informado';
}

function saleReference(order: ClienteDetailOrder) {
  const hasDistinctPack = Boolean(order.packId && order.packId !== order.saleId);
  return (
    <div className={styles.saleReference}>
      <strong>{hasDistinctPack ? `Pack #${order.packId}` : `Venda #${order.saleId}`}</strong>
      {hasDistinctPack && <span>Venda #{order.saleId}</span>}
    </div>
  );
}

function deliveryReference(order: ClienteDetailOrder) {
  if (order.tracking) {
    return (
      <div className={styles.deliveryReference}>
        <strong>{order.tracking}</strong>
        <span>Código de rastreio</span>
      </div>
    );
  }
  if (order.shipmentId) {
    return (
      <div className={styles.deliveryReference}>
        <strong>Envio criado</strong>
        <span>Shipment #{order.shipmentId}</span>
      </div>
    );
  }
  return <span className={styles.muted}>Aguardando envio</span>;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const [form] = Form.useForm<ClienteContactUpdate>();
  const [detail, setDetail] = useState<ClienteDetailResponse | null>(null);
  const [role, setRole] = useState<VortekRole | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [trackingOrder, setTrackingOrder] = useState<ClienteDetailOrder | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const canEditContact = Boolean(role && hasPermission(role, 'customers.manage'));
  const canTrack = Boolean(role && hasPermission(role, 'sales.track'));
  const client = detail?.data.client || null;
  const summary = detail?.data.summary || null;

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/clientes/${encodeURIComponent(id)}?page=${page}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Partial<ClienteDetailResponse> & { error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || 'Não foi possível carregar o cliente');
      setDetail(payload as ClienteDetailResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o cliente');
    } finally {
      setLoading(false);
    }
  }, [id, page]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => {
        const cargo = profile?.cargo as VortekRole | undefined;
        setRole(cargo && VALID_ROLES.includes(cargo) ? cargo : null);
      })
      .catch(() => setRole(null));
  }, []);

  const openContactEditor = () => {
    if (!client || !canEditContact) return;
    form.setFieldsValue({ email: client.email, phone: client.phone });
    setEditorOpen(true);
  };

  const closeContactEditor = () => {
    setEditorOpen(false);
    form.resetFields();
  };

  const saveContact = async (values: ClienteContactUpdate) => {
    if (!client || !canEditContact) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/clientes/${encodeURIComponent(client.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: values.email.trim(), phone: values.phone.trim() }),
      });
      const payload = await response.json().catch(() => ({})) as { data?: ClienteDetailItem; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || 'Não foi possível atualizar o contato');
      setDetail((current) => current ? {
        ...current,
        data: { ...current.data, client: payload.data as ClienteDetailItem },
      } : current);
      closeContactEditor();
      messageApi.success('Contato atualizado no Bentevi');
    } catch (saveError) {
      messageApi.error(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar o contato');
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo<TableProps<ClienteDetailOrder>['columns']>(() => [
    {
      title: 'Data',
      dataIndex: 'date',
      key: 'date',
      width: 150,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: 'Venda ML',
      key: 'sale',
      width: 230,
      render: (_, order) => saleReference(order),
    },
    {
      title: 'Valor',
      dataIndex: 'total',
      key: 'total',
      width: 125,
      render: (value: number) => <strong className={styles.orderValue}>{formatCurrency(value)}</strong>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: ClienteDetailOrder['status']) => (
        <Tag color={ORDER_STATUS_COLORS[status] || 'default'}>
          {ORDER_STATUS_LABELS[status] || status}
        </Tag>
      ),
    },
    {
      title: 'Entrega',
      key: 'delivery',
      width: 215,
      render: (_, order) => deliveryReference(order),
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 220,
      render: (_, order) => {
        const trackingDisabled = !canTrack || order.isHomologationFixture;
        const trackingReason = order.isHomologationFixture
          ? 'A consulta externa está desabilitada para a amostra protegida.'
          : 'Seu perfil não possui permissão para acompanhar entregas.';
        return (
          <Space size={6}>
            <Link href={`/pedidos?venda=${encodeURIComponent(order.id)}`}>
              <Button size="small" icon={<EyeOutlined />}>Ver venda</Button>
            </Link>
            {order.shipmentId && (
              <Tooltip title={trackingDisabled ? trackingReason : 'Abrir acompanhamento da entrega'}>
                <span>
                  <Button
                    size="small"
                    icon={<CarOutlined />}
                    disabled={trackingDisabled}
                    onClick={() => setTrackingOrder(order)}
                  >
                    Acompanhar
                  </Button>
                </span>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ], [canTrack]);

  if (loading && !detail) {
    return (
      <div className={styles.centerState}>
        <Spin indicator={<LoadingOutlined className={styles.loadingIcon} spin />} />
        <Text>Carregando cliente...</Text>
      </div>
    );
  }

  if ((error && !detail) || !detail || !client || !summary) {
    return (
      <div className={styles.centerState}>
        <Title level={4}>{error || 'Cliente não encontrado'}</Title>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/clientes')}>Voltar para Clientes</Button>
          <Button type="primary" onClick={() => void fetchDetail()}>Tentar novamente</Button>
        </Space>
      </div>
    );
  }

  const orders = detail.data.orders;
  const hasFixtureOrders = orders.some((order) => order.isHomologationFixture);

  return (
    <div className={styles.page}>
      {contextHolder}

      <header className={styles.stickyHeader}>
        <div className={styles.headerIdentity}>
          <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Voltar para Clientes" onClick={() => router.push('/clientes')} />
          <div>
            <span>Clientes / Detalhe</span>
            <Title level={3}>{client.name}</Title>
          </div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchDetail()}>Atualizar</Button>
          {canEditContact && <Button type="primary" icon={<EditOutlined />} onClick={openContactEditor}>Editar contato</Button>}
        </Space>
      </header>

      {error && (
        <Alert
          type="error"
          showIcon
          message="Não foi possível atualizar o cliente"
          description={`${error} Os dados anteriores foram preservados.`}
          action={<Button size="small" onClick={() => void fetchDetail()}>Tentar novamente</Button>}
        />
      )}

      <section className={styles.hero}>
        <div className={styles.heroIdentity}>
          <span className={styles.personType}>{personTypeLabel(client.personType)}</span>
          <Title level={2}>{client.name}</Title>
          <div className={styles.heroMeta}>
            <span>{client.mlNickname ? `@${client.mlNickname}` : 'Nickname ML não informado'}</span>
            <span>{client.mlId ? `ID ML ${client.mlId}` : 'ID ML não informado'}</span>
          </div>
        </div>
        <div className={styles.summaryBand} aria-label="Resumo do cliente">
          <div className={styles.summaryHighlight}>
            <span>Pedidos</span>
            <strong>{summary.orderCount.toLocaleString('pt-BR')}</strong>
            <small>vendas vinculadas</small>
          </div>
          <div>
            <span>Última compra</span>
            <strong>{formatDate(summary.lastOrderAt)}</strong>
            <small>{summary.lastOrderAt ? formatDateTime(summary.lastOrderAt).split(', ')[1] || 'horário registrado' : 'sem venda vinculada'}</small>
          </div>
          <div>
            <span>Cliente desde</span>
            <strong>{formatDate(client.createdAt)}</strong>
            <small>cadastro no Bentevi</small>
          </div>
        </div>
      </section>

      <section className={styles.infoGrid} aria-label="Cadastro do cliente">
        <article className={styles.infoCard}>
          <div className={styles.cardHeader}>
            <div>
              <Title level={4}>Identidade</Title>
              <Text>Dados oficiais do comprador</Text>
            </div>
            <span className={styles.sourceLabel}>Mercado Livre</span>
          </div>
          <dl className={styles.detailList}>
            <div><dt>Nome</dt><dd>{readValue(client.name)}</dd></div>
            <div><dt>Tipo</dt><dd>{personTypeLabel(client.personType)}</dd></div>
            <div><dt>Documento</dt><dd className={styles.mono}>{formatDocument(client.document)}</dd></div>
            <div><dt>ID Mercado Livre</dt><dd className={styles.mono}>{readValue(client.mlId)}</dd></div>
          </dl>
        </article>

        <article className={styles.infoCard}>
          <div className={styles.cardHeader}>
            <div>
              <Title level={4}>Contato</Title>
              <Text>Informações mantidas pela equipe</Text>
            </div>
            <span className={styles.sourceLabel}>Bentevi</span>
          </div>
          <div className={styles.contactList}>
            <div>
              <MailOutlined />
              <span><small>E-mail</small><strong>{readValue(client.email)}</strong></span>
            </div>
            <div>
              <PhoneOutlined />
              <span><small>Telefone</small><strong>{readValue(client.phone)}</strong></span>
            </div>
          </div>
          {canEditContact && <Button type="link" icon={<EditOutlined />} onClick={openContactEditor}>Editar contato</Button>}
        </article>

        <article className={styles.infoCard}>
          <div className={styles.cardHeader}>
            <div>
              <Title level={4}>Endereço</Title>
              <Text>Destino sincronizado mais recente</Text>
            </div>
            <span className={styles.sourceLabel}>Mercado Livre</span>
          </div>
          <p className={client.address ? styles.address : styles.muted}>{readValue(client.address)}</p>
          <small className={styles.updatedAt}>Cadastro atualizado em {formatDateTime(client.updatedAt)}</small>
        </article>
      </section>

      <section className={styles.historyCard}>
        <div className={styles.historyHeader}>
          <div>
            <Title level={4}>Histórico de vendas</Title>
            <Text>Compras deste cliente vinculadas pelo ID oficial do Mercado Livre.</Text>
          </div>
          <strong>{detail.total.toLocaleString('pt-BR')} {detail.total === 1 ? 'venda' : 'vendas'}</strong>
        </div>
        {hasFixtureOrders && (
          <Alert
            className={styles.fixtureAlert}
            type="info"
            showIcon
            message="Amostra protegida de homologação"
            description="Os detalhes podem ser consultados, mas o acompanhamento externo está desabilitado nestas vendas."
          />
        )}
        <Table<ClienteDetailOrder>
          className={styles.historyTable}
          rowKey="id"
          dataSource={orders}
          columns={columns}
          loading={loading}
          scroll={{ x: 1090 }}
          size="middle"
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Este cliente ainda não possui vendas vinculadas" /> }}
          pagination={{
            current: detail.page,
            pageSize: detail.pageSize,
            total: detail.total,
            showSizeChanger: false,
            hideOnSinglePage: true,
            showTotal: (value) => `${value.toLocaleString('pt-BR')} ${value === 1 ? 'venda' : 'vendas'}`,
            onChange: setPage,
          }}
        />
      </section>

      <Modal
        title="Editar contato"
        open={editorOpen}
        onCancel={closeContactEditor}
        onOk={() => form.submit()}
        okText="Salvar contato"
        cancelText="Cancelar"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Alert
          className={styles.contactAlert}
          type="info"
          showIcon
          message="Contato local do Bentevi"
          description="Nome, documento e endereço continuam sendo atualizados pelo Mercado Livre."
        />
        <Form<ClienteContactUpdate> form={form} layout="vertical" onFinish={saveContact} requiredMark={false}>
          <Form.Item
            name="email"
            label="E-mail"
            rules={[{ type: 'email', message: 'Informe um e-mail válido' }, { max: 254, message: 'O e-mail é muito longo' }]}
          >
            <Input allowClear prefix={<MailOutlined />} placeholder="email@exemplo.com" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="Telefone"
            rules={[
              { max: 32, message: 'O telefone é muito longo' },
              { pattern: /^[+\d\s().-]*$/, message: 'Use apenas números e caracteres de telefone' },
            ]}
          >
            <Input allowClear prefix={<PhoneOutlined />} placeholder="+55 (11) 99999-9999" />
          </Form.Item>
        </Form>
      </Modal>

      <TrackingModal
        open={Boolean(trackingOrder)}
        onClose={() => setTrackingOrder(null)}
        orderId={trackingOrder?.id || ''}
        orderStatus={trackingOrder?.status || 'aberto'}
      />
    </div>
  );
}
