"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Input, Modal, Row, Space, Spin, Tag, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";

const { Text } = Typography;

type SecretFieldName = "client_secret" | "access_token" | "refresh_token";

const secretStatusField: Record<SecretFieldName, string> = {
  client_secret: "client_secret_configurado",
  access_token: "access_token_configurado",
  refresh_token: "refresh_token_configurado",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function SecretCredentialField({
  placeholder,
  value,
  configured,
  saving,
  onChange,
  onSave,
  onRemove,
}: {
  placeholder: string;
  value: string;
  configured: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <Space.Compact style={{ width: "100%" }}>
        <Input
          placeholder={placeholder}
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={configuracoesInputStyle}
        />
        <Button
          size="small"
          onClick={onSave}
          loading={saving}
          disabled={!value.trim()}
        >
          Salvar
        </Button>
      </Space.Compact>
      <Space size={4} style={{ marginTop: 4 }}>
        <Tag color={configured ? "green" : "default"} style={{ margin: 0 }}>
          {configured ? "Configurado" : "Não configurado"}
        </Tag>
        {configured ? (
          <Button type="link" danger size="small" onClick={onRemove}>
            Remover
          </Button>
        ) : null}
      </Space>
    </div>
  );
}

function saveIntegrations(ml: boolean, dslite: boolean) {
  localStorage.setItem("vortek_integrations", JSON.stringify({ ml, dslite }));
}

export default function IntegracoesTab({
  messageApi,
}: {
  messageApi: MessageInstance;
}) {
  const [loading, setLoading] = useState(true);
  const [testingIntegration, setTestingIntegration] = useState<string | null>(null);
  const [savingSecret, setSavingSecret] = useState<string | null>(null);
  const [ml, setMl] = useState({
    clientId: "",
    clientSecret: "",
    clientSecretConfigured: false,
    conectado: false,
    lastError: "",
    lastErrorCode: "",
  });
  const [dslite, setDslite] = useState({
    url: "",
    token: "",
    tokenConfigured: false,
    conectado: false,
  });
  const [brasilNfe, setBrasilNfe] = useState({
    token: "",
    userToken: "",
    tokenConfigured: false,
    userTokenConfigured: false,
    url: "",
    conectado: false,
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/integracoes/config");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          messageApi.error(data?.erro || "Falha ao carregar integrações");
          return;
        }

        for (const integration of data.integracoes || []) {
          if (integration.tipo === "mercadolivre") {
            setMl({
              clientId: integration.client_id || "",
              clientSecret: "",
              clientSecretConfigured: Boolean(
                integration.client_secret_configurado,
              ),
              conectado: Boolean(integration.conectado),
              lastError: integration.last_refresh_error || "",
              lastErrorCode: integration.last_refresh_error_code || "",
            });
          }
          if (integration.tipo === "dslite") {
            setDslite({
              url: integration.url || "",
              token: "",
              tokenConfigured: Boolean(integration.access_token_configurado),
              conectado: Boolean(integration.conectado),
            });
          }
          if (integration.tipo === "brasilnfe") {
            setBrasilNfe({
              token: "",
              userToken: "",
              tokenConfigured: Boolean(integration.access_token_configurado),
              userTokenConfigured: Boolean(
                integration.refresh_token_configurado,
              ),
              url: integration.url || "",
              conectado: Boolean(integration.conectado),
            });
          }
        }
      } catch {
        messageApi.error("Falha ao carregar integrações");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [messageApi]);

  const saveIntegracao = useCallback(
    async (tipo: string, values: Record<string, unknown>) => {
      const response = await fetch("/api/integracoes/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, values }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.erro || "Falha ao salvar integração");
      }
      return (data.integracao || {}) as Record<string, unknown>;
    },
    [],
  );

  const saveCredential = useCallback(
    async (input: {
      tipo: string;
      field: SecretFieldName;
      value: string;
      label: string;
      onSaved: (configured: boolean) => void;
    }) => {
      const value = input.value.trim();
      if (!value) return;
      setSavingSecret(`${input.tipo}:${input.field}`);
      try {
        const integration = await saveIntegracao(input.tipo, {
          [input.field]: value,
        });
        input.onSaved(Boolean(integration[secretStatusField[input.field]]));
        messageApi.success(`${input.label} salva`);
      } catch (error) {
        messageApi.error(
          getErrorMessage(error, `Falha ao salvar ${input.label}`),
        );
      } finally {
        setSavingSecret(null);
      }
    },
    [messageApi, saveIntegracao],
  );

  const removeCredential = useCallback(
    (input: {
      tipo: string;
      field: SecretFieldName;
      label: string;
      onRemoved: () => void;
    }) => {
      Modal.confirm({
        title: `Remover ${input.label}?`,
        content: "A integração deixará de usar esta credencial.",
        okText: "Remover",
        okButtonProps: { danger: true },
        cancelText: "Cancelar",
        async onOk() {
          try {
            await saveIntegracao(input.tipo, { [input.field]: null });
            input.onRemoved();
            messageApi.success(`${input.label} removida`);
          } catch (error) {
            messageApi.error(
              getErrorMessage(error, `Falha ao remover ${input.label}`),
            );
            throw error;
          }
        },
      });
    },
    [messageApi, saveIntegracao],
  );

  useEffect(() => {
    saveIntegrations(ml.conectado, dslite.conectado);
  }, [ml.conectado, dslite.conectado]);

  const conectarML = async () => {
    if (!ml.clientId || !ml.clientSecretConfigured) {
      messageApi.warning("Configure e salve o Client ID e o Client Secret");
      return;
    }
    try {
      await saveIntegracao("mercadolivre", { client_id: ml.clientId });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/api/integracao/ml/connect";
    } catch (error) {
      messageApi.error(
        getErrorMessage(
          error,
          "Falha ao salvar credenciais do Mercado Livre",
        ),
      );
    }
  };

  const testarDslite = async () => {
    if (!dslite.url || !dslite.tokenConfigured) {
      messageApi.warning("Configure e salve a URL e o Token");
      return;
    }
    setTestingIntegration("dslite");
    try {
      await saveIntegracao("dslite", { url: dslite.url });
      const response = await fetch("/api/integracoes/teste/dslite", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      const conectado = Boolean(response.ok && data?.ok);
      setDslite((current) => ({ ...current, conectado }));
      await saveIntegracao("dslite", { conectado });
      if (!conectado) {
        messageApi.error(data?.erro || "Falha ao validar DSLite");
        return;
      }
      messageApi.success(data?.message || "Conexão DSLite validada!");
    } catch (error) {
      setDslite((current) => ({ ...current, conectado: false }));
      messageApi.error(getErrorMessage(error, "Falha ao validar DSLite"));
    } finally {
      setTestingIntegration(null);
    }
  };

  const testarBrasilNfe = async () => {
    if (!brasilNfe.tokenConfigured) {
      messageApi.warning("Configure e salve o Token da Brasil NFe");
      return;
    }
    setTestingIntegration("brasilnfe");
    try {
      await saveIntegracao("brasilnfe", { url: brasilNfe.url || null });
      const response = await fetch("/api/integracoes/teste/brasilnfe", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      const conectado = Boolean(response.ok && data?.ok);
      setBrasilNfe((current) => ({ ...current, conectado }));
      await saveIntegracao("brasilnfe", { conectado });
      if (!conectado) {
        messageApi.error(data?.erro || "Falha ao validar Brasil NFe");
        return;
      }
      messageApi.success(data?.message || "Conexão Brasil NFe validada!");
    } catch (error) {
      setBrasilNfe((current) => ({ ...current, conectado: false }));
      messageApi.error(getErrorMessage(error, "Falha ao validar Brasil NFe"));
    } finally {
      setTestingIntegration(null);
    }
  };

  const integrations = [
    {
      key: "ml",
      nome: "Mercado Livre",
      conectado: ml.conectado,
      cor: "#1677ff",
      fields: (
        <>
          <Input
            placeholder="Client ID (App ID)"
            value={ml.clientId}
            onChange={(event) =>
              setMl((current) => ({ ...current, clientId: event.target.value }))
            }
            onBlur={() =>
              saveIntegracao("mercadolivre", { client_id: ml.clientId })
            }
            style={configuracoesInputStyle}
          />
          <SecretCredentialField
            placeholder="Client Secret"
            value={ml.clientSecret}
            configured={ml.clientSecretConfigured}
            saving={savingSecret === "mercadolivre:client_secret"}
            onChange={(value) =>
              setMl((current) => ({ ...current, clientSecret: value }))
            }
            onSave={() =>
              saveCredential({
                tipo: "mercadolivre",
                field: "client_secret",
                value: ml.clientSecret,
                label: "Client Secret",
                onSaved: (configured) =>
                  setMl((current) => ({
                    ...current,
                    clientSecret: configured ? "" : current.clientSecret,
                    clientSecretConfigured: configured,
                  })),
              })
            }
            onRemove={() =>
              removeCredential({
                tipo: "mercadolivre",
                field: "client_secret",
                label: "Client Secret",
                onRemoved: () =>
                  setMl((current) => ({
                    ...current,
                    clientSecret: "",
                    clientSecretConfigured: false,
                  })),
              })
            }
          />
          {ml.lastError ? (
            <Text type="danger" style={{ fontSize: 12 }}>
              {ml.lastErrorCode === "ml_account_not_allowed"
                ? ml.lastError
                : `Último erro ML: ${ml.lastErrorCode || ml.lastError}`}
            </Text>
          ) : null}
        </>
      ),
      action: { label: "Conectar com ML", onClick: conectarML },
    },
    {
      key: "dslite",
      nome: "DSLite",
      conectado: dslite.conectado,
      cor: "#fa8c16",
      fields: (
        <>
          <Input
            placeholder="URL da API"
            value={dslite.url}
            onChange={(event) =>
              setDslite((current) => ({ ...current, url: event.target.value }))
            }
            onBlur={() => saveIntegracao("dslite", { url: dslite.url })}
            style={configuracoesInputStyle}
          />
          <SecretCredentialField
            placeholder="Token de Acesso"
            value={dslite.token}
            configured={dslite.tokenConfigured}
            saving={savingSecret === "dslite:access_token"}
            onChange={(value) =>
              setDslite((current) => ({ ...current, token: value }))
            }
            onSave={() =>
              saveCredential({
                tipo: "dslite",
                field: "access_token",
                value: dslite.token,
                label: "Token da DSLite",
                onSaved: (configured) =>
                  setDslite((current) => ({
                    ...current,
                    token: configured ? "" : current.token,
                    tokenConfigured: configured,
                  })),
              })
            }
            onRemove={() =>
              removeCredential({
                tipo: "dslite",
                field: "access_token",
                label: "Token da DSLite",
                onRemoved: () =>
                  setDslite((current) => ({
                    ...current,
                    token: "",
                    tokenConfigured: false,
                  })),
              })
            }
          />
        </>
      ),
      action: { label: "Testar Conexão", onClick: testarDslite },
    },
    {
      key: "brasilnfe",
      nome: "Brasil NFe",
      conectado: brasilNfe.conectado,
      cor: "#13c2c2",
      fields: (
        <>
          <SecretCredentialField
            placeholder="Token da Empresa"
            value={brasilNfe.token}
            configured={brasilNfe.tokenConfigured}
            saving={savingSecret === "brasilnfe:access_token"}
            onChange={(value) =>
              setBrasilNfe((current) => ({ ...current, token: value }))
            }
            onSave={() =>
              saveCredential({
                tipo: "brasilnfe",
                field: "access_token",
                value: brasilNfe.token,
                label: "Token da Brasil NFe",
                onSaved: (configured) =>
                  setBrasilNfe((current) => ({
                    ...current,
                    token: configured ? "" : current.token,
                    tokenConfigured: configured,
                  })),
              })
            }
            onRemove={() =>
              removeCredential({
                tipo: "brasilnfe",
                field: "access_token",
                label: "Token da Brasil NFe",
                onRemoved: () =>
                  setBrasilNfe((current) => ({
                    ...current,
                    token: "",
                    tokenConfigured: false,
                  })),
              })
            }
          />
          <SecretCredentialField
            placeholder="User Token (opcional)"
            value={brasilNfe.userToken}
            configured={brasilNfe.userTokenConfigured}
            saving={savingSecret === "brasilnfe:refresh_token"}
            onChange={(value) =>
              setBrasilNfe((current) => ({ ...current, userToken: value }))
            }
            onSave={() =>
              saveCredential({
                tipo: "brasilnfe",
                field: "refresh_token",
                value: brasilNfe.userToken,
                label: "User Token da Brasil NFe",
                onSaved: (configured) =>
                  setBrasilNfe((current) => ({
                    ...current,
                    userToken: configured ? "" : current.userToken,
                    userTokenConfigured: configured,
                  })),
              })
            }
            onRemove={() =>
              removeCredential({
                tipo: "brasilnfe",
                field: "refresh_token",
                label: "User Token da Brasil NFe",
                onRemoved: () =>
                  setBrasilNfe((current) => ({
                    ...current,
                    userToken: "",
                    userTokenConfigured: false,
                  })),
              })
            }
          />
          <Input
            placeholder="URL Base (opcional)"
            value={brasilNfe.url}
            onChange={(event) =>
              setBrasilNfe((current) => ({
                ...current,
                url: event.target.value,
              }))
            }
            onBlur={() =>
              saveIntegracao("brasilnfe", { url: brasilNfe.url })
            }
            style={configuracoesInputStyle}
          />
        </>
      ),
      action: { label: "Testar conexão", onClick: testarBrasilNfe },
    },
  ];

  return (
    <Spin spinning={loading}>
      <Row gutter={[16, 16]}>
        {integrations.map((integration) => (
          <Col xs={24} lg={8} key={integration.key}>
            <Card
              styles={{ body: { padding: 16 } }}
              style={{
                ...configuracoesCardStyle,
                height: "100%",
                borderColor: integration.conectado
                  ? integration.cor
                  : "#303030",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      background: integration.conectado
                        ? integration.cor
                        : "#555",
                    }}
                  />
                  <Text
                    style={{
                      color: "#e0e0e0",
                      fontWeight: 600,
                      fontSize: 15,
                    }}
                  >
                    {integration.nome}
                  </Text>
                </div>
                <Tag
                  color={integration.conectado ? "green" : "default"}
                  style={{ margin: 0 }}
                >
                  {integration.conectado ? "Conectado" : "Desconectado"}
                </Tag>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                {integration.fields}
              </div>
              <Button
                size="small"
                type="primary"
                onClick={integration.action.onClick}
                loading={testingIntegration === integration.key}
                style={{ width: "100%" }}
              >
                {integration.action.label}
              </Button>
            </Card>
          </Col>
        ))}
      </Row>
    </Spin>
  );
}
