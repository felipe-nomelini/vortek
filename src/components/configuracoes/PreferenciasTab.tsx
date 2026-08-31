"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Input, InputNumber, Row, Space, Spin, Switch, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";

const { Text } = Typography;

interface PricingTaxContext {
  appliedRate: number | null;
  estimatedRate: number | null;
  rbt12: number | null;
  bracket: number | null;
  warning: string | null;
}

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
  const [margem, setMargem] = useState(30);
  const [notif, setNotif] = useState({ push: false });
  const [defaultNfeProvider, setDefaultNfeProvider] =
    useState<"brasilnfe">("brasilnfe");
  const [simplesAliquotaConfirmada, setSimplesAliquotaConfirmada] = useState<
    number | null
  >(null);
  const [simplesAliquotaConfirmadaEm, setSimplesAliquotaConfirmadaEm] =
    useState("");
  const [pricingTaxContext, setPricingTaxContext] =
    useState<PricingTaxContext | null>(null);

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
        const provider = String(data?.nfe_provider_default || "").toLowerCase();
        setMargem(
          typeof data?.margem_lucro === "number" ? data.margem_lucro : 30,
        );
        setNotif({ push: Boolean(data?.notificacoes_push ?? false) });
        setSimplesAliquotaConfirmada(
          typeof data?.simples_aliquota_confirmada === "number"
            ? data.simples_aliquota_confirmada * 100
            : null,
        );
        setSimplesAliquotaConfirmadaEm(
          String(data?.simples_aliquota_confirmada_em || ""),
        );
        setPricingTaxContext(data?.pricing_tax_context || null);
        if (provider === "brasilnfe") setDefaultNfeProvider(provider);
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
          margem_lucro: margem,
          notificacoes_push: notif.push,
          nfe_provider_default: defaultNfeProvider,
          simples_aliquota_confirmada_percentual: simplesAliquotaConfirmada,
          simples_aliquota_confirmada_em: simplesAliquotaConfirmadaEm || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao salvar preferências");
        return;
      }
      setPricingTaxContext(data?.pricing_tax_context || null);
      messageApi.success("Preferências salvas");
    } catch {
      messageApi.error("Falha ao salvar preferências");
    } finally {
      setSaving(false);
    }
  }, [
    defaultNfeProvider,
    margem,
    messageApi,
    notif.push,
    simplesAliquotaConfirmada,
    simplesAliquotaConfirmadaEm,
  ]);

  return (
    <Spin spinning={loading}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <div style={{ color: "#a0a0a0", fontSize: 13, marginBottom: 6 }}>
            Margem de Lucro Padrão
          </div>
          <InputNumber
            suffix="%"
            value={margem}
            onChange={(value) => setMargem(value ?? 30)}
            style={{ ...configuracoesInputStyle, width: "100%" }}
            min={0}
            max={100}
          />
          <Text
            style={{
              color: "#666",
              fontSize: 12,
              display: "block",
              marginTop: 4,
            }}
          >
            Usada no cálculo do preço sugerido
          </Text>
        </Col>
        <Col span={24}>
          <Card
            size="small"
            title="Tributação da precificação"
            style={configuracoesCardStyle}
          >
            <Row gutter={[16, 12]}>
              <Col xs={24} md={8}>
                <Text
                  style={{
                    color: "#a0a0a0",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Início da atividade
                </Text>
                <Input value="23/03/2026" disabled />
              </Col>
              <Col xs={24} md={8}>
                <Text
                  style={{
                    color: "#a0a0a0",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Alíquota confirmada no PGDAS
                </Text>
                <InputNumber
                  suffix="%"
                  value={simplesAliquotaConfirmada}
                  onChange={setSimplesAliquotaConfirmada}
                  min={4}
                  max={99.9999}
                  precision={4}
                  style={{ ...configuracoesInputStyle, width: "100%" }}
                  placeholder="Opcional"
                />
              </Col>
              <Col xs={24} md={8}>
                <Text
                  style={{
                    color: "#a0a0a0",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Data da confirmação
                </Text>
                <Input
                  type="date"
                  value={simplesAliquotaConfirmadaEm}
                  onChange={(event) =>
                    setSimplesAliquotaConfirmadaEm(event.target.value)
                  }
                  style={configuracoesInputStyle}
                />
              </Col>
              <Col span={24}>
                <Space size="large" wrap>
                  <Text style={{ color: "#d9d9d9" }}>
                    RBT12 estimada:{" "}
                    {pricingTaxContext?.rbt12 == null
                      ? "indisponível"
                      : pricingTaxContext.rbt12.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                  </Text>
                  <Text style={{ color: "#d9d9d9" }}>
                    Faixa: {pricingTaxContext?.bracket ?? "manual"}
                  </Text>
                  <Text style={{ color: "#d9d9d9" }}>
                    Estimada:{" "}
                    {pricingTaxContext?.estimatedRate == null
                      ? "indisponível"
                      : `${(pricingTaxContext.estimatedRate * 100)
                          .toFixed(4)
                          .replace(".", ",")}%`}
                  </Text>
                  <Text strong style={{ color: "#faad14" }}>
                    Aplicada:{" "}
                    {pricingTaxContext?.appliedRate == null
                      ? "indisponível"
                      : `${(pricingTaxContext.appliedRate * 100)
                          .toFixed(4)
                          .replace(".", ",")}%`}
                  </Text>
                </Space>
                {pricingTaxContext?.warning && (
                  <Text
                    style={{
                      color: "#faad14",
                      display: "block",
                      marginTop: 8,
                    }}
                  >
                    {pricingTaxContext.warning}
                  </Text>
                )}
                <Text
                  style={{ color: "#666", display: "block", marginTop: 8 }}
                >
                  Esta estimativa protege a formação de preços; o PGDAS continua
                  sendo a fonte fiscal oficial.
                </Text>
              </Col>
            </Row>
          </Card>
        </Col>
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
