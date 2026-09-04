"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
} from "antd";
import {
  BellOutlined,
  DeleteOutlined,
  EditOutlined,
  MailOutlined,
  MobileOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
  WhatsAppOutlined,
} from "@ant-design/icons";
import type { MessageInstance } from "antd/es/message/interface";
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_ROLE_LABELS,
  PUSH_NOTIFICATION_EVENTS,
  WHATSAPP_NOTIFICATION_EVENTS,
  maskWhatsappNumber,
  type NotificationUserRole,
  type PushNotificationEvent,
  type WhatsappNotificationEvent,
} from "@/lib/configuracoes/notifications";
import styles from "./NotificacoesTab.module.css";

type PushPolicy = {
  eventType: PushNotificationEvent;
  enabled: boolean;
  recipientRoles: NotificationUserRole[];
  userIds: string[];
};

type WhatsappRecipient = {
  id?: string;
  recipientName: string;
  phone: string;
  phoneMasked: string;
  enabled: boolean;
  eventTypes: WhatsappNotificationEvent[];
};

type NotificationDto = {
  pushPolicies: PushPolicy[];
  whatsappRecipients: WhatsappRecipient[];
  users: Array<{ id: string; name: string; role: NotificationUserRole }>;
  channels: {
    push: { configured: boolean; subscriptions: number; subscribedUsers: number };
    whatsapp: { configured: boolean; available: boolean; status: string; engine: string | null; testRecipientConfigured: boolean };
    email: { configured: boolean };
  };
};

type RecipientForm = Omit<WhatsappRecipient, "phoneMasked">;

const pushDescriptions: Record<PushNotificationEvent, string> = {
  new_sale: "Quando uma venda paga entra na operação.",
  new_question: "Quando há uma pergunta aguardando resposta.",
  claim_opened: "Quando uma reclamação é aberta no Mercado Livre.",
};

async function readResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.erro || "Não foi possível concluir a operação");
  return payload;
}

