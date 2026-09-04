"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Empty, Select, Space, Table, Typography } from "antd";
import type { TableProps } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { ReloadOutlined } from "@ant-design/icons";
import {
  CONFIGURATION_AUDIT_ACTIONS,
  CONFIGURATION_AUDIT_ACTION_LABELS,
  CONFIGURATION_DOMAINS,
  CONFIGURATION_DOMAIN_LABELS,
  type ConfigurationAuditAction,
  type ConfigurationAuditEntryDto,
  type ConfigurationAuditResponse,
  type ConfigurationAuditSnapshot,
  type ConfigurationDomain,
} from "@/lib/configuracoes/contracts";

const { Text } = Typography;
const PAGE_SIZE = 25;

function formatValue(snapshot: ConfigurationAuditSnapshot | null): string {
  if (!snapshot) return "—";
  if ("configured" in snapshot) {
    return snapshot.configured ? "Configurado" : "Não configurado";
  }
  if (snapshot.value === null) return "Não informado";
  if (typeof snapshot.value === "boolean") return snapshot.value ? "Sim" : "Não";
  if (typeof snapshot.value === "object") return JSON.stringify(snapshot.value);
  return String(snapshot.value);
}

export default function AuditoriaTab({
  messageApi,
}: {
  messageApi: MessageInstance;
}) {
  const [items, setItems] = useState<ConfigurationAuditEntryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState<ConfigurationDomain>();
  const [action, setAction] = useState<ConfigurationAuditAction>();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (domain) params.set("dominio", domain);
      if (action) params.set("acao", action);
      const response = await fetch(`/api/configuracoes/auditoria?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as
        | Partial<ConfigurationAuditResponse> & { erro?: string };
      if (!response.ok) {
        messageApi.error(data.erro || "Falha ao carregar o histórico");
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(data.pagination?.total || 0);
    } catch {
      messageApi.error("Falha ao carregar o histórico");
    } finally {
      setLoading(false);
    }
  }, [action, domain, messageApi, page]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const columns: TableProps<ConfigurationAuditEntryDto>["columns"] = [
    {
      title: "Data",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value)),
    },
    {
      title: "Responsável",
      dataIndex: ["actor", "name"],
      width: 180,
    },
    {
      title: "Área",
      dataIndex: "domainLabel",
      width: 190,
    },
    {
      title: "Configuração",
      dataIndex: "keyLabel",
      width: 220,
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Text>{value}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{row.key}</Text>
        </Space>
      ),
    },
    {
      title: "Ação",
      dataIndex: "actionLabel",
      width: 150,
    },
    {
      title: "Alteração",
      key: "change",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text type="secondary" ellipsis={{ tooltip: formatValue(row.before) }}>
            Antes: {formatValue(row.before)}
          </Text>
          <Text ellipsis={{ tooltip: formatValue(row.after) }}>
            Depois: {formatValue(row.after)}
          </Text>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        <Select
          allowClear
          placeholder="Todas as áreas"
          style={{ minWidth: 230 }}
          value={domain}
          options={CONFIGURATION_DOMAINS.map((value) => ({
            value,
            label: CONFIGURATION_DOMAIN_LABELS[value],
          }))}
          onChange={(value) => {
            setDomain(value);
            setPage(1);
          }}
        />
        <Select
          allowClear
          placeholder="Todas as ações"
          style={{ minWidth: 190 }}
          value={action}
          options={CONFIGURATION_AUDIT_ACTIONS.map((value) => ({
            value,
            label: CONFIGURATION_AUDIT_ACTION_LABELS[value],
          }))}
          onChange={(value) => {
            setAction(value);
            setPage(1);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void loadAudit()}>
          Atualizar
        </Button>
      </Space>
      <Table<ConfigurationAuditEntryDto>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 1180 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nenhuma alteração administrativa registrada"
            />
          ),
        }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (count) => `${count} alteração${count === 1 ? "" : "ões"}`,
          onChange: setPage,
        }}
      />
    </Space>
  );
}
