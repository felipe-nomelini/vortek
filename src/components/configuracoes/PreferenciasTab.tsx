"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Col, Row, Spin, Switch } from "antd";
import type { MessageInstance } from "antd/es/message/interface";

function vapidKeyToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export default function PreferenciasTab({
  messageApi,
}: {
  messageApi: MessageInstance;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notif, setNotif] = useState({ push: false });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/configuracoes");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          messageApi.error(data?.erro || "Falha ao carregar preferências");
          return;
        }
        setNotif({ push: Boolean(data?.notificacoes_push ?? false) });
      } catch {
        messageApi.error("Falha ao carregar preferências");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [messageApi]);

  const togglePush = async (enabled: boolean) => {
    if (!enabled) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setNotif({ push: false });
      return;
    }

    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      messageApi.error("Push não é suportado neste navegador.");
      return;
    }
    const keyResponse = await fetch("/api/push/public-key");
    const { publicKey } = await keyResponse.json().catch(() => ({}));
    if (!publicKey) {
      messageApi.error("Chave pública VAPID não configurada.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      messageApi.warning("Permissão de notificações não concedida.");
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToUint8Array(publicKey),
    });
    const response = await fetch("/api/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });
    if (!response.ok) throw new Error("Falha ao salvar inscrição push.");
    setNotif({ push: true });
  };

  const salvarPreferencias = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificacoes_push: notif.push,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao salvar preferências");
        return;
      }
      messageApi.success("Preferências salvas");
    } catch {
      messageApi.error("Falha ao salvar preferências");
    } finally {
      setSaving(false);
    }
  }, [
    messageApi,
    notif.push,
  ]);

  return (
    <Spin spinning={loading}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <div style={{ color: "#a0a0a0", fontSize: 13, marginBottom: 6 }}>
            Notificações Push
          </div>
          <Switch
            checked={notif.push}
            onChange={(enabled) =>
              void togglePush(enabled).catch((error) =>
                messageApi.error(
                  error instanceof Error
                    ? error.message
                    : "Falha ao configurar push.",
                ),
              )
            }
          />
          {notif.push && (
            <Button
              size="small"
              style={{ marginLeft: 12 }}
              onClick={() =>
                fetch("/api/push/test", { method: "POST" }).then((response) =>
                  response.ok
                    ? messageApi.success("Push de teste enviado.")
                    : messageApi.error("Falha no push de teste."),
                )
              }
            >
              Testar
            </Button>
          )}
        </Col>
        <Col span={24}>
          <Button
            type="primary"
            loading={saving}
            onClick={salvarPreferencias}
          >
            Salvar preferências
          </Button>
        </Col>
      </Row>
    </Spin>
  );
}
