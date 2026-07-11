"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  Row,
  Col,
  Input,
  InputNumber,
  Select,
  Button,
  Tag,
  Table,
  Modal,
  Tabs,
  Typography,
  Switch,
  Space,
  message,
  Upload,
  Avatar,
  Spin,
} from "antd";
import type { TableProps } from "antd";
import { PlusOutlined, UserOutlined, LoadingOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

type UserRole = "admin" | "gerente" | "operador" | "visualizador";

interface Usuario {
  id: string;
  nome: string;
  email: string;
  cargo: UserRole;
  ativo: boolean;
  avatar_url?: string | null;
  banned_until?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
}

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "gerente", label: "Gerente" },
  { value: "operador", label: "Operador" },
  { value: "visualizador", label: "Visualizador" },
];

const roleColor: Record<UserRole, string> = {
  admin: "red",
  gerente: "blue",
  operador: "green",
  visualizador: "default",
};

const cardBg = {
  background: "#141414",
  border: "1px solid #303030",
  borderRadius: 8,
};
const inputStyle = {
  background: "#1f1f1f",
  border: "1px solid #303030",
  borderRadius: 6,
};

function saveIntegrations(ml: boolean, dslite: boolean) {
  if (typeof window !== "undefined") {
    localStorage.setItem("vortek_integrations", JSON.stringify({ ml, dslite }));
  }
}

function vapidKeyToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function ConfiguracoesPageContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("empresa");
  const [messageApi, contextHolder] = message.useMessage();
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [savingEmpresa, setSavingEmpresa] = useState(false);
  const [savingPreferencias, setSavingPreferencias] = useState(false);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);
  const [savingUsuario, setSavingUsuario] = useState(false);
  const [testingIntegration, setTestingIntegration] = useState<string | null>(
    null,
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [empresa, setEmpresa] = useState({
    nome: "",
    nickname: "",
    cnpj: "",
    endereco: "",
    email: "",
    telefone: "",
    uf_fiscal: "",
    cod_municipio_fiscal: "",
  });
  const patchEmpresa = (d: Partial<typeof empresa>) =>
    setEmpresa((p) => ({ ...p, ...d }));

  const [ml, setMl] = useState({
    clientId: "",
    clientSecret: "",
    conectado: false,
    lastError: "",
    lastErrorCode: "",
  });
  const [dslite, setDslite] = useState({
    url: "",
    token: "",
    conectado: false,
  });
  const [brasilNfe, setBrasilNfe] = useState({
    token: "",
    userToken: "",
    url: "",
    conectado: false,
  });
  const [defaultNfeProvider, setDefaultNfeProvider] =
    useState<"brasilnfe">("brasilnfe");

  useEffect(() => {
    const requestedTab = searchParams?.get("tab");
    if (
      requestedTab &&
      ["empresa", "integracoes", "usuarios", "preferencias"].includes(
        requestedTab,
      )
    ) {
      setTab(requestedTab);
    }
  }, [searchParams]);

  const loadUsuarios = useCallback(async () => {
    setLoadingUsuarios(true);
    try {
      const res = await fetch("/api/configuracoes/usuarios");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.erro || "Falha ao carregar usuários");
        return false;
      }
      setUsuarios(Array.isArray(json?.usuarios) ? json.usuarios : []);
      setCurrentUserId(json?.currentUserId || null);
      return true;
    } catch {
      messageApi.error("Falha ao carregar usuários");
      return false;
    } finally {
      setLoadingUsuarios(false);
    }
  }, [messageApi]);

  useEffect(() => {
    const load = async () => {
      setLoadingPage(true);
      try {
        const [empresaRes, integracoesRes, configRes] = await Promise.all([
          fetch("/api/configuracoes/empresa"),
          fetch("/api/integracoes/config"),
          fetch("/api/configuracoes"),
        ]);

        if (empresaRes.ok) {
          const empresaAtual = await empresaRes.json();
          if (empresaAtual) {
            setEmpresaId(empresaAtual.id);
            setEmpresa({
              nome: empresaAtual.nome || "",
              nickname: empresaAtual.nickname || "",
              cnpj: empresaAtual.cnpj || "",
              endereco: empresaAtual.endereco || "",
              email: empresaAtual.email || "",
              telefone: empresaAtual.telefone || "",
              uf_fiscal: empresaAtual.uf_fiscal || "",
              cod_municipio_fiscal: empresaAtual.cod_municipio_fiscal || "",
            });
          }
        }

        if (integracoesRes.ok) {
          const integracoesJson = await integracoesRes.json();
          for (const i of integracoesJson.integracoes || []) {
            if (i.tipo === "mercadolivre") {
              setMl({
                clientId: i.client_id || "",
                clientSecret: i.client_secret || "",
                conectado: i.conectado,
                lastError: i.last_refresh_error || "",
                lastErrorCode: i.last_refresh_error_code || "",
              });
            }
            if (i.tipo === "dslite")
              setDslite({
                url: i.url || "",
                token: i.access_token || "",
                conectado: i.conectado,
              });
            if (i.tipo === "brasilnfe")
              setBrasilNfe({
                token: i.access_token || "",
                userToken: i.refresh_token || "",
                url: i.url || "",
                conectado: i.conectado,
              });
          }
        }

        if (configRes.ok) {
          const conf = await configRes.json();
          const provider = String(
            conf?.nfe_provider_default || "",
          ).toLowerCase();
          setMargem(
            typeof conf?.margem_lucro === "number" ? conf.margem_lucro : 30,
          );
          setNotif({
            push: Boolean(conf?.notificacoes_push ?? false),
          });
          if (provider === "brasilnfe") {
            setDefaultNfeProvider(provider);
          }
        }

        await loadUsuarios();
      } catch {
        messageApi.error("Falha ao carregar configurações");
      } finally {
        setLoadingPage(false);
      }
    };
    load();
  }, [loadUsuarios, messageApi]);

  const salvarEmpresa = useCallback(async () => {
    setSavingEmpresa(true);
    try {
      const res = await fetch("/api/configuracoes/empresa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: empresaId, ...empresa }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        messageApi.error(json?.erro || "Falha ao salvar dados da empresa");
        return;
      }

      if (json?.id) setEmpresaId(json.id);
      messageApi.success("Dados da empresa salvos");
    } catch {
      messageApi.error("Falha ao salvar dados da empresa");
    } finally {
      setSavingEmpresa(false);
    }
  }, [empresa, empresaId, messageApi]);

  const saveIntegracao = useCallback(
    async (tipo: string, data: Record<string, any>) => {
      const res = await fetch("/api/integracoes/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, values: data }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.erro || "Falha ao salvar integração");
      return json.integracao;
    },
    [],
  );

  useEffect(() => {
    saveIntegrations(ml.conectado, dslite.conectado);
  }, [ml.conectado, dslite.conectado]);

  const conectarML = async () => {
    if (!ml.clientId || !ml.clientSecret) {
      messageApi.warning("Preencha Client ID e Client Secret");
      return;
    }
    try {
      await saveIntegracao("mercadolivre", {
        client_id: ml.clientId,
        client_secret: ml.clientSecret,
      });
      window.location.href = "/api/integracao/ml/connect";
    } catch (err: any) {
      messageApi.error(
        err?.message || "Falha ao salvar credenciais do Mercado Livre",
      );
    }
  };

  const testarDslite = async () => {
    if (!dslite.url || !dslite.token) {
      messageApi.warning("Preencha a URL e o Token");
      return;
    }
    setTestingIntegration("dslite");
    try {
      const testRes = await fetch("/api/integracoes/teste/dslite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dslite.url, token: dslite.token }),
      });
      const testJson = await testRes.json().catch(() => ({}));
      const conectado = Boolean(testRes.ok && testJson?.ok);

      setDslite((p) => ({ ...p, conectado }));
      await saveIntegracao("dslite", {
        url: dslite.url,
        access_token: dslite.token,
        conectado,
      });

      if (!conectado) {
        messageApi.error(testJson?.erro || "Falha ao validar DSLite");
        return;
      }

      messageApi.success(testJson?.message || "Conexão DSLite validada!");
    } catch (err: any) {
      setDslite((p) => ({ ...p, conectado: false }));
      messageApi.error(err?.message || "Falha ao validar DSLite");
    } finally {
      setTestingIntegration(null);
    }
  };

  const salvarDefaultProvider = useCallback(
    async (provider: "brasilnfe") => {
      const res = await fetch("/api/configuracoes/fiscal-provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultProvider: provider }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(
          json?.erro || "Falha ao salvar provedor fiscal padrão",
        );
        return;
      }
      setDefaultNfeProvider(provider);
      messageApi.success("Provedor fiscal padrão atualizado");
    },
    [messageApi],
  );

  const testarBrasilNfe = async () => {
    if (!brasilNfe.token) {
      messageApi.warning("Preencha o Token da Brasil NFe");
      return;
    }
    setTestingIntegration("brasilnfe");
    try {
      const testRes = await fetch("/api/integracoes/teste/brasilnfe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: brasilNfe.token,
          userToken: brasilNfe.userToken,
          url: brasilNfe.url,
        }),
      });
      const testJson = await testRes.json().catch(() => ({}));
      const conectado = Boolean(testRes.ok && testJson?.ok);

      setBrasilNfe((p) => ({ ...p, conectado }));
      await saveIntegracao("brasilnfe", {
        access_token: brasilNfe.token,
        refresh_token: brasilNfe.userToken || null,
        url: brasilNfe.url || null,
        conectado,
      });

      if (!conectado) {
        messageApi.error(testJson?.erro || "Falha ao validar Brasil NFe");
        return;
      }

      messageApi.success(testJson?.message || "Conexão Brasil NFe validada!");
    } catch (err: any) {
      setBrasilNfe((p) => ({ ...p, conectado: false }));
      messageApi.error(err?.message || "Falha ao validar Brasil NFe");
    } finally {
      setTestingIntegration(null);
    }
  };

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<
    (Usuario & { senha?: string }) | null
  >(null);
  const [novoUsuario, setNovoUsuario] = useState({
    nome: "",
    email: "",
    senha: "",
    cargo: "operador" as UserRole,
    avatar_url: "",
  });

  const criarUsuario = async () => {
    if (!novoUsuario.nome || !novoUsuario.email || !novoUsuario.senha) {
      messageApi.warning("Preencha nome, e-mail e senha");
      return;
    }

    setSavingUsuario(true);
    try {
      const res = await fetch("/api/configuracoes/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novoUsuario),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.erro || "Falha ao criar usuário");
        return;
      }

      await loadUsuarios();
      setNovoUsuario({
        nome: "",
        email: "",
        senha: "",
        cargo: "operador",
        avatar_url: "",
      });
      setModalOpen(false);
      messageApi.success("Usuário criado!");
    } catch {
      messageApi.error("Falha ao criar usuário");
    } finally {
      setSavingUsuario(false);
    }
  };

  const toggleUsuario = async (user: Usuario) => {
    setSavingUsuario(true);
    try {
      const res = await fetch(`/api/configuracoes/usuarios/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !user.ativo }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.erro || "Falha ao alterar status do usuário");
        return;
      }

      await loadUsuarios();
      messageApi.success(user.ativo ? "Usuário desativado" : "Usuário ativado");
    } catch {
      messageApi.error("Falha ao alterar status do usuário");
    } finally {
      setSavingUsuario(false);
    }
  };

  const openEdit = (user: Usuario) => {
    setEditUser({ ...user, senha: "" });
    setEditModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editUser) return;

    setSavingUsuario(true);
    try {
      const res = await fetch(`/api/configuracoes/usuarios/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: editUser.nome,
          email: editUser.email,
          cargo: editUser.cargo,
          avatar_url: editUser.avatar_url || "",
          senha: editUser.senha || "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.erro || "Falha ao atualizar usuário");
        return;
      }

      await loadUsuarios();
      setEditModalOpen(false);
      setEditUser(null);
      messageApi.success("Usuário atualizado!");
    } catch {
      messageApi.error("Falha ao atualizar usuário");
    } finally {
      setSavingUsuario(false);
    }
  };

  const userColumns: TableProps<Usuario>["columns"] = [
    {
      title: "",
      dataIndex: "avatar_url",
      key: "avatar_url",
      width: 40,
      render: (avatarUrl: string | null | undefined) => (
        <Avatar
          size={24}
          src={avatarUrl || undefined}
          icon={!avatarUrl ? <UserOutlined /> : undefined}
          style={{ backgroundColor: "#1677ff" }}
        />
      ),
    },
    { title: "Nome", dataIndex: "nome", key: "nome" },
    { title: "E-mail", dataIndex: "email", key: "email" },
    {
      title: "Cargo",
      dataIndex: "cargo",
      key: "cargo",
      render: (c: UserRole) => (
        <Tag color={roleColor[c]}>{c.charAt(0).toUpperCase() + c.slice(1)}</Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "ativo",
      key: "ativo",
      render: (a: boolean) => (
        <Tag color={a ? "green" : "red"}>{a ? "Ativo" : "Inativo"}</Tag>
      ),
    },
    {
      title: "Ações",
      key: "actions",
      width: 120,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => openEdit(r)}>
            Editar
          </Button>
          <Button
            size="small"
            onClick={() => toggleUsuario(r)}
            loading={savingUsuario}
            disabled={currentUserId === r.id && r.ativo}
          >
            {r.ativo ? "Desativar" : "Ativar"}
          </Button>
        </Space>
      ),
    },
  ];

  const [margem, setMargem] = useState(30);
  const [notif, setNotif] = useState({ push: false });

  const togglePush = async (enabled: boolean) => {
    if (!enabled) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setNotif({ push: false });
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      messageApi.error('Push não é suportado neste navegador.');
      return;
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      messageApi.error('Chave pública VAPID não configurada.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      messageApi.warning('Permissão de notificações não concedida.');
      return;
    }
    const registration = await navigator.serviceWorker.register('/sw.js');
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToUint8Array(publicKey),
    });
    const response = await fetch('/api/push/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    if (!response.ok) throw new Error('Falha ao salvar inscrição push.');
    setNotif({ push: true });
  };

  const salvarPreferencias = useCallback(async () => {
    setSavingPreferencias(true);
    try {
      const res = await fetch("/api/configuracoes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          margem_lucro: margem,
          notificacoes_push: notif.push,
          nfe_provider_default: defaultNfeProvider,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        messageApi.error(json?.erro || "Falha ao salvar preferências");
        return;
      }
      messageApi.success("Preferências salvas");
    } catch {
      messageApi.error("Falha ao salvar preferências");
    } finally {
      setSavingPreferencias(false);
    }
  }, [defaultNfeProvider, margem, messageApi, notif.push]);

  const integrations = [
    {
      key: "ml",
      nome: "Mercado Livre",
      conectado: ml.conectado,
      cor: "#1677ff",
      bg: "#111d2e",
      fields: (
        <>
          <Input
            placeholder="Client ID (App ID)"
            value={ml.clientId}
            onChange={(e) => setMl((p) => ({ ...p, clientId: e.target.value }))}
            onBlur={() =>
              saveIntegracao("mercadolivre", { client_id: ml.clientId })
            }
            style={inputStyle}
          />
          <Input
            placeholder="Client Secret"
            type="password"
            value={ml.clientSecret}
            onChange={(e) =>
              setMl((p) => ({ ...p, clientSecret: e.target.value }))
            }
            onBlur={() =>
              saveIntegracao("mercadolivre", { client_secret: ml.clientSecret })
            }
            style={inputStyle}
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
      bg: "#2a1706",
      fields: (
        <>
          <Input
            placeholder="URL da API"
            value={dslite.url}
            onChange={(e) => setDslite((p) => ({ ...p, url: e.target.value }))}
            onBlur={() => saveIntegracao("dslite", { url: dslite.url })}
            style={inputStyle}
          />
          <Input
            placeholder="Token de Acesso"
            type="password"
            value={dslite.token}
            onChange={(e) =>
              setDslite((p) => ({ ...p, token: e.target.value }))
            }
            onBlur={() =>
              saveIntegracao("dslite", { access_token: dslite.token })
            }
            style={inputStyle}
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
      bg: "#0b2525",
      fields: (
        <>
          <Input
            placeholder="Token da Empresa"
            type="password"
            value={brasilNfe.token}
            onChange={(e) =>
              setBrasilNfe((p) => ({ ...p, token: e.target.value }))
            }
            onBlur={() =>
              saveIntegracao("brasilnfe", { access_token: brasilNfe.token })
            }
            style={inputStyle}
          />
          <Input
            placeholder="User Token (opcional)"
            type="password"
            value={brasilNfe.userToken}
            onChange={(e) =>
              setBrasilNfe((p) => ({ ...p, userToken: e.target.value }))
            }
            onBlur={() =>
              saveIntegracao("brasilnfe", {
                refresh_token: brasilNfe.userToken,
              })
            }
            style={inputStyle}
          />
          <Input
            placeholder="URL Base (opcional)"
            value={brasilNfe.url}
            onChange={(e) =>
              setBrasilNfe((p) => ({ ...p, url: e.target.value }))
            }
            onBlur={() => saveIntegracao("brasilnfe", { url: brasilNfe.url })}
            style={inputStyle}
          />
        </>
      ),
      action: { label: "Testar conexão", onClick: testarBrasilNfe },
    },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ color: "#e0e0e0", marginBottom: 20 }}>
        Configurações
      </Title>

      <Spin
        spinning={loadingPage}
        indicator={
          <LoadingOutlined style={{ fontSize: 24, color: "#1677ff" }} spin />
        }
      >
        <Card
          styles={{ body: { padding: 0 } }}
          style={{ ...cardBg, overflow: "hidden" }}
        >
          <Tabs
            activeKey={tab}
            onChange={setTab}
            tabBarStyle={{
              margin: 0,
              paddingLeft: 16,
              background: "#1a1a1a",
              borderBottom: "1px solid #303030",
            }}
            style={{ padding: 20 }}
            items={[
              {
                key: "empresa",
                label: "🏢 Empresa",
                children: (
                  <Row gutter={[16, 12]}>
                    <Col span={12}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                        Nome da Loja
                      </div>
                      <Input
                        value={empresa.nome}
                        onChange={(e) => patchEmpresa({ nome: e.target.value })}
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={12}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                        Nickname ML
                      </div>
                      <Input
                        value={empresa.nickname}
                        onChange={(e) =>
                          patchEmpresa({ nickname: e.target.value })
                        }
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={12}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>CNPJ</div>
                      <Input
                        value={empresa.cnpj}
                        onChange={(e) => patchEmpresa({ cnpj: e.target.value })}
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={12}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                        Telefone
                      </div>
                      <Input
                        value={empresa.telefone}
                        onChange={(e) =>
                          patchEmpresa({ telefone: e.target.value })
                        }
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={12}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                        UF Fiscal
                      </div>
                      <Input
                        maxLength={2}
                        value={empresa.uf_fiscal}
                        onChange={(e) =>
                          patchEmpresa({
                            uf_fiscal: e.target.value.toUpperCase(),
                          })
                        }
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={12}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                        Código Município (IBGE)
                      </div>
                      <Input
                        maxLength={7}
                        value={empresa.cod_municipio_fiscal}
                        onChange={(e) =>
                          patchEmpresa({
                            cod_municipio_fiscal: e.target.value.replace(
                              /\D/g,
                              "",
                            ),
                          })
                        }
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={12}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                        E-mail
                      </div>
                      <Input
                        value={empresa.email}
                        onChange={(e) =>
                          patchEmpresa({ email: e.target.value })
                        }
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={24}>
                      <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                        Endereço
                      </div>
                      <Input
                        value={empresa.endereco}
                        onChange={(e) =>
                          patchEmpresa({ endereco: e.target.value })
                        }
                        style={inputStyle}
                      />
                    </Col>
                    <Col span={24}>
                      <Button
                        type="primary"
                        size="small"
                        loading={savingEmpresa}
                        onClick={salvarEmpresa}
                      >
                        Salvar dados da empresa
                      </Button>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "integracoes",
                label: "🔐 Integrações",
                children: (
                  <Row gutter={[16, 16]}>
                    <Col span={24}>
                      <Card
                        styles={{ body: { padding: 12 } }}
                        style={{ ...cardBg }}
                      >
                        <Space
                          align="center"
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                          }}
                        >
                          <Text style={{ color: "#e0e0e0", fontWeight: 600 }}>
                            Provedor fiscal padrão (NF-e)
                          </Text>
                          <Select
                            style={{ minWidth: 220 }}
                            value={defaultNfeProvider}
                            onChange={(v: "brasilnfe") =>
                              salvarDefaultProvider(v)
                            }
                            options={[
                              {
                                value: "brasilnfe",
                                label: "Brasil NFe (primário)",
                              },
                            ]}
                          />
                        </Space>
                      </Card>
                    </Col>
                    {integrations.map((api) => (
                      <Col xs={24} lg={8} key={api.key}>
                        <Card
                          styles={{ body: { padding: 16 } }}
                          style={{
                            ...cardBg,
                            height: "100%",
                            borderColor: api.conectado ? api.cor : "#303030",
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
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <div
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: 6,
                                  background: api.conectado ? api.cor : "#555",
                                }}
                              />
                              <Text
                                style={{
                                  color: "#e0e0e0",
                                  fontWeight: 600,
                                  fontSize: 15,
                                }}
                              >
                                {api.nome}
                              </Text>
                            </div>
                            {api.conectado ? (
                              <Tag color="green" style={{ margin: 0 }}>
                                Conectado
                              </Tag>
                            ) : (
                              <Tag color="default" style={{ margin: 0 }}>
                                Desconectado
                              </Tag>
                            )}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              marginBottom: 16,
                            }}
                          >
                            {api.fields}
                          </div>
                          <Button
                            size="small"
                            type="primary"
                            onClick={api.action.onClick}
                            loading={testingIntegration === api.key}
                            style={{ width: "100%" }}
                          >
                            {api.action.label}
                          </Button>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                ),
              },
              {
                key: "usuarios",
                label: "👥 Usuários",
                children: (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 16,
                      }}
                    >
                      <Text style={{ color: "#a0a0a0", fontSize: 13 }}>
                        {usuarios.length} usuário(s) cadastrado(s)
                      </Text>
                      <Button
                        type="primary"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setModalOpen(true)}
                      >
                        Novo Usuário
                      </Button>
                    </div>
                    <Table<Usuario>
                      dataSource={usuarios}
                      columns={userColumns}
                      rowKey="id"
                      pagination={false}
                      size="small"
                      loading={loadingUsuarios}
                      style={{ background: "transparent" }}
                    />

                    <Modal
                      title="Novo Usuário"
                      open={modalOpen}
                      onCancel={() => setModalOpen(false)}
                      onOk={criarUsuario}
                      okText="Criar"
                      confirmLoading={savingUsuario}
                    >
                      <Space
                        direction="vertical"
                        style={{ width: "100%" }}
                        size={12}
                      >
                        <Input
                          placeholder="Nome"
                          value={novoUsuario.nome}
                          onChange={(e) =>
                            setNovoUsuario((p) => ({
                              ...p,
                              nome: e.target.value,
                            }))
                          }
                        />
                        <Input
                          placeholder="E-mail"
                          value={novoUsuario.email}
                          onChange={(e) =>
                            setNovoUsuario((p) => ({
                              ...p,
                              email: e.target.value,
                            }))
                          }
                        />
                        <Input.Password
                          placeholder="Senha"
                          value={novoUsuario.senha}
                          onChange={(e) =>
                            setNovoUsuario((p) => ({
                              ...p,
                              senha: e.target.value,
                            }))
                          }
                        />
                        <Select
                          placeholder="Cargo"
                          value={novoUsuario.cargo}
                          onChange={(v) =>
                            setNovoUsuario((p) => ({ ...p, cargo: v }))
                          }
                          options={roleOptions}
                          style={{ width: "100%" }}
                        />
                        <Input
                          placeholder="URL do avatar (opcional)"
                          value={novoUsuario.avatar_url}
                          onChange={(e) =>
                            setNovoUsuario((p) => ({
                              ...p,
                              avatar_url: e.target.value,
                            }))
                          }
                        />
                      </Space>
                    </Modal>

                    <Modal
                      title="Editar Usuário"
                      open={editModalOpen}
                      onCancel={() => setEditModalOpen(false)}
                      onOk={saveEdit}
                      okText="Salvar"
                      confirmLoading={savingUsuario}
                    >
                      {editUser && (
                        <Space
                          direction="vertical"
                          style={{ width: "100%" }}
                          size={12}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 16,
                            }}
                          >
                            <Avatar
                              size={64}
                              src={editUser.avatar_url || undefined}
                              icon={
                                !editUser.avatar_url ? (
                                  <UserOutlined />
                                ) : undefined
                              }
                            />
                          </div>
                          <Input
                            placeholder="Nome"
                            value={editUser.nome}
                            onChange={(e) =>
                              setEditUser((p) =>
                                p ? { ...p, nome: e.target.value } : p,
                              )
                            }
                          />
                          <Input
                            placeholder="E-mail"
                            value={editUser.email}
                            onChange={(e) =>
                              setEditUser((p) =>
                                p ? { ...p, email: e.target.value } : p,
                              )
                            }
                          />
                          <Select
                            placeholder="Cargo"
                            value={editUser.cargo}
                            onChange={(v) =>
                              setEditUser((p) => (p ? { ...p, cargo: v } : p))
                            }
                            options={roleOptions}
                            style={{ width: "100%" }}
                          />
                          <Input
                            placeholder="URL do avatar (opcional)"
                            value={editUser.avatar_url || ""}
                            onChange={(e) =>
                              setEditUser((p) =>
                                p ? { ...p, avatar_url: e.target.value } : p,
                              )
                            }
                          />
                          <Input.Password
                            placeholder="Nova senha (opcional)"
                            value={editUser.senha || ""}
                            onChange={(e) =>
                              setEditUser((p) =>
                                p ? { ...p, senha: e.target.value } : p,
                              )
                            }
                          />
                        </Space>
                      )}
                    </Modal>
                  </div>
                ),
              },
              {
                key: "preferencias",
                label: "⚙️ Preferências",
                children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <div
                        style={{
                          color: "#a0a0a0",
                          fontSize: 13,
                          marginBottom: 6,
                        }}
                      >
                        Margem de Lucro Padrão
                      </div>
                      <InputNumber
                        suffix="%"
                        value={margem}
                        onChange={(v) => setMargem(v ?? 30)}
                        style={{ ...inputStyle, width: "100%" }}
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
                    <Col xs={24} md={8}>
                      <div
                        style={{
                          color: "#a0a0a0",
                          fontSize: 13,
                          marginBottom: 6,
                        }}
                      >
                        Notificações Push
                      </div>
                      <Switch
                        checked={notif.push}
                        onChange={(v) => void togglePush(v).catch((error) => messageApi.error(error?.message || 'Falha ao configurar push.'))}
                      />
                      {notif.push && <Button size="small" style={{ marginLeft: 12 }} onClick={() => fetch('/api/push/test', { method: 'POST' }).then((res) => res.ok ? messageApi.success('Push de teste enviado.') : messageApi.error('Falha no push de teste.'))}>Testar</Button>}
                    </Col>
                    <Col span={24}>
                      <Button
                        type="primary"
                        loading={savingPreferencias}
                        onClick={salvarPreferencias}
                      >
                        Salvar preferências
                      </Button>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />
        </Card>
      </Spin>
    </div>
  );
}

export default function ConfiguracoesPage() {
  return (
    <Suspense
      fallback={
        <div>
          <Card style={{ ...cardBg }}>
            <Spin
              spinning
              indicator={
                <LoadingOutlined
                  style={{ fontSize: 24, color: "#1677ff" }}
                  spin
                />
              }
            />
          </Card>
        </div>
      }
    >
      <ConfiguracoesPageContent />
    </Suspense>
  );
}
