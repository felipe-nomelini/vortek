"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Drawer, Empty, Segmented, Spin, Tag } from "antd";
import type {
  NotificationAudience,
  NotificationChannel,
  NotificationTemplatePreview,
} from "@/lib/notifications/templates";
import styles from "./NotificacoesTab.module.css";

const channelLabels: Record<NotificationChannel, string> = {
  whatsapp: "WhatsApp",
  push: "Push",
  email: "E-mail",
};

const audienceLabels: Record<NotificationAudience, string> = {
  internal: "Equipe interna",
  supplier: "Fornecedor",
  customer: "Cliente",
};

async function loadTemplates(): Promise<NotificationTemplatePreview[]> {
  const response = await fetch("/api/configuracoes/notificacoes/modelos", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.erro || "Não foi possível carregar os modelos");
  return payload.templates || [];
}

function WhatsappText({ text }: { text: string }) {
  return <div className={styles.whatsappBubble}>
    {text.split("\n").map((line, lineIndex) => (
      <div key={`${lineIndex}-${line}`} className={line ? undefined : styles.blankLine}>
        {line.split(/(\*[^*\n]+\*)/g).filter(Boolean).map((part, partIndex) => (
          part.startsWith("*") && part.endsWith("*")
            ? <strong key={`${partIndex}-${part}`}>{part.slice(1, -1)}</strong>
            : <span key={`${partIndex}-${part}`}>{part}</span>
        ))}
      </div>
    ))}
    <span className={styles.messageTime}>15:30</span>
  </div>;
}

function TemplatePreview({ template }: { template: NotificationTemplatePreview }) {
  if (template.channel === "whatsapp") {
    return <div className={styles.whatsappCanvas}><WhatsappText text={template.preview.text || ""} /></div>;
  }
  if (template.channel === "push") {
    return <div className={styles.pushCanvas}>
      <div className={styles.pushNotification}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/branding/bentevi/icon-192.png" alt="" />
        <div><span>Bentevi · agora</span><strong>{template.preview.title}</strong><p>{template.preview.body}</p></div>
      </div>
    </div>;
  }
  return <iframe
    className={styles.emailPreview}
    title={`Prévia de ${template.label}`}
    sandbox=""
    srcDoc={template.preview.html || ""}
  />;
}

export default function NotificationTemplateGallery({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<NotificationTemplatePreview[]>([]);
  const [channel, setChannel] = useState<NotificationChannel>("whatsapp");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || templates.length) return;
    setLoading(true);
    setError(null);
    void loadTemplates()
      .then(setTemplates)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Falha ao carregar os modelos"))
      .finally(() => setLoading(false));
  }, [open, templates.length]);

  const visibleTemplates = useMemo(() => templates.filter((template) => template.channel === channel), [channel, templates]);
  const selected = visibleTemplates.find((template) => template.id === selectedId) || visibleTemplates[0] || null;

  return <Drawer
    title="Modelos de mensagens"
    open={open}
    onClose={onClose}
    width={1040}
    destroyOnHidden
  >
    <div className={styles.gallery}>
      <Alert
        type="info"
        showIcon
        message="Amostras de homologação"
        description="Os modelos usam dados sintéticos e não enviam mensagens ao serem visualizados."
      />
      <Segmented
        block
        value={channel}
        options={(Object.keys(channelLabels) as NotificationChannel[]).map((value) => ({ value, label: channelLabels[value] }))}
        onChange={(value) => { setChannel(value as NotificationChannel); setSelectedId(""); }}
      />
      <Spin spinning={loading}>
        {error ? <Alert type="error" showIcon message={error} /> : selected ? <div className={styles.galleryLayout}>
          <nav className={styles.templateList} aria-label="Modelos disponíveis">
            {visibleTemplates.map((template) => <button
              type="button"
              key={template.id}
              className={`${styles.templateOption} ${selected.id === template.id ? styles.templateOptionActive : ""}`}
              onClick={() => setSelectedId(template.id)}
            >
              <strong>{template.label}</strong>
              <span>{template.trigger}</span>
              <Tag bordered={false}>{audienceLabels[template.audience]}</Tag>
            </button>)}
          </nav>
          <section className={styles.templateStage}>
            <div className={styles.templateMeta}>
              <div><small>Modelo</small><strong>{selected.label}</strong></div>
              <div><small>Destinatário</small><strong>{audienceLabels[selected.audience]}</strong></div>
              <div><small>Disparo</small><strong>{selected.trigger}</strong></div>
            </div>
            <TemplatePreview template={selected} />
          </section>
        </div> : !loading && <Empty description="Nenhum modelo disponível" />}
      </Spin>
    </div>
  </Drawer>;
}
