"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  InputNumber,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { MessageInstance } from "antd/es/message/interface";
import { calculateSuggestedPrice } from "@/services/pricing";
import type { PricingCostTier } from "@/lib/commercial-pricing";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";

const { Text, Title } = Typography;

type CostTierForm = {
  position: number;
  maxCost: number | null;
  marginPercent: number;
  minProfit: number;
};

type QuantityTierForm = {
  position: number;
  minPurchaseUnit: number;
  discountPercent: number;
};

type CommercialFormValues = {
  mlFeeFallbackPercent: number;
  unspecifiedShippingCost: number;
  inactiveCostThreshold: number;
  costTiers: CostTierForm[];
  quantityPricingTiers: QuantityTierForm[];
};

type TaxContext = {
  appliedRate: number | null;
  source: "estimated" | "confirmed" | "protected" | "unavailable";
  referenceMonth: string;
  warning: string | null;
};

type CommercialDto = CommercialFormValues & { pricingTaxContext: TaxContext };

const inputStyle = { ...configuracoesInputStyle, width: "100%" };

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function rateLabel(context: TaxContext | null) {
  if (!context || context.appliedRate === null) return "Indisponível";
  return `${(context.appliedRate * 100).toFixed(4).replace(".", ",")}%`;
}

function costRangeLabel(tiers: CostTierForm[], index: number) {
  const previous = index === 0 ? 0 : Number(tiers[index - 1]?.maxCost || 0);
  const current = tiers[index];
  if (!current || current.maxCost === null) return `Acima de ${money(previous)}`;
  return index === 0
    ? `Até ${money(current.maxCost)}`
    : `De ${money(previous + 0.01)} até ${money(current.maxCost)}`;
}

