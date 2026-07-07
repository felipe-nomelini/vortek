"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  DatePicker,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import ResizableTable from "@/components/ResizableTable";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

type MLClaimStatus = "opened" | "closed" | string;
type MLClaimStage =
  "claim" | "dispute" | "recontact" | "none" | "stale" | string;
type MLClaimType =
  | "return"
  | "returns"
  | "mediations"
  | "cancel_sale"
  | "cancel_purchase"
  | "ml_case"
  | "change"
  | "service"
  | string;

type ClaimMessage = {
  id: string | number | null;
  sender: string | null;
  text: string | null;
  date_created: string | null;
};

type Reclamacao = {
  id: number;
  pedido: number;
  cliente: string;
  buyer_id: number | null;
  tipo: MLClaimType | null;
  tipo_label: string;
  stage: MLClaimStage | null;
  stage_label: string;
  status: MLClaimStatus | null;
  status_label: string;
  reason_id: string | null;
  reason_name?: string | null;
  reason_detail?: string | null;
  reason_flow?: string | null;
  fulfilled: boolean | null;
  quantity_type: string | null;
  claimed_quantity: number | null;
  resolution: any;
  data: string | null;
  atualizado_em: string | null;
  pedido_status: string | null;
  item_id: string | null;
  item_title: string | null;
  available_actions: Array<{
    action?: string;
    mandatory?: boolean;
    due_date?: string | null;
  }>;
  related_entities: string[];
  related_entities_label?: string[];
  messages: ClaimMessage[];
};

type ApiResponse = {
  conectado?: boolean;
  precisaReconectar?: boolean;
  erro?: string;
  items?: Reclamacao[];
  total?: number;
};

const tipoOptions = [
  { value: "", label: "Todos os tipos" },
  { value: "returns", label: "Devolução" },
  { value: "cancel_sale", label: "Cancelamento do vendedor" },
  { value: "cancel_purchase", label: "Cancelamento do comprador" },
  { value: "mediations", label: "Mediação" },
];

const stageOptions = [
  { value: "", label: "Todos os estágios" },
  { value: "claim", label: "Negociação" },
  { value: "dispute", label: "Disputa" },
  { value: "recontact", label: "Recontato" },
  { value: "none", label: "Não se aplica" },
  { value: "stale", label: "Tratativa ML" },
];

const statusOptions = [
  { value: "", label: "Todos os status" },
  { value: "opened", label: "Aberto" },
  { value: "closed", label: "Fechado" },
];

