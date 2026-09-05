"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { CheckCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import type { MessageInstance } from "antd/es/message/interface";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";

import ConfiguracoesTabHeading from "./ConfiguracoesTabHeading";

const { Text } = Typography;

type OperationDto = {
  orders: { delayedAfterMinutes: number };
  internalStock: {
    configuredAddressId: string | null;
    configuredZipCode: string | null;
    addresses: Array<{ id: string; label: string; zipCode: string; isDefaultReturn: boolean }>;
    lookup: { available: boolean; error: string | null };
  };
  suppliers: Array<{
    id: string;
    dsliteId: string | null;
    name: string;
    active: boolean;
    retired: boolean;
    externalDropshipping: string;
    crossdocking: string;
    xmlFeedConfigured: boolean;
  }>;
  invariants: string[];
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.erro || "Falha ao processar configuração operacional");
  return data as OperationDto;
}

export default function OperacaoTab({ messageApi }: { messageApi: MessageInstance }) {
  const [modal, modalContextHolder] = Modal.useModal();
  const [data, setData] = useState<OperationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState(60);
  const [addressId, setAddressId] = useState<string>();

  const load = async () => {
    setLoading(true);
    try {
      const dto = await readResponse(await fetch("/api/configuracoes/operacao", { cache: "no-store" }));
      setData(dto);
      setDelayMinutes(dto.orders.delayedAfterMinutes);
      setAddressId(dto.internalStock.configuredAddressId || undefined);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Falha ao carregar configuração operacional");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body: object, success: string) => {
    setSaving(true);
    try {
      const dto = await readResponse(await fetch("/api/configuracoes/operacao", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      setData(dto);
      setDelayMinutes(dto.orders.delayedAfterMinutes);
      setAddressId(dto.internalStock.configuredAddressId || undefined);
      messageApi.success(success);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Falha ao salvar configuração operacional");
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const confirmDelay = () => modal.confirm({
    title: "Alterar prazo de atenção?",
    content: "A nova janela será aplicada à classificação operacional dos pedidos. Nenhum pedido será alterado.",
    okText: "Salvar prazo",
    cancelText: "Cancelar",
    onOk: () => patch({ section: "orders", delayedAfterMinutes: delayMinutes }, "Prazo operacional salvo"),
  });

  const confirmAddress = () => modal.confirm({
    title: "Alterar endereço do estoque interno?",
    content: "A opção será validada novamente na conta Mercado Livre antes de ser salva.",
    okText: "Salvar endereço",
    cancelText: "Cancelar",
    onOk: () => patch({ section: "internal_stock", returnAddressId: addressId }, "Endereço do estoque interno salvo"),
  });

  const openFeed = (supplier: OperationDto["suppliers"][number]) => {
    let xmlUrl = "";
    modal.confirm({
      title: `Feed XML · ${supplier.name}`,
      content: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text type="secondary">A URL é confidencial e nunca volta a ser exibida após o salvamento.</Text>
          <Input.Password
            placeholder={supplier.xmlFeedConfigured ? "Informe uma nova URL para substituir" : "https://app.dslite.com.br/getXMLCrossdocking/..."}
            onChange={(event) => { xmlUrl = event.target.value; }}
          />
          {supplier.xmlFeedConfigured && (
            <Text type="secondary">Para remover o feed, deixe o campo vazio e confirme.</Text>
          )}
        </Space>
      ),
      okText: supplier.xmlFeedConfigured ? "Salvar ou remover" : "Salvar feed",
      cancelText: "Cancelar",
      onOk: () => patch(
        { section: "supplier_feed", supplierId: supplier.id, xmlUrl },
        xmlUrl.trim() ? "Feed XML salvo" : "Feed XML removido",
      ),
    });
  };

  return (
    <Spin spinning={loading || saving}>
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <ConfiguracoesTabHeading title="Produtos, estoque, pedidos e fulfillment"
          description="Parâmetros operacionais controlados e fontes únicas do fluxo de atendimento." />

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={10}>
            <Card style={{ ...configuracoesCardStyle, height: "100%" }} title="Atenção dos pedidos">
              <Text type="secondary">Tempo desde a venda para destacar pendências de preparação.</Text>
              <Space.Compact style={{ width: "100%", marginTop: 16 }}>
                <InputNumber
                  min={5}
                  max={1440}
                  value={delayMinutes}
                  onChange={(value) => setDelayMinutes(Number(value || 60))}
                  addonAfter="minutos"
                  style={{ ...configuracoesInputStyle, width: "100%" }}
                />
                <Button type="primary" onClick={confirmDelay}>Salvar</Button>
              </Space.Compact>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card style={{ ...configuracoesCardStyle, height: "100%" }} title="Estoque interno">
              <Text type="secondary">Somente o endereço padrão de devolução da conta Mercado Livre conectada pode ser usado.</Text>
              {!data?.internalStock.lookup.available && (
                <Alert style={{ marginTop: 12 }} type="warning" showIcon message="Endereços indisponíveis" description={data?.internalStock.lookup.error} />
              )}
              <Space.Compact style={{ width: "100%", marginTop: 16 }}>
                <Select
                  value={addressId}
                  onChange={setAddressId}
                  disabled={!data?.internalStock.lookup.available}
                  placeholder="Selecione o endereço padrão"
                  style={{ width: "100%" }}
                  options={(data?.internalStock.addresses || []).filter((address) => address.isDefaultReturn).map((address) => ({
                    value: address.id,
                    label: `${address.label}${address.zipCode ? ` · CEP ${address.zipCode}` : ""}`,
                  }))}
                />
                <Button type="primary" disabled={!addressId || !data?.internalStock.lookup.available} onClick={confirmAddress}>Salvar</Button>
              </Space.Compact>
            </Card>
          </Col>
        </Row>

        <Card style={configuracoesCardStyle} title="Fornecedores e reconciliação XML">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="O feed XML é auxiliar"
            description="A API DSLite permanece como fonte principal. Salvar não baixa o arquivo nem inicia sincronização."
          />
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            scroll={{ x: 760 }}
            dataSource={data?.suppliers || []}
            columns={[
              { title: "Fornecedor", key: "supplier", render: (_, supplier) => <><Text strong>{supplier.name}</Text><br /><Text type="secondary">DSLite {supplier.dsliteId || "—"}</Text></> },
              { title: "Operação", key: "operation", render: (_, supplier) => supplier.retired ? <Tag color="default">Aposentado</Tag> : supplier.active ? <Tag color="green">Ativo</Tag> : <Tag color="orange">Inativo</Tag> },
              { title: "DSLite", key: "dslite", render: (_, supplier) => <Text type="secondary">Dropshipping: {supplier.externalDropshipping || "—"}<br />Crossdocking: {supplier.crossdocking || "—"}</Text> },
              { title: "Feed XML", key: "feed", render: (_, supplier) => supplier.xmlFeedConfigured ? <Tag icon={<CheckCircleOutlined />} color="green">Configurado</Tag> : <Tag>Não configurado</Tag> },
              { title: "Ação", key: "action", width: 150, render: (_, supplier) => <Button disabled={supplier.retired} onClick={() => openFeed(supplier)}>{supplier.xmlFeedConfigured ? "Alterar feed" : "Configurar feed"}</Button> },
            ]}
          />
        </Card>

        <Card style={configuracoesCardStyle} title={<Space><SafetyCertificateOutlined style={{ color: "#ffc400" }} />Regras protegidas</Space>}>
          <List
            size="small"
            dataSource={data?.invariants || []}
            renderItem={(item) => <List.Item><Text type="secondary">{item}</Text></List.Item>}
          />
        </Card>
      </Space>
    </Spin>
  );
}
