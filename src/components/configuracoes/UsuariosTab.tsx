"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Button, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { PlusOutlined, UserOutlined } from "@ant-design/icons";
import ConfiguracoesTabHeading from "./ConfiguracoesTabHeading";

const { Text } = Typography;

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

export default function UsuariosTab({
  messageApi,
}: {
  messageApi: MessageInstance;
}) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const loadUsuarios = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/configuracoes/usuarios");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao carregar usuários");
        return;
      }
      setUsuarios(Array.isArray(data?.usuarios) ? data.usuarios : []);
      setCurrentUserId(data?.currentUserId || null);
    } catch {
      messageApi.error("Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void loadUsuarios();
  }, [loadUsuarios]);

  const criarUsuario = async () => {
    if (!novoUsuario.nome || !novoUsuario.email || !novoUsuario.senha) {
      messageApi.warning("Preencha nome, e-mail e senha");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/configuracoes/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novoUsuario),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao criar usuário");
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
      setSaving(false);
    }
  };

  const toggleUsuario = async (user: Usuario) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/configuracoes/usuarios/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: !user.ativo }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao alterar status do usuário");
        return;
      }
      await loadUsuarios();
      messageApi.success(user.ativo ? "Usuário desativado" : "Usuário ativado");
    } catch {
      messageApi.error("Falha ao alterar status do usuário");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (user: Usuario) => {
    setEditUser({ ...user, senha: "" });
    setEditModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editUser) return;

    setSaving(true);
    try {
      const response = await fetch(
        `/api/configuracoes/usuarios/${editUser.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: editUser.nome,
            email: editUser.email,
            cargo: editUser.cargo,
            avatar_url: editUser.avatar_url || "",
            senha: editUser.senha || "",
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao atualizar usuário");
        return;
      }
      await loadUsuarios();
      setEditModalOpen(false);
      setEditUser(null);
      messageApi.success("Usuário atualizado!");
    } catch {
      messageApi.error("Falha ao atualizar usuário");
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<Usuario>["columns"] = [
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
      render: (cargo: UserRole) => (
        <Tag color={roleColor[cargo]}>
          {cargo.charAt(0).toUpperCase() + cargo.slice(1)}
        </Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "ativo",
      key: "ativo",
      render: (ativo: boolean) => (
        <Tag color={ativo ? "green" : "red"}>
          {ativo ? "Ativo" : "Inativo"}
        </Tag>
      ),
    },
    {
      title: "Ações",
      key: "actions",
      width: 120,
      render: (_, user) => (
        <Space>
          <Button size="small" onClick={() => openEdit(user)}>
            Editar
          </Button>
          <Button
            size="small"
            onClick={() => toggleUsuario(user)}
            loading={saving}
            disabled={currentUserId === user.id && user.ativo}
          >
            {user.ativo ? "Desativar" : "Ativar"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <ConfiguracoesTabHeading title="Usuários" description={`${usuarios.length} usuário(s) cadastrado(s)`} />
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
        columns={columns}
        rowKey="id"
        pagination={false}
        size="small"
        loading={loading}
        style={{ background: "transparent" }}
      />

      <Modal
        title="Novo Usuário"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={criarUsuario}
        okText="Criar"
        confirmLoading={saving}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Input
            placeholder="Nome"
            value={novoUsuario.nome}
            onChange={(event) =>
              setNovoUsuario((current) => ({
                ...current,
                nome: event.target.value,
              }))
            }
          />
          <Input
            placeholder="E-mail"
            value={novoUsuario.email}
            onChange={(event) =>
              setNovoUsuario((current) => ({
                ...current,
                email: event.target.value,
              }))
            }
          />
          <Input.Password
            placeholder="Senha"
            value={novoUsuario.senha}
            onChange={(event) =>
              setNovoUsuario((current) => ({
                ...current,
                senha: event.target.value,
              }))
            }
          />
          <Select
            placeholder="Cargo"
            value={novoUsuario.cargo}
            onChange={(cargo) =>
              setNovoUsuario((current) => ({ ...current, cargo }))
            }
            options={roleOptions}
            style={{ width: "100%" }}
          />
          <Input
            placeholder="URL do avatar (opcional)"
            value={novoUsuario.avatar_url}
            onChange={(event) =>
              setNovoUsuario((current) => ({
                ...current,
                avatar_url: event.target.value,
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
        confirmLoading={saving}
      >
        {editUser && (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Avatar
                size={64}
                src={editUser.avatar_url || undefined}
                icon={!editUser.avatar_url ? <UserOutlined /> : undefined}
              />
            </div>
            <Input
              placeholder="Nome"
              value={editUser.nome}
              onChange={(event) =>
                setEditUser((current) =>
                  current ? { ...current, nome: event.target.value } : current,
                )
              }
            />
            <Input
              placeholder="E-mail"
              value={editUser.email}
              onChange={(event) =>
                setEditUser((current) =>
                  current ? { ...current, email: event.target.value } : current,
                )
              }
            />
            <Select
              placeholder="Cargo"
              value={editUser.cargo}
              onChange={(cargo) =>
                setEditUser((current) =>
                  current ? { ...current, cargo } : current,
                )
              }
              options={roleOptions}
              style={{ width: "100%" }}
            />
            <Input
              placeholder="URL do avatar (opcional)"
              value={editUser.avatar_url || ""}
              onChange={(event) =>
                setEditUser((current) =>
                  current
                    ? { ...current, avatar_url: event.target.value }
                    : current,
                )
              }
            />
            <Input.Password
              placeholder="Nova senha (opcional)"
              value={editUser.senha || ""}
              onChange={(event) =>
                setEditUser((current) =>
                  current ? { ...current, senha: event.target.value } : current,
                )
              }
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
