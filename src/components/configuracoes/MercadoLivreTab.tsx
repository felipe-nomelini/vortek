"use client";

import { userSafeMessage } from "@/lib/user-feedback";

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
  Modal,
  Row,
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
};

function errorMessage(error: unknown, fallback: string) {
  return userSafeMessage(error instanceof Error ? error.message : "", fallback);
}

export default function MercadoLivreTab({ messageApi }: { messageApi: MessageInstance }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<MlConfiguration | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/configuracoes/mercado-livre", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.erro || "Falha ao carregar Mercado Livre");
      setData(payload);
      setClientId(payload.application.clientId || "");
      setClientSecret("");
    } catch (error) {
      messageApi.error(errorMessage(error, "Não foi possível carregar a conexão com o Mercado Livre. Tente novamente."));
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
      messageApi.warning("Informe o identificador do aplicativo Mercado Livre");
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
          messageApi.error(errorMessage(error, "Não foi possível atualizar o aplicativo. Revise os dados e tente novamente."));
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
          messageApi.error(errorMessage(error, "Não foi possível desconectar a conta. Tente novamente."));
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
          description="Conta e aplicativo usados para conectar e atualizar os anúncios." />

        {data?.app.mixedMercadoPagoScopes ? (
          <Alert type="info" showIcon message="Leitura financeira disponível" description="Esta conta também autoriza a consulta dos relatórios financeiros usados pela Bentevi." />
        ) : null}
        {data?.application.lastError ? <Alert type="error" showIcon message="A conexão precisa de atenção" description={userSafeMessage(data.application.lastError, "Não foi possível validar a conta. Reconecte o Mercado Livre e tente novamente.")} /> : null}

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Card title="Conexão e conta vendedora" style={{ ...configuracoesCardStyle, height: "100%" }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Estado"><Tag color={connected ? "green" : data?.application.authState === "degraded" ? "orange" : "default"}>{connected ? "Conectado" : "Desconectado"}</Tag></Descriptions.Item>
                <Descriptions.Item label="Conta vendedora">{data?.seller ? `${data.seller.nickname || "Conta"} · ${data.seller.id}` : "Não identificada"}</Descriptions.Item>
                <Descriptions.Item label="País da conta">{data?.seller?.siteId || "—"}</Descriptions.Item>
                <Descriptions.Item label="Autorização principal"><Tag color={data?.application.accessTokenConfigured ? "green" : "default"}>{data?.application.accessTokenConfigured ? "Configurada" : "Ausente"}</Tag></Descriptions.Item>
                <Descriptions.Item label="Renovação automática"><Tag color={data?.application.refreshTokenConfigured ? "green" : "default"}>{data?.application.refreshTokenConfigured ? "Configurada" : "Ausente"}</Tag></Descriptions.Item>
              </Descriptions>
              <Space wrap style={{ marginTop: 16 }}>
                <Button type="primary" icon={<LinkOutlined />} disabled={!credentialsReady} href="/api/integracao/ml/connect">{connected ? "Reconectar conta" : "Conectar conta"}</Button>
                <Button danger icon={<DisconnectOutlined />} disabled={!connected && !data?.application.accessTokenConfigured} onClick={disconnect}>Desconectar</Button>
                <Button onClick={() => void load()}>Atualizar diagnóstico</Button>
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={14}>
            <Card title="Aplicativo do Mercado Livre" style={{ ...configuracoesCardStyle, height: "100%" }}>
              <Alert type="info" showIcon message="Credenciais protegidas" description="A chave secreta não é exibida depois de salva. Deixe o campo vazio para manter o valor atual." style={{ marginBottom: 16 }} />
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Text>Identificador do aplicativo</Text>
                <Input value={clientId} disabled={connected} onChange={(event) => setClientId(event.target.value)} style={configuracoesInputStyle} />
                <Text>Chave secreta do aplicativo</Text>
                <Input.Password value={clientSecret} disabled={connected} autoComplete="new-password" placeholder={data?.application.clientSecretConfigured ? "Configurada — informe apenas para substituir" : "Informe a chave secreta"} onChange={(event) => setClientSecret(event.target.value)} style={configuracoesInputStyle} />
                <Text>URL de redirecionamento</Text>
                <Space.Compact style={{ width: "100%" }}>
                  <Input readOnly value={data?.application.redirectUri || "Endereço do sistema não configurado"} style={configuracoesInputStyle} />
                  <Button icon={<CopyOutlined />} disabled={!data?.application.redirectUri} onClick={() => { if (data?.application.redirectUri) void navigator.clipboard.writeText(data.application.redirectUri).then(() => messageApi.success("URL copiada")); }}>Copiar</Button>
                </Space.Compact>
                <Button type="primary" disabled={connected} onClick={saveApplication}>Salvar aplicativo</Button>
              </Space>
              <Divider />
              <Descriptions column={{ xs: 1, md: 2 }} size="small">
                <Descriptions.Item label="Aplicativo">{data?.app.active == null ? "Não consultado" : data.app.active ? "Ativo" : "Inativo"}</Descriptions.Item>
                <Descriptions.Item label="Certificação">{data?.app.certificationStatus || "Não informada"}</Descriptions.Item>
                <Descriptions.Item label="Permissões" span={2}>{data?.app.scopes.length ? `${data.app.scopes.length} permissões concedidas` : "Não informadas pelo Mercado Livre"}</Descriptions.Item>
              </Descriptions>
              {data?.app.diagnosticsError ? <Text type="secondary">Não foi possível conferir todos os dados: {userSafeMessage(data.app.diagnosticsError, "tente atualizar novamente.")}</Text> : null}
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card title={<Space><SafetyCertificateOutlined />Regras protegidas</Space>} style={{ ...configuracoesCardStyle, height: "100%" }}>
              <Space direction="vertical" size={12}>
                {["Estoque sem alteração não gera novo envio.", "A situação do anúncio é conferida antes de cada alteração.", "As informações de catálogo e competição são consultadas diretamente no Mercado Livre.", "A conta vendedora permanece limitada às operações liberadas no sistema."].map((rule) => <Space align="start" key={rule}><CheckCircleOutlined style={{ color: "#52c41a", marginTop: 4 }} /><Text>{rule}</Text></Space>)}
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
