'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DollarOutlined,
  EditOutlined,
  EnvironmentOutlined,
  LoadingOutlined,
  MailOutlined,
  PhoneOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { hasPermission, type VortekRole } from '@/lib/permissions';
import type {
  FornecedorDetailItem,
  FornecedorDetailResponse,
  FornecedorLocalUpdate,
  FornecedorLocalUpdateResponse,
} from '@/types/fornecedores';
import styles from './fornecedor-detalhe.module.css';

const { Text, Title } = Typography;
const VALID_ROLES: VortekRole[] = ['admin', 'gerente', 'operador', 'visualizador'];

type ContactForm = Pick<FornecedorLocalUpdate, 'email' | 'phone' | 'address'>;
type PaymentForm = Pick<FornecedorLocalUpdate, 'pixKey'>;

function readValue(value: string | null | undefined): string {
  return String(value || '').trim() || 'Não informado';
}

function formatDocument(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return readValue(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Não informado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function isActiveDsliteValue(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return ['ativo', 'sim', 'true', '1', 'yes'].includes(normalized);
}

function modalityLine(label: string, value: string) {
  const active = isActiveDsliteValue(value);
  return (
    <div className={styles.modalityLine}>
      {active ? <CheckCircleFilled className={styles.positiveIcon} /> : <CloseCircleFilled className={styles.mutedIcon} />}
      <span><strong>{label}</strong><small>{readValue(value)}</small></span>
    </div>
  );
}

function supplierName(supplier: FornecedorDetailItem): string {
  return readValue(supplier.nickname || supplier.legalName || supplier.dsliteId);
}

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || '');
  const [contactForm] = Form.useForm<ContactForm>();
  const [paymentForm] = Form.useForm<PaymentForm>();
  const [detail, setDetail] = useState<FornecedorDetailResponse | null>(null);
  const [role, setRole] = useState<VortekRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [paymentEditorOpen, setPaymentEditorOpen] = useState(false);
  const [messageApi, messageContextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const supplier = detail?.data.supplier || null;
  const summary = detail?.data.summary || null;
  const canManage = Boolean(role && hasPermission(role, 'suppliers.manage'));

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/fornecedores/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as Partial<FornecedorDetailResponse> & { error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || 'Não foi possível carregar o fornecedor');
      setDetail(payload as FornecedorDetailResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o fornecedor');
    } finally {
      setLoading(false);
    }
  }, [id]);

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

  const patchLocalData = async (update: FornecedorLocalUpdate) => {
    if (!supplier || !canManage) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/fornecedores/${encodeURIComponent(supplier.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const payload = await response.json().catch(() => ({})) as Partial<FornecedorLocalUpdateResponse> & { error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || 'Não foi possível atualizar os dados locais');
      setDetail((current) => current ? {
        ...current,
        data: {
          ...current.data,
          supplier: {
            ...current.data.supplier,
            email: payload.data?.email ?? current.data.supplier.email,
            phone: payload.data?.phone ?? current.data.supplier.phone,
            address: payload.data?.address ?? current.data.supplier.address,
            pixKey: payload.data?.pixKey ?? current.data.supplier.pixKey,
            updatedAt: payload.data?.updatedAt ?? current.data.supplier.updatedAt,
          },
        },
      } : current);
      setContactEditorOpen(false);
      setPaymentEditorOpen(false);
      messageApi.success('Dados locais atualizados');
    } catch (saveError) {
      messageApi.error(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar os dados locais');
    } finally {
      setSaving(false);
    }
  };

  const openContactEditor = () => {
    if (!supplier || !canManage) return;
    contactForm.setFieldsValue({ email: supplier.email, phone: supplier.phone, address: supplier.address });
    setContactEditorOpen(true);
  };

  const openPaymentEditor = () => {
    if (!supplier || !canManage) return;
    paymentForm.setFieldsValue({ pixKey: supplier.pixKey });
    setPaymentEditorOpen(true);
  };

  const executeStatusChange = useCallback(async (active: boolean) => {
    if (!supplier || !canManage) return;
    setStatusChanging(true);
    try {
      const response = await fetch(`/api/fornecedores/${encodeURIComponent(supplier.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: active }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) {
        throw new Error(payload?.error || 'Não foi possível alterar o fornecedor');
      }
      if (response.status === 207 || payload?.success === false) {
        messageApi.warning('O estado foi alterado, mas parte das atualizações vinculadas exige revisão.');
      } else {
        messageApi.success(`${supplierName(supplier)} foi ${active ? 'ativado' : 'inativado'}.`);
      }
      await fetchDetail();
    } catch (statusError) {
      messageApi.error(statusError instanceof Error ? statusError.message : 'Não foi possível alterar o fornecedor');
    } finally {
      setStatusChanging(false);
    }
  }, [canManage, fetchDetail, messageApi, supplier]);

  const confirmStatusChange = useCallback(async () => {
    if (!supplier || !canManage) return;
    const activating = !supplier.active;
    if (activating) {
      const confirmed = await modal.confirm({
        title: `Ativar ${supplierName(supplier)}?`,
        content: 'Os produtos vinculados continuarão inativos até uma ativação manual.',
        okText: 'Ativar fornecedor',
        cancelText: 'Cancelar',
      });
      if (confirmed) await executeStatusChange(true);
      return;
    }

    setStatusChanging(true);
    try {
      const response = await fetch(`/api/fornecedores/${encodeURIComponent(supplier.id)}/status`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível calcular o impacto');
      const impact = payload?.impact || {};
      const confirmed = await modal.confirm({
        title: `Inativar ${supplierName(supplier)}?`,
        content: (
          <div className={styles.impactSummary}>
            <p>A operação afeta o catálogo vinculado e não serve apenas para ocultar o cadastro.</p>
            <dl>
              <div><dt>Produtos ativos</dt><dd>{Number(impact.products_active || 0)}</dd></div>
              <div><dt>Ofertas ativas</dt><dd>{Number(impact.supplier_offers_active || 0)}</dd></div>
              <div><dt>Mantidos pelo estoque interno</dt><dd>{Number(impact.products_kept_only_by_internal_stock || 0)}</dd></div>
              <div><dt>Sem fonte disponível</dt><dd>{Number(impact.products_without_available_source || 0)}</dd></div>
              <div><dt>Anúncios a excluir</dt><dd>{Number(impact.ml_delete_candidates || 0)}</dd></div>
            </dl>
            <strong>Anúncios sem fornecedor alternativo nem estoque interno serão excluídos do Mercado Livre.</strong>
          </div>
        ),
        okText: 'Inativar fornecedor',
        okButtonProps: { danger: true },
        cancelText: 'Cancelar',
      });
      setStatusChanging(false);
      if (confirmed) await executeStatusChange(false);
    } catch (statusError) {
      setStatusChanging(false);
      messageApi.error(statusError instanceof Error ? statusError.message : 'Não foi possível calcular o impacto');
    }
  }, [canManage, executeStatusChange, messageApi, modal, supplier]);

  const alerts = useMemo(() => {
    if (!supplier) return [];
    const values: Array<{ key: string; type: 'info' | 'warning'; title: string; description: string }> = [];
    if (supplier.activationBlocked) {
      values.push({ key: 'blocked', type: 'info', title: 'Fornecedor mantido apenas como histórico', description: 'A política operacional impede a reativação deste fornecedor para dropshipping.' });
    } else if (!supplier.active) {
      values.push({ key: 'inactive', type: 'warning', title: 'Fornecedor inativo no Bentevi', description: 'O cadastro permanece disponível para consulta, mas não participa da operação atual.' });
    }
    if (supplier.syncHealth !== 'healthy') {
      values.push({ key: 'sync', type: 'warning', title: 'Sincronização DSLite requer atenção', description: `Último registro: ${formatDateTime(supplier.lastSyncAt)}. Atualize o diretório de fornecedores para reconciliar os dados externos.` });
    }
    if (supplier.active && !supplier.phone.trim()) {
      values.push({ key: 'phone', type: 'warning', title: 'WhatsApp operacional não cadastrado', description: 'O envio automático de comprovante ao fornecedor depende de um telefone válido.' });
    }
    if (supplier.active && !supplier.pixKey.trim()) {
      values.push({ key: 'pix', type: 'warning', title: 'Chave PIX não cadastrada', description: 'Compras com pagamento antecipado precisam desta informação para orientar a operação.' });
    }
    return values;
  }, [supplier]);

  if (loading) {
    return <div className={styles.centerState}><Spin indicator={<LoadingOutlined spin className={styles.loadingIcon} />} /><Text type="secondary">Carregando fornecedor...</Text></div>;
  }

  if (error || !supplier || !summary) {
    return (
      <div className={styles.centerState}>
        <Title level={4}>{error || 'Fornecedor não encontrado'}</Title>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/fornecedores')}>Voltar</Button>
          <Button type="primary" icon={<ReloadOutlined />} onClick={() => void fetchDetail()}>Tentar novamente</Button>
        </Space>
      </div>
    );
  }

  const offersHref = supplier.dsliteId ? `/produtos/ofertas?fornecedores=${encodeURIComponent(supplier.dsliteId)}&view=all` : '/produtos/ofertas';
  const purchasesHref = supplier.dsliteId ? `/compras?fornecedorId=${encodeURIComponent(supplier.dsliteId)}` : '/compras';

  return (
    <div className={styles.page}>
      {messageContextHolder}
      {modalContextHolder}
      <header className={styles.stickyHeader}>
        <div className={styles.headerIdentity}>
          <Button type="text" aria-label="Voltar para fornecedores" icon={<ArrowLeftOutlined />} onClick={() => router.push('/fornecedores')} />
          <div><span>Fornecedor · DSLite #{supplier.dsliteId || 'sem ID'}</span><Title level={3}>{supplierName(supplier)}</Title></div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchDetail()}>Atualizar</Button>
          {canManage && (
            <Tooltip title={!supplier.active && supplier.activationBlocked ? 'A reativação está bloqueada pela política operacional' : undefined}>
              <span>
                <Button danger={supplier.active} type={supplier.active ? 'default' : 'primary'} loading={statusChanging} disabled={!supplier.active && supplier.activationBlocked} onClick={() => void confirmStatusChange()}>
                  {supplier.active ? 'Inativar fornecedor' : 'Ativar fornecedor'}
                </Button>
              </span>
            </Tooltip>
          )}
        </Space>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroIdentity}>
          <span className={styles.sourceLabel}>Cadastro sincronizado · DSLite</span>
          <Title level={2}>{supplierName(supplier)}</Title>
          <p>{readValue(supplier.legalName)}</p>
          <div className={styles.heroMeta}><span>{formatDocument(supplier.document)}</span><span>Atualizado em {formatDateTime(supplier.lastSyncAt)}</span></div>
          <Tag color={supplier.active ? 'green' : 'default'}>{supplier.active ? 'Operacional' : 'Inativo'}</Tag>
        </div>
        <div className={styles.summaryBand}>
          <Link href={purchasesHref}><span>Compras vinculadas</span><strong>{summary.purchaseCount.toLocaleString('pt-BR')}</strong><small>Abrir histórico filtrado</small></Link>
          <Link href={offersHref}><span>Ofertas cadastradas</span><strong>{summary.offerCount.toLocaleString('pt-BR')}</strong><small>Ver todas as ofertas</small></Link>
          <Link href={offersHref} className={styles.summaryHighlight}><span>Ofertas operacionais</span><strong>{summary.activeOfferCount.toLocaleString('pt-BR')}</strong><small>Disponíveis no Bentevi</small></Link>
        </div>
      </section>

      {alerts.map((alert) => <Alert key={alert.key} showIcon type={alert.type} message={alert.title} description={alert.description} />)}

      <section className={styles.infoGrid}>
        <article className={styles.infoCard}>
          <div className={styles.cardHeader}><div><Title level={4}>Operação</Title><Text>Disponibilidade dentro do Bentevi.</Text></div><span className={styles.sourceLabel}>Bentevi + DSLite</span></div>
          <dl className={styles.detailList}>
            <div><dt>Status Bentevi</dt><dd><Tag color={supplier.active ? 'green' : 'default'}>{supplier.active ? 'Operacional' : 'Inativo'}</Tag></dd></div>
            <div><dt>Status DSLite</dt><dd><Tag color={isActiveDsliteValue(supplier.dsliteStatus) ? 'green' : 'default'}>{readValue(supplier.dsliteStatus)}</Tag></dd></div>
          </dl>
          <div className={styles.modalityList}>{modalityLine('Cross-docking', supplier.crossdocking)}{modalityLine('Dropshipping', supplier.dropshipping)}</div>
          <Text className={styles.sourceNote}>As modalidades são recebidas da DSLite e não podem ser editadas aqui.</Text>
        </article>

        <article className={styles.infoCard}>
          <div className={styles.cardHeader}><div><Title level={4}>Cadastro DSLite</Title><Text>Identidade oficial recebida da integração.</Text></div><span className={styles.sourceLabel}>Somente leitura</span></div>
          <dl className={styles.detailList}>
            <div><dt>Nome simples</dt><dd>{readValue(supplier.nickname)}</dd></div>
            <div><dt>ID DSLite</dt><dd className={styles.mono}>{readValue(supplier.dsliteId)}</dd></div>
            <div className={styles.wideDetail}><dt>Razão social</dt><dd>{readValue(supplier.legalName)}</dd></div>
            <div className={styles.wideDetail}><dt>CNPJ / documento</dt><dd className={styles.mono}>{formatDocument(supplier.document)}</dd></div>
          </dl>
        </article>

        <article className={styles.infoCard}>
          <div className={styles.cardHeader}><div><Title level={4}>Contato operacional</Title><Text>Dados usados pela equipe e nos fluxos de compra.</Text></div><span className={styles.sourceLabel}>Local · complementar</span></div>
          <div className={styles.contactList}>
            <div><PhoneOutlined /><span><small>Telefone / WhatsApp</small><strong>{readValue(supplier.phone)}</strong></span></div>
            <div><MailOutlined /><span><small>E-mail</small><strong>{readValue(supplier.email)}</strong></span></div>
            <div><EnvironmentOutlined /><span><small>Endereço</small><strong>{readValue(supplier.address)}</strong></span></div>
          </div>
          <Text className={styles.sourceNote}>A DSLite pode completar estes campos quando fornecer um valor; o cadastro local é preservado quando a origem vier vazia.</Text>
          {canManage && <Button type="link" icon={<EditOutlined />} onClick={openContactEditor}>Editar contato</Button>}
        </article>

        <article className={styles.infoCard}>
          <div className={styles.cardHeader}><div><Title level={4}>Pagamento local</Title><Text>Informação operacional mantida no Bentevi.</Text></div><span className={styles.sourceLabel}>Bentevi</span></div>
          <div className={styles.paymentKey}><DollarOutlined /><span><small>Chave PIX</small><strong>{readValue(supplier.pixKey)}</strong></span></div>
          <Text className={styles.sourceNote}>A modalidade de pagamento é definida em cada oferta ou compra; não existe um modo único no cadastro do fornecedor.</Text>
          {canManage && <Button type="link" icon={<EditOutlined />} onClick={openPaymentEditor}>Editar chave PIX</Button>}
        </article>

        <article className={`${styles.infoCard} ${styles.auditCard}`}>
          <div className={styles.cardHeader}><div><Title level={4}>Auditoria</Title><Text>Datas do cadastro local e da fonte externa.</Text></div><span className={styles.sourceLabel}>Rastreabilidade</span></div>
          <dl className={styles.auditList}>
            <div><dt>Criado no Bentevi</dt><dd>{formatDateTime(supplier.createdAt)}</dd></div>
            <div><dt>Última alteração local</dt><dd>{formatDateTime(supplier.updatedAt)}</dd></div>
            <div><dt>Última sincronização DSLite</dt><dd>{formatDateTime(supplier.lastSyncAt)}</dd></div>
            <div><dt>Saúde da sincronização</dt><dd>{supplier.syncHealth === 'healthy' ? 'Dentro da frequência prevista' : 'Requer atenção'}</dd></div>
          </dl>
        </article>
      </section>

      <Modal title="Editar contato operacional" open={contactEditorOpen} okText="Salvar contato" cancelText="Cancelar" confirmLoading={saving} onCancel={() => { setContactEditorOpen(false); contactForm.resetFields(); }} onOk={() => contactForm.submit()} destroyOnHidden>
        <Alert type="info" showIcon message="Dados locais complementares" description="A sincronização preserva estes valores enquanto a DSLite não enviar substitutos preenchidos." className={styles.modalAlert} />
        <Form<ContactForm> form={contactForm} layout="vertical" onFinish={(values) => void patchLocalData(values)}>
          <Form.Item name="email" label="E-mail" rules={[{ type: 'email', message: 'Informe um e-mail válido' }]}><Input placeholder="compras@fornecedor.com.br" maxLength={254} /></Form.Item>
          <Form.Item name="phone" label="Telefone / WhatsApp" rules={[{ pattern: /^[+\d\s().-]*$/, message: 'Informe um telefone válido' }]}><Input placeholder="(11) 99999-9999" maxLength={32} /></Form.Item>
          <Form.Item name="address" label="Endereço"><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Editar chave PIX" open={paymentEditorOpen} okText="Salvar chave" cancelText="Cancelar" confirmLoading={saving} onCancel={() => { setPaymentEditorOpen(false); paymentForm.resetFields(); }} onOk={() => paymentForm.submit()} destroyOnHidden>
        <Form<PaymentForm> form={paymentForm} layout="vertical" onFinish={(values) => void patchLocalData(values)}>
          <Form.Item name="pixKey" label="Chave PIX" extra="CPF, CNPJ, telefone, e-mail ou chave aleatória."><Input placeholder="Informe a chave PIX" maxLength={180} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