const tipoColor: Record<string, string> = {
  return: "blue",
  returns: "blue",
  cancel_sale: "red",
  cancel_purchase: "red",
  mediations: "orange",
  ml_case: "gold",
  change: "cyan",
  service: "geekblue",
};
const stageColor: Record<string, string> = {
  claim: "green",
  dispute: "volcano",
  recontact: "purple",
  none: "default",
  stale: "gold",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionLabel(action: string | undefined) {
  if (action === "send_message_to_complainant") return "Enviar mensagem";
  if (action === "send_message_to_mediator") return "Enviar ao mediador";
  if (action === "refund") return "Reembolsar";
  if (action === "open_dispute") return "Abrir disputa";
  if (action === "allow_return" || action === "allow_return_label")
    return "Gerar devolução";
  if (action === "allow_partial_refund") return "Reembolso parcial";
  if (action === "send_tracking_number") return "Enviar rastreio";
  if (action === "send_potential_shipping") return "Promessa de envio";
  if (action === "add_shipping_evidence") return "Evidência de envio";
  if (action === "return_review") return "Revisar devolução";
  if (action === "send_attachments") return "Enviar anexos";
  return action || "—";
}

function getMlOrderUrl(orderId: number) {
  return `https://www.mercadolivre.com.br/vendas/${orderId}/detalhe`;
}

function matchesTipoFilter(tipo: MLClaimType | null, filtro: string) {
  if (!filtro) return true;
  if (filtro === "returns") return tipo === "return" || tipo === "returns";
  return tipo === filtro;
}

export default function ReclamacoesPage() {
  function openOrderInMl(orderId: number) {
    window.open(getMlOrderUrl(orderId), "_blank", "noopener,noreferrer");
  }

  const [data, setData] = useState<Reclamacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [precisaReconectar, setPrecisaReconectar] = useState(false);
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<[string | null, string | null]>([
    null,
    null,
  ]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    setPrecisaReconectar(false);
    try {
      const res = await fetch("/api/ml/reclamacoes", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok)
        throw new Error(json.erro || "Falha ao carregar reclamações.");
      if (json.precisaReconectar || json.conectado === false) {
        setPrecisaReconectar(true);
        setData([]);
        setError(json.erro || "Mercado Livre desconectado.");
        return;
      }
      setData(Array.isArray(json.items) ? json.items : []);
    } catch (err: any) {
      setError(err?.message || "Falha ao carregar reclamações.");
      setData([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    return data.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        const haystack = [
          r.id,
          r.pedido,
          r.cliente,
          r.item_title,
          r.item_id,
          r.reason_id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (!matchesTipoFilter(r.tipo, tipoFilter)) return false;
      if (stageFilter && r.stage !== stageFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      const date = r.data ? new Date(r.data) : null;
      if (dateRange[0] && (!date || date < new Date(dateRange[0])))
        return false;
      if (dateRange[1]) {
        const end = new Date(dateRange[1]);
        end.setHours(23, 59, 59, 999);
        if (!date || date > end) return false;
      }
      return true;
    });
  }, [data, dateRange, search, stageFilter, statusFilter, tipoFilter]);

  const columns: TableProps<Reclamacao>["columns"] = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 110,
      sorter: (a, b) => a.id - b.id,
      render: (id: number, record) => (
        <a
          href={getMlOrderUrl(record.pedido)}
          target="_blank"
          rel="noopener noreferrer"
          title="Abre detalhe da venda no Mercado Livre, onde a reclamação fica acessível no histórico de problemas."
          style={{
            fontFamily: "monospace",
            color: "#1677ff",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {id}
        </a>
      ),
    },
    {
      title: "Pedido",
      dataIndex: "pedido",
      key: "pedido",
      width: 150,
      sorter: (a, b) => a.pedido - b.pedido,
      render: (id: number) => (
        <a
          href={getMlOrderUrl(id)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: "monospace",
            color: "#1677ff",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {id}
        </a>
      ),
    },
    {
      title: "Cliente",
      dataIndex: "cliente",
      key: "cliente",
      width: 160,
      sorter: (a, b) => a.cliente.localeCompare(b.cliente),
    },
    {
      title: "Produto",
      dataIndex: "item_title",
      key: "item_title",
      ellipsis: true,
      render: (title: string | null) => title || "—",
    },
    {
      title: "Tipo",
      dataIndex: "tipo",
      key: "tipo",
      width: 130,
      sorter: (a, b) =>
        String(a.tipo || "").localeCompare(String(b.tipo || "")),
      render: (_: string, record) => (
        <Tag color={tipoColor[record.tipo || ""] || "default"}>
          {record.tipo_label}
        </Tag>
      ),
    },
    {
      title: "Estágio",
      dataIndex: "stage",
      key: "stage",
      width: 120,
      sorter: (a, b) =>
        String(a.stage || "").localeCompare(String(b.stage || "")),
      render: (_: string, record) => (
        <Tag color={stageColor[record.stage || ""] || "default"}>
          {record.stage_label}
        </Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 110,
      sorter: (a, b) =>
        String(a.status || "").localeCompare(String(b.status || "")),
      render: (_: string, record) => (
        <Tag color={record.status === "opened" ? "orange" : "default"}>
          {record.status_label}
        </Tag>
      ),
    },
    {
      title: "Atualizado",
      dataIndex: "atualizado_em",
      key: "atualizado_em",
      width: 160,
      sorter: (a, b) =>
        new Date(a.atualizado_em || a.data || 0).getTime() -
        new Date(b.atualizado_em || b.data || 0).getTime(),
      render: (date: string | null) => formatDate(date),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ color: "#e0e0e0", marginBottom: 16 }}>
        Reclamações - Mercado Livre
      </Title>

      <div
        style={{
          background: "#141414",
          border: "1px solid #303030",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              placeholder="Buscar (ID, pedido, cliente, produto)"
              prefix={<SearchOutlined />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 280 }}
              allowClear
            />
          </Col>
          <Col>
            <Select
              placeholder="Tipo"
              value={tipoFilter || undefined}
              onChange={(value) => setTipoFilter(value || "")}
              options={tipoOptions}
              style={{ width: 150 }}
              allowClear
              onClear={() => setTipoFilter("")}
            />
          </Col>
          <Col>
            <Select
              placeholder="Estágio"
              value={stageFilter || undefined}
              onChange={(value) => setStageFilter(value || "")}
              options={stageOptions}
              style={{ width: 150 }}
              allowClear
              onClear={() => setStageFilter("")}
            />
          </Col>
          <Col>
            <Select
              placeholder="Status"
              value={statusFilter || undefined}
              onChange={(value) => setStatusFilter(value || "")}
              options={statusOptions}
              style={{ width: 140 }}
              allowClear
              onClear={() => setStatusFilter("")}
            />
          </Col>
          <Col>
            <RangePicker
              onChange={(_, dates) =>
                setDateRange([dates[0] || null, dates[1] || null])
              }
              format="DD/MM/YYYY"
              style={{ width: 230 }}
            />
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              Atualizar
            </Button>
          </Col>
        </Row>
      </div>

      {error && (
        <Alert
          type={precisaReconectar ? "warning" : "error"}
          showIcon
          message={error}
          action={
            precisaReconectar ? (
              <Button type="primary" href="/api/integracao/ml/connect">
                Reconectar ML
              </Button>
            ) : undefined
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <div
        style={{
          background: "#141414",
          border: "1px solid #303030",
          borderRadius: 8,
          padding: 16,
        }}
      >
        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <Spin />
          </div>
        ) : (
          <ResizableTable<Reclamacao>
            storageKey="reclamacoes"
            dataSource={filtered}
            columns={columns}
            rowKey="id"
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            expandable={{
              expandedRowRender: (record) => (
                <div style={{ padding: "4px 0" }}>
                  <Row gutter={[16, 12]}>
                    <Col xs={24} md={12}>
                      <Text style={{ color: "#808080", fontSize: 12 }}>
                        Produto
                      </Text>
                      <div style={{ color: "#e0e0e0" }}>
                        {record.item_title || "—"}
                      </div>
                      <Text style={{ color: "#666", fontSize: 12 }}>
                        {record.item_id || ""}
                      </Text>
                    </Col>
                    <Col xs={24} md={12}>
                      <Text style={{ color: "#808080", fontSize: 12 }}>
                        Motivo / Entidades
                      </Text>
                      <div style={{ color: "#e0e0e0" }}>
                        {record.reason_detail || record.reason_name || "—"}
                      </div>
                      <Text style={{ color: "#666", fontSize: 12 }}>
                        {record.reason_id || ""}
                        {record.reason_flow ? ` · ${record.reason_flow}` : ""}
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        {(
                          record.related_entities_label ||
                          record.related_entities
                        ).map((entity, index) => (
                          <Tag key={`${entity}-${index}`}>{entity}</Tag>
                        ))}
                      </div>
                    </Col>
                    <Col xs={24} md={12}>
                      <Text style={{ color: "#808080", fontSize: 12 }}>
                        Ações disponíveis para vendedor
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        {record.available_actions.length > 0 ? (
                          <Space wrap>
                            {record.available_actions.map((action) => (
                              <Button
                                key={action.action}
                                size="small"
                                type={action.mandatory ? "primary" : "default"}
                                danger={Boolean(action.mandatory)}
                                onClick={() => openOrderInMl(record.pedido)}
                                title="Ação disponível no claim. Endpoint de execução não foi confirmado na documentação/API do Mercado Livre; abrir venda no ML é caminho seguro e real para executar manualmente."
                              >
                                {actionLabel(action.action)}
                              </Button>
                            ))}
                          </Space>
                        ) : (
                          <Text style={{ color: "#666" }}>
                            Nenhuma ação retornada
                          </Text>
                        )}
                      </div>
                      {record.available_actions.length > 0 && (
                        <div
                          style={{ color: "#666", fontSize: 12, marginTop: 8 }}
                        >
                          Execução direta via API não documentada de forma
                          operacional pelo ML. Botões abrem detalhe da venda
                          para ação manual real.
                        </div>
                      )}
                    </Col>
                    <Col xs={24} md={12}>
                      <Text style={{ color: "#808080", fontSize: 12 }}>
                        Quantidade reclamada / resolução
                      </Text>
                      <div style={{ color: "#e0e0e0" }}>
                        {record.claimed_quantity ?? "—"} ·{" "}
                        {record.resolution ? "Com resolução" : "Sem resolução"}
                      </div>
                    </Col>
                  </Row>

                  <div style={{ marginTop: 16 }}>
                    <Text style={{ color: "#808080", fontSize: 12 }}>
                      Mensagens retornadas pela API
                    </Text>
                    {record.messages.length > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                          marginTop: 8,
                        }}
                      >
                        {record.messages.map((message, index) => (
                          <div
                            key={message.id || index}
                            style={{
                              background: "#1a1a1a",
                              padding: "10px 14px",
                              borderRadius: 8,
                              border: "1px solid #303030",
                            }}
                          >
                            <Text
                              style={{
                                color: "#a0a0a0",
                                fontWeight: 600,
                                fontSize: 12,
                              }}
                            >
                              {message.sender || "—"}
                            </Text>
                            <Text
                              style={{
                                color: "#666",
                                fontSize: 11,
                                marginLeft: 12,
                              }}
                            >
                              {formatDate(message.date_created)}
                            </Text>
                            <br />
                            <Text style={{ color: "#c0c0c0", fontSize: 13 }}>
                              {message.text || "—"}
                            </Text>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: "#666", marginTop: 4 }}>
                        Nenhuma mensagem retornada pela API para esta
                        reclamação.
                      </div>
                    )}
                  </div>
                </div>
              ),
              rowExpandable: () => true,
            }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `${total} reclamações`,
            }}
            scroll={{ x: 1200 }}
            style={{ background: "transparent" }}
            size="small"
          />
        )}
      </div>
    </div>
  );
}