export default function NotificacoesTab({ messageApi }: { messageApi: MessageInstance }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [data, setData] = useState<NotificationDto | null>(null);
  const [pushPolicies, setPushPolicies] = useState<PushPolicy[]>([]);
  const [whatsappRecipients, setWhatsappRecipients] = useState<WhatsappRecipient[]>([]);
  const [browserSubscribed, setBrowserSubscribed] = useState(false);
  const [recipientModalOpen, setRecipientModalOpen] = useState(false);
  const [editingRecipientId, setEditingRecipientId] = useState<string | undefined>();
  const [recipientForm] = Form.useForm<RecipientForm>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dto = await readResponse(await fetch("/api/configuracoes/notificacoes", { cache: "no-store" })) as NotificationDto;
      setData(dto);
      setPushPolicies(dto.pushPolicies);
      setWhatsappRecipients(dto.whatsappRecipients);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Falha ao carregar notificações");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setBrowserSubscribed(Boolean(subscription)))
      .catch(() => setBrowserSubscribed(false));
  }, []);

  const roleOptions = useMemo(() => Object.entries(NOTIFICATION_ROLE_LABELS).map(([value, label]) => ({ value, label })), []);
  const userOptions = useMemo(() => (data?.users || []).map((user) => ({
    value: user.id,
    label: `${user.name} · ${NOTIFICATION_ROLE_LABELS[user.role]}`,
  })), [data?.users]);

  const updatePolicy = (eventType: PushNotificationEvent, patch: Partial<PushPolicy>) => {
    setPushPolicies((current) => current.map((policy) => policy.eventType === eventType ? { ...policy, ...patch } : policy));
  };

  const configureBrowser = async (enabled: boolean) => {
    if (!enabled) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await readResponse(await fetch("/api/push/subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }));
        await subscription.unsubscribe();
      }
      setBrowserSubscribed(false);
      messageApi.success("Notificações removidas deste navegador");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("Push não é suportado neste navegador");
    }
    const { publicKey } = await readResponse(await fetch("/api/push/public-key", { cache: "no-store" }));
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Permissão de notificações não concedida");
    const registration = await navigator.serviceWorker.register("/sw.js");
    const existing = await registration.pushManager.getSubscription();
    const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
    const raw = window.atob((publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"));
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(raw, (char) => char.charCodeAt(0)),
    });
    await readResponse(await fetch("/api/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    }));
    setBrowserSubscribed(true);
    messageApi.success("Notificações ativadas neste navegador");
  };

  const testChannel = async (channel: "push" | "whatsapp" | "email") => {
    setTesting(channel);
    try {
      await readResponse(await fetch("/api/configuracoes/notificacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      }));
      messageApi.success(channel === "email" ? "Conexão SMTP validada" : `Teste de ${channel === "push" ? "Push" : "WhatsApp"} concluído`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Falha ao testar canal");
    } finally {
      setTesting(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const dto = await readResponse(await fetch("/api/configuracoes/notificacoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pushPolicies,
          whatsappRecipients: whatsappRecipients.map((recipient) => ({
            id: recipient.id,
            recipientName: recipient.recipientName,
            phone: recipient.phone,
            enabled: recipient.enabled,
            eventTypes: recipient.eventTypes,
          })),
        }),
      })) as NotificationDto;
      setData(dto);
      setPushPolicies(dto.pushPolicies);
      setWhatsappRecipients(dto.whatsappRecipients);
      messageApi.success("Configuração de notificações salva");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Falha ao salvar notificações");
    } finally {
      setSaving(false);
    }
  };

  const openRecipient = (recipient?: WhatsappRecipient) => {
    setEditingRecipientId(recipient?.id);
    recipientForm.setFieldsValue(recipient ? {
      id: recipient.id,
      recipientName: recipient.recipientName,
      phone: recipient.phone,
      enabled: recipient.enabled,
      eventTypes: recipient.eventTypes,
    } : {
      recipientName: "",
      phone: "",
      enabled: true,
      eventTypes: ["new_sale", "new_question", "claim_opened"],
    });
    setRecipientModalOpen(true);
  };

  const saveRecipient = async () => {
    const values = await recipientForm.validateFields();
    const next = {
      ...values,
      id: editingRecipientId,
      phoneMasked: maskWhatsappNumber(values.phone),
    } as WhatsappRecipient;
    setWhatsappRecipients((current) => editingRecipientId
      ? current.map((recipient) => recipient.id === editingRecipientId ? next : recipient)
      : [...current, next]);
    setRecipientModalOpen(false);
  };

  const configuredTag = (configured: boolean, activeLabel = "Configurado") => (
    <Tag color={configured ? "green" : "default"}>{configured ? activeLabel : "Não configurado"}</Tag>
  );

  return (
    <Spin spinning={loading}>
      <div className={styles.page}>
        <div className={styles.heading}>
          <div>
            <h3>Notificações e canais</h3>
            <p>Defina quais alertas são enviados e quem deve recebê-los.</p>
          </div>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>Salvar alterações</Button>
        </div>

        <Alert type="info" showIcon message="Homologação protegida" description="Alertas automáticos de WhatsApp só podem alcançar o destinatário de teste configurado. Nenhum contato operacional recebe mensagens deste ambiente." />

        <div className={styles.channels}>
          <article className={styles.channel}>
            <div className={styles.channelHeader}><div className={styles.channelTitle}><BellOutlined /> Push no navegador</div>{configuredTag(Boolean(data?.channels.push.configured))}</div>
            <div className={styles.channelDescription}>Alertas internos para os dispositivos que cada usuário autorizou.</div>
            <div className={styles.channelMeta}><span>{data?.channels.push.subscriptions || 0} dispositivo(s)</span><span>{data?.channels.push.subscribedUsers || 0} usuário(s)</span></div>
            <div className={styles.channelActions}>
              <Button icon={<MobileOutlined />} disabled={!data?.channels.push.configured} onClick={() => void configureBrowser(!browserSubscribed).catch((error) => messageApi.error(error.message))}>{browserSubscribed ? "Desativar neste navegador" : "Ativar neste navegador"}</Button>
              <Button icon={<SendOutlined />} disabled={!browserSubscribed} loading={testing === "push"} onClick={() => void testChannel("push")}>Testar</Button>
            </div>
          </article>

          <article className={styles.channel}>
            <div className={styles.channelHeader}><div className={styles.channelTitle}><WhatsAppOutlined /> WhatsApp</div>{configuredTag(Boolean(data?.channels.whatsapp.available), data?.channels.whatsapp.status === "WORKING" ? "Conectado" : "Disponível")}</div>
            <div className={styles.channelDescription}>Alertas operacionais enviados pela sessão WAHA de teste deste ambiente.</div>
            <div className={styles.channelMeta}><span>Sessão: {data?.channels.whatsapp.status || "Indisponível"}</span>{data?.channels.whatsapp.engine && <span>Engine: {data.channels.whatsapp.engine}</span>}</div>
            <div className={styles.channelActions}><Button icon={<SendOutlined />} disabled={!data?.channels.whatsapp.available || !data?.channels.whatsapp.testRecipientConfigured} loading={testing === "whatsapp"} onClick={() => void testChannel("whatsapp")}>Enviar teste</Button></div>
          </article>

          <article className={styles.channel}>
            <div className={styles.channelHeader}><div className={styles.channelTitle}><MailOutlined /> E-mail</div>{configuredTag(Boolean(data?.channels.email.configured))}</div>
            <div className={styles.channelDescription}>Canal SMTP usado no envio explícito de documentos fiscais.</div>
            <div className={styles.channelMeta}><span>Nenhum envio automático por evento</span></div>
            <div className={styles.channelActions}><Button icon={<SendOutlined />} disabled={!data?.channels.email.configured} loading={testing === "email"} onClick={() => void testChannel("email")}>Testar conexão</Button></div>
          </article>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHeader}><div><h4>Alertas Push</h4><p>O usuário recebe o evento se pertencer a um cargo selecionado ou estiver escolhido individualmente.</p></div></div>
          <Table<PushPolicy> rowKey="eventType" pagination={false} dataSource={pushPolicies} scroll={{ x: 920 }} columns={[
            { title: "Evento", width: 250, render: (_, row) => <div className={styles.eventName}><strong>{NOTIFICATION_EVENT_LABELS[row.eventType]}</strong><small>{pushDescriptions[row.eventType]}</small></div> },
            { title: "Ativo", width: 90, render: (_, row) => <Switch checked={row.enabled} onChange={(enabled) => updatePolicy(row.eventType, { enabled })} /> },
            { title: "Cargos", width: 260, render: (_, row) => <Select mode="multiple" allowClear style={{ width: "100%" }} options={roleOptions} value={row.recipientRoles} onChange={(recipientRoles) => updatePolicy(row.eventType, { recipientRoles })} /> },
            { title: "Usuários específicos", render: (_, row) => <Select mode="multiple" allowClear showSearch optionFilterProp="label" style={{ width: "100%" }} placeholder="Nenhum usuário adicional" options={userOptions} value={row.userIds} onChange={(userIds) => updatePolicy(row.eventType, { userIds })} /> },
          ]} />
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}><div><h4>Destinatários WhatsApp</h4><p>Cada destinatário recebe somente os eventos selecionados.</p></div><Button icon={<PlusOutlined />} onClick={() => openRecipient()}>Adicionar destinatário</Button></div>
          <Table<WhatsappRecipient> rowKey={(row) => row.id || row.phone} pagination={false} dataSource={whatsappRecipients} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nenhum destinatário configurado" /> }} scroll={{ x: 900 }} columns={[
            { title: "Destinatário", width: 260, render: (_, row) => <div className={styles.eventName}><strong>{row.recipientName}</strong><small>{row.phoneMasked}</small></div> },
            { title: "Estado", width: 110, render: (_, row) => <Switch checked={row.enabled} checkedChildren="Ativo" unCheckedChildren="Inativo" onChange={(enabled) => setWhatsappRecipients((current) => current.map((item) => item === row ? { ...item, enabled } : item))} /> },
            { title: "Eventos", render: (_, row) => <div className={styles.eventsList}>{row.eventTypes.map((eventType) => <span key={eventType}>{NOTIFICATION_EVENT_LABELS[eventType]}</span>)}</div> },
            { title: "Ações", width: 120, render: (_, row) => <div className={styles.channelActions}><Button type="text" aria-label="Editar destinatário" icon={<EditOutlined />} onClick={() => openRecipient(row)} /><Button type="text" danger aria-label="Remover destinatário" icon={<DeleteOutlined />} onClick={() => setWhatsappRecipients((current) => current.filter((item) => item !== row))} /></div> },
          ]} />
        </section>
      </div>

      <Modal title={editingRecipientId ? "Editar destinatário" : "Novo destinatário"} open={recipientModalOpen} onCancel={() => setRecipientModalOpen(false)} onOk={() => void saveRecipient()} okText="Aplicar" cancelText="Cancelar" destroyOnHidden>
        <Form form={recipientForm} layout="vertical" requiredMark={false}>
          <Form.Item name="recipientName" label="Nome" rules={[{ required: true, message: "Informe o nome do destinatário" }]}><Input maxLength={120} placeholder="Ex.: Operação" /></Form.Item>
          <Form.Item name="phone" label="WhatsApp" rules={[{ required: true, message: "Informe o número" }]}><Input maxLength={32} placeholder="55 + DDD + número" /></Form.Item>
          <Form.Item name="eventTypes" label="Eventos" rules={[{ required: true, message: "Selecione ao menos um evento" }]}><Checkbox.Group options={WHATSAPP_NOTIFICATION_EVENTS.map((value) => ({ value, label: NOTIFICATION_EVENT_LABELS[value] }))} /></Form.Item>
          <Form.Item name="enabled" valuePropName="checked"><Switch checkedChildren="Ativo" unCheckedChildren="Inativo" /> <span className={styles.muted}>Receber alertas automáticos</span></Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}
