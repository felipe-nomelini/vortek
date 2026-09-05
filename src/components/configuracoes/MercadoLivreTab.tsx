"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { CheckCircleOutlined, CopyOutlined, DisconnectOutlined, LinkOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import type { MessageInstance } from "antd/es/message/interface";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";

import ConfiguracoesTabHeading from "./ConfiguracoesTabHeading";

const { Text, Paragraph } = Typography;

type MlConfiguration = {
  application: {
    clientId: string;
    clientSecretConfigured: boolean;
    accessTokenConfigured: boolean;
    refreshTokenConfigured: boolean;
    redirectUri: string | null;
    connected: boolean;
    authState: "ok" | "degraded" | "reauth_required";
    needsReconnect: boolean;
    tokenExpiresAt: string | null;
    lastRefreshAt: string | null;
    lastError: string | null;
  };
  seller: { id: string; nickname: string | null; siteId: string | null } | null;
  app: {
    active: boolean | null;
    certificationStatus: string | null;
    scopes: string[];
    mixedMercadoPagoScopes: boolean;
    diagnosticsError: string | null;
  };
  warranty: {
    typeId: "2230279" | "2230280";
    typeLabel: string;
    duration: number;
    unit: "dias" | "meses" | "anos";
  };
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function MercadoLivreTab({ messageApi }: { messageApi: MessageInstance }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<MlConfiguration | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [warrantyTypeId, setWarrantyTypeId] = useState<"2230279" | "2230280">("2230279");
  const [warrantyDuration, setWarrantyDuration] = useState(12);
  const [warrantyUnit, setWarrantyUnit] = useState<"dias" | "meses" | "anos">("meses");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/configuracoes/mercado-livre", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.erro || "Falha ao carregar Mercado Livre");
      setData(payload);
      setClientId(payload.application.clientId || "");
      setClientSecret("");
      setWarrantyTypeId(payload.warranty.typeId);
      setWarrantyDuration(payload.warranty.duration);
      setWarrantyUnit(payload.warranty.unit);
    } catch (error) {
      messageApi.error(errorMessage(error, "Falha ao carregar Mercado Livre"));
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { void load(); }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/configuracoes/mercado-livre", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.erro || "Falha ao salvar configuração");
  };

  const saveApplication = () => {
    if (!clientId.trim()) {
      messageApi.warning("Informe o Client ID do aplicativo Mercado Livre");
      return;
    }
    Modal.confirm({
      title: "Atualizar aplicativo Mercado Livre?",
      content: "A alteração será auditada. Credenciais só podem mudar enquanto a conta estiver desconectada.",
      okText: "Atualizar",
      cancelText: "Cancelar",
      async onOk() {
        setSaving(true);
        try {
          await patch({ section: "application", clientId: clientId.trim(), ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) });
          messageApi.success("Aplicativo Mercado Livre atualizado");
          await load();
        } catch (error) {
          messageApi.error(errorMessage(error, "Falha ao atualizar aplicativo"));
          throw error;
        } finally { setSaving(false); }
      },
    });
  };

  const saveWarranty = () => {
    Modal.confirm({
      title: "Atualizar garantia padrão?",
      content: "A regra será usada apenas em novas publicações e somente quando a categoria aceitar estes termos. Anúncios existentes não serão alterados.",
      okText: "Atualizar",
      cancelText: "Cancelar",
      async onOk() {
        setSaving(true);
        try {
          await patch({ section: "warranty", warrantyTypeId, warrantyDuration, warrantyUnit });
          messageApi.success("Garantia padrão atualizada");
          await load();
        } catch (error) {
          messageApi.error(errorMessage(error, "Falha ao atualizar garantia"));
          throw error;
        } finally { setSaving(false); }
      },
    });
  };

  const disconnect = () => {
    Modal.confirm({
      title: "Desconectar o Mercado Livre?",
      content: "A autorização será revogada no Mercado Livre antes de os tokens locais serem removidos.",
      okText: "Desconectar",
      okButtonProps: { danger: true },
      cancelText: "Cancelar",
      async onOk() {
        setSaving(true);
        try {
          const response = await fetch("/api/configuracoes/mercado-livre", { method: "DELETE" });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.erro || "Falha ao desconectar");
          messageApi.success("Mercado Livre desconectado");
          await load();
        } catch (error) {
          messageApi.error(errorMessage(error, "Falha ao desconectar"));
          throw error;
        } finally { setSaving(false); }
      },
    });
  };

  const connected = Boolean(data?.application.connected);
  const credentialsReady = Boolean(clientId.trim() && data?.application.clientSecretConfigured);
  return (
    <Spin spinning={loading || saving}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <ConfiguracoesTabHeading title="Mercado Livre e anúncios"
          description="Conta, aplicativo OAuth e regras seguras usadas na publicação." />

        {data?.app.mixedMercadoPagoScopes ? (
          <Alert type="warning" showIcon message="Aplicativo com escopos mistos" description="Este aplicativo possui permissões relacionadas a pagamentos. Mercado Livre e Mercado Pago devem usar aplicativos separados." />
        ) : null}
        {data?.application.lastError ? <Alert type="error" showIcon message="Último erro de autenticação" description={data.application.lastError} /> : null}

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card title="Conexão e conta vendedora" style={{ ...configuracoesCardStyle, height: "100%" }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Estado"><Tag color={connected ? "green" : data?.application.authState === "degraded" ? "orange" : "default"}>{connected ? "Conectado" : "Desconectado"}</Tag></Descriptions.Item>
                <Descriptions.Item label="Seller">{data?.seller ? `${data.seller.nickname || "Conta"} · ${data.seller.id}` : "Não identificado"}</Descriptions.Item>
                <Descriptions.Item label="Site">{data?.seller?.siteId || "—"}</Descriptions.Item>
                <Descriptions.Item label="Access token"><Tag color={data?.application.accessTokenConfigured ? "green" : "default"}>{data?.application.accessTokenConfigured ? "Configurado" : "Ausente"}</Tag></Descriptions.Item>
                <Descriptions.Item label="Refresh token"><Tag color={data?.application.refreshTokenConfigured ? "green" : "default"}>{data?.application.refreshTokenConfigured ? "Configurado" : "Ausente"}</Tag></Descriptions.Item>
              </Descriptions>
              <Space wrap style={{ marginTop: 16 }}>
                <Button type="primary" icon={<LinkOutlined />} disabled={!credentialsReady} href="/api/integracao/ml/connect">{connected ? "Reconectar conta" : "Conectar conta"}</Button>
                <Button danger icon={<DisconnectOutlined />} disabled={!connected && !data?.application.accessTokenConfigured} onClick={disconnect}>Desconectar</Button>
                <Button onClick={() => void load()}>Atualizar diagnóstico</Button>
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={14}>
            <Card title="Aplicativo OAuth" style={{ ...configuracoesCardStyle, height: "100%" }}>
              <Alert type="info" showIcon message="Credenciais protegidas" description="O Client Secret nunca volta para o navegador. Deixe o campo vazio para manter o valor já salvo." style={{ marginBottom: 16 }} />
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text>Client ID</Text>
                <Input value={clientId} disabled={connected} onChange={(event) => setClientId(event.target.value)} style={configuracoesInputStyle} />
                <Text>Client Secret</Text>
                <Input.Password value={clientSecret} disabled={connected} autoComplete="new-password" placeholder={data?.application.clientSecretConfigured ? "Configurado — informe apenas para substituir" : "Informe o Client Secret"} onChange={(event) => setClientSecret(event.target.value)} style={configuracoesInputStyle} />
                <Text>URL de redirecionamento</Text>
                <Space.Compact style={{ width: "100%" }}>
                  <Input readOnly value={data?.application.redirectUri || "NEXT_PUBLIC_APP_URL não configurada"} style={configuracoesInputStyle} />
                  <Button icon={<CopyOutlined />} disabled={!data?.application.redirectUri} onClick={() => { if (data?.application.redirectUri) void navigator.clipboard.writeText(data.application.redirectUri).then(() => messageApi.success("URL copiada")); }}>Copiar</Button>
                </Space.Compact>
                <Button type="primary" disabled={connected} onClick={saveApplication}>Salvar aplicativo</Button>
              </Space>
              <Divider />
              <Descriptions column={{ xs: 1, md: 2 }} size="small">
                <Descriptions.Item label="Aplicativo">{data?.app.active == null ? "Não consultado" : data.app.active ? "Ativo" : "Inativo"}</Descriptions.Item>
                <Descriptions.Item label="Certificação">{data?.app.certificationStatus || "Não informada"}</Descriptions.Item>
                <Descriptions.Item label="Escopos" span={2}>{data?.app.scopes.length ? data.app.scopes.map((scope) => <Tag key={scope}>{scope}</Tag>) : "Não informados pela API"}</Descriptions.Item>
              </Descriptions>
              {data?.app.diagnosticsError ? <Text type="secondary">Diagnóstico externo parcial: {data.app.diagnosticsError}</Text> : null}
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card title="Garantia padrão" style={{ ...configuracoesCardStyle, height: "100%" }}>
              <Paragraph type="secondary">Preenchida somente em categorias que aceitam exatamente o tipo e o prazo escolhidos.</Paragraph>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Select value={warrantyTypeId} onChange={setWarrantyTypeId} options={[{ value: "2230279", label: "Garantia de fábrica" }, { value: "2230280", label: "Garantia do vendedor" }]} style={{ width: "100%" }} />
                <Space.Compact style={{ width: "100%" }}>
                  <InputNumber min={1} max={1200} value={warrantyDuration} onChange={(value) => setWarrantyDuration(value || 1)} style={{ width: "50%" }} />
                  <Select value={warrantyUnit} onChange={setWarrantyUnit} options={[{ value: "dias", label: "dias" }, { value: "meses", label: "meses" }, { value: "anos", label: "anos" }]} style={{ width: "50%" }} />
                </Space.Compact>
                <Button type="primary" onClick={saveWarranty}>Salvar garantia</Button>
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={14}>
            <Card title={<Space><SafetyCertificateOutlined />Regras protegidas</Space>} style={{ ...configuracoesCardStyle, height: "100%" }}>
              <Space direction="vertical" size={12}>
                {["Estoque inalterado não gera nova publicação.", "Elegibilidade é verificada na criação e novamente no processamento.", "Catálogo e Buy Box são estados externos somente para consulta.", "A conta vendedora autorizada permanece limitada pela allowlist do runtime."].map((rule) => <Space align="start" key={rule}><CheckCircleOutlined style={{ color: "#52c41a", marginTop: 4 }} /><Text>{rule}</Text></Space>)}
              </Space>
              <Divider />
              <Text type="secondary">Taxas e política de preço pertencem à aba Comercial.</Text><br />
              <Link href="/configuracoes?tab=comercial">Abrir configurações comerciais</Link>
            </Card>
          </Col>
        </Row>
      </Space>
    </Spin>
  );
}