export default function ComercialTab({ messageApi }: { messageApi: MessageInstance }) {
  const [form] = Form.useForm<CommercialFormValues>();
  const [modal, modalContextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [taxContext, setTaxContext] = useState<TaxContext | null>(null);
  const [simulatorCost, setSimulatorCost] = useState(250);
  const [simulatorShipping, setSimulatorShipping] = useState(30);
  const [simulatorFee, setSimulatorFee] = useState(15);
  const watchedValues = Form.useWatch([], form);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/configuracoes/comercial", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.erro || "Falha ao carregar parâmetros comerciais");
        const dto = data as CommercialDto;
        form.setFieldsValue(dto);
        setTaxContext(dto.pricingTaxContext);
        setSimulatorShipping(dto.unspecifiedShippingCost);
        setSimulatorFee(dto.mlFeeFallbackPercent);
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "Falha ao carregar parâmetros comerciais");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [form, messageApi]);

  const simulation = useMemo(() => {
    const tiers = watchedValues?.costTiers;
    const taxRate = taxContext?.appliedRate;
    if (!tiers?.length || taxRate === null || taxRate === undefined) return null;
    try {
      const costTiers: PricingCostTier[] = [...tiers]
        .sort((left, right) => left.position - right.position)
        .map((tier) => ({
          position: tier.position,
          maxCost: tier.maxCost,
          margin: tier.marginPercent / 100,
          minProfit: tier.minProfit,
        }));
      return calculateSuggestedPrice({
        cost: Number(simulatorCost || 0),
        shipping: Number(simulatorShipping || 0),
        mlFee: Number(simulatorFee || 0) / 100,
        taxRate,
        costTiers,
      });
    } catch {
      return null;
    }
  }, [simulatorCost, simulatorFee, simulatorShipping, taxContext, watchedValues]);

  const persist = async (values: CommercialFormValues) => {
    setSaving(true);
    try {
      const normalized = {
        ...values,
        costTiers: values.costTiers.map((tier, index) => ({ ...tier, position: index + 1 })),
        quantityPricingTiers: values.quantityPricingTiers.map((tier, index) => ({ ...tier, position: index + 1 })),
      };
      const response = await fetch("/api/configuracoes/comercial", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao salvar parâmetros comerciais");
        return;
      }
      form.setFieldsValue(data);
      setTaxContext(data.pricingTaxContext);
      messageApi.success("Parâmetros comerciais salvos");
    } catch {
      messageApi.error("Falha ao salvar parâmetros comerciais");
    } finally {
      setSaving(false);
    }
  };

  const save = (values: CommercialFormValues) => {
    modal.confirm({
      title: "Confirmar política comercial",
      content: "Os novos valores serão usados somente nos próximos cálculos. Produtos e anúncios existentes não serão recalculados nem publicados agora.",
      okText: "Confirmar e salvar",
      cancelText: "Revisar",
      onOk: () => persist(values),
    });
  };

  const currentCostTiers = watchedValues?.costTiers || [];

  return (
    <Spin spinning={loading}>
      {modalContextHolder}
      <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <Title level={5} style={{ color: "#f5f5f5", margin: 0 }}>
              Comercial e precificação
            </Title>
            <Text style={{ color: "#858585" }}>
              Fonte única das margens, proteções de custo e política mínima de atacado.
            </Text>
          </div>

          <Alert
            type="info"
            showIcon
            message="Aplicação controlada"
            description="Salvar altera somente os próximos cálculos. Nenhum preço atual, anúncio ou produto será modificado automaticamente."
          />

          <Card style={configuracoesCardStyle}>
            <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 16 }}>
              <Title level={5} style={{ color: "#f5f5f5", margin: 0 }}>Estratégia por custo</Title>
              <Text type="secondary">O maior resultado entre margem e lucro mínimo define o preço sugerido.</Text>
            </Space>
            <Form.List name="costTiers">
              {(fields) => (
                <Row gutter={[12, 12]}>
                  {fields.map((field, index) => (
                    <Col xs={24} xl={8} key={field.key}>
                      <Card size="small" style={{ background: "#191919", borderColor: "#353535", height: "100%" }}>
                        <Text strong style={{ color: "#ffc400", display: "block", marginBottom: 12 }}>
                          Faixa {index + 1} · {costRangeLabel(currentCostTiers, index)}
                        </Text>
                        <Form.Item name={[field.name, "position"]} hidden><InputNumber /></Form.Item>
                        {index < 2 && (
                          <Form.Item name={[field.name, "maxCost"]} label="Custo máximo" rules={[{ required: true, message: "Informe o limite" }]}>
                            <InputNumber min={0.01} precision={2} prefix="R$" style={inputStyle} />
                          </Form.Item>
                        )}
                        <Row gutter={10}>
                          <Col span={12}>
                            <Form.Item name={[field.name, "marginPercent"]} label="Margem" rules={[{ required: true }]}>
                              <InputNumber min={0.01} max={99.99} precision={2} suffix="%" style={inputStyle} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name={[field.name, "minProfit"]} label="Lucro mínimo" rules={[{ required: true }]}>
                              <InputNumber min={0} precision={2} prefix="R$" style={inputStyle} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}
            </Form.List>
          </Card>

          <Card style={configuracoesCardStyle}>
            <Title level={5} style={{ color: "#f5f5f5", marginTop: 0 }}>Proteções e valores padrão</Title>
            <Row gutter={[16, 8]}>
              <Col xs={24} md={8}>
                <Form.Item name="mlFeeFallbackPercent" label="Taxa ML quando ausente" rules={[{ required: true }]} extra="A taxa observada no anúncio sempre prevalece, inclusive quando é 0%.">
                  <InputNumber min={0} max={99.99} precision={2} suffix="%" style={inputStyle} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="unspecifiedShippingCost" label="Frete não informado" rules={[{ required: true }]} extra="Usado apenas no modo not_specified, quando não existe cotação real.">
                  <InputNumber min={0} precision={2} prefix="R$" style={inputStyle} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="inactiveCostThreshold" label="Limite de elegibilidade da oferta" rules={[{ required: true }]} extra="Ofertas acima do limite ficam inelegíveis; o status do produto continua sendo uma decisão manual.">
                  <InputNumber min={0.01} precision={2} prefix="R$" style={inputStyle} />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card style={configuracoesCardStyle}>
            <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 16 }}>
              <Title level={5} style={{ color: "#f5f5f5", margin: 0 }}>Preço por quantidade</Title>
              <Text type="secondary">De 1 a 5 faixas. A recomendação válida do ML prevalece; estes percentuais são o piso local e o fallback da resposta 204.</Text>
            </Space>
            <Form.List name="quantityPricingTiers">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  {fields.map((field, index) => (
                    <Row gutter={12} align="middle" key={field.key}>
                      <Col flex="42px"><Tag color="gold">{index + 1}</Tag></Col>
                      <Col xs={10} md={8}>
                        <Form.Item name={[field.name, "position"]} hidden><InputNumber /></Form.Item>
                        <Form.Item name={[field.name, "minPurchaseUnit"]} label="Quantidade mínima" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                          <InputNumber min={1} max={100} precision={0} style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col xs={10} md={8}>
                        <Form.Item name={[field.name, "discountPercent"]} label="Desconto mínimo" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                          <InputNumber min={0.01} max={99.99} precision={2} suffix="%" style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col flex="48px">
                        <Button aria-label={`Remover faixa ${index + 1}`} icon={<DeleteOutlined />} disabled={fields.length === 1} onClick={() => remove(field.name)} />
                      </Col>
                    </Row>
                  ))}
                  <Button icon={<PlusOutlined />} disabled={fields.length >= 5} onClick={() => add({ position: fields.length + 1, minPurchaseUnit: 1, discountPercent: 1 })}>
                    Adicionar faixa
                  </Button>
                </Space>
              )}
            </Form.List>
          </Card>

          <Card style={{ ...configuracoesCardStyle, borderColor: "#5c4800" }}>
            <Row gutter={[20, 16]} align="middle">
              <Col xs={24} xl={15}>
                <Title level={5} style={{ color: "#f5f5f5", marginTop: 0 }}>Simulador</Title>
                <Row gutter={12}>
                  <Col xs={24} sm={8}><Text type="secondary">Custo</Text><InputNumber value={simulatorCost} onChange={(value) => setSimulatorCost(Number(value || 0))} min={0} precision={2} prefix="R$" style={inputStyle} /></Col>
                  <Col xs={24} sm={8}><Text type="secondary">Frete</Text><InputNumber value={simulatorShipping} onChange={(value) => setSimulatorShipping(Number(value || 0))} min={0} precision={2} prefix="R$" style={inputStyle} /></Col>
                  <Col xs={24} sm={8}><Text type="secondary">Taxa ML</Text><InputNumber value={simulatorFee} onChange={(value) => setSimulatorFee(Number(value || 0))} min={0} max={99.99} precision={2} suffix="%" style={inputStyle} /></Col>
                </Row>
                <Divider style={{ borderColor: "#303030", margin: "16px 0 10px" }} />
                <Text type="secondary">Alíquota fiscal aplicada: </Text><Text style={{ color: "#f5f5f5" }}>{rateLabel(taxContext)}</Text>
              </Col>
              <Col xs={24} xl={9}>
                <div style={{ background: "linear-gradient(135deg, #ffc400 0%, #8a6200 100%)", borderRadius: 10, padding: 18, color: "#0b0b0b" }}>
                  <Text style={{ color: "#2a2100" }}>Preço sugerido</Text>
                  <div style={{ fontSize: 30, fontWeight: 800 }}>{simulation ? money(simulation.suggestedPrice) : "Indisponível"}</div>
                  <Text style={{ color: "#2a2100" }}>Lucro líquido projetado: {simulation ? money(simulation.netProfit) : "—"}</Text>
                </div>
              </Col>
            </Row>
          </Card>

          {taxContext?.warning && <Alert type="warning" showIcon message={taxContext.warning} />}

          <Button type="primary" htmlType="submit" loading={saving}>
            Salvar política comercial
          </Button>
        </Space>
      </Form>
    </Spin>
  );
}
