"use client";

import { useEffect, useState } from "react";
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
import { FINAL_PRICE_POLICY } from "@/services/pricing-policy";
import type { ProductPricing } from "@/services/pricing-context";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";

import ConfiguracoesTabHeading from "./ConfiguracoesTabHeading";

const { Text, Title } = Typography;

type QuantityTierForm = {
  position: number;
  minPurchaseUnit: number;
  discountPercent: number;
};

type CommercialFormValues = {
  mlFeeFallbackPercent: number;
  unspecifiedShippingCost: number;
  inactiveCostThreshold: number;
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

export default function ComercialTab({ messageApi }: { messageApi: MessageInstance }) {
  const [form] = Form.useForm<CommercialFormValues>();
  const [modal, modalContextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [taxContext, setTaxContext] = useState<TaxContext | null>(null);
  const [simulatorCost, setSimulatorCost] = useState(250);
  const [simulatorShipping, setSimulatorShipping] = useState(30);
  const [simulatorFee, setSimulatorFee] = useState(15);
  const [simulation, setSimulation] = useState<ProductPricing | null>(null);
  const [simulating, setSimulating] = useState(false);

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

  const simulate = async () => {
    setSimulating(true); setSimulation(null);
    try {
      const response = await fetch("/api/configuracoes/comercial/simular", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costCents: Math.round(simulatorCost * 100),
          shippingCents: Math.round(simulatorShipping * 100), feeRate: simulatorFee / 100, priceCents: null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.erro || "Falha na simulação");
      setSimulation(result.pricing); setTaxContext(result.pricingTaxContext);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "Falha na simulação"); }
    finally { setSimulating(false); }
  };

  const persist = async (values: CommercialFormValues) => {
    setSaving(true);
    try {
      const normalized = {
        ...values,
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


  return (
    <Spin spinning={loading}>
      {modalContextHolder}
      <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <ConfiguracoesTabHeading title="Comercial e precificação"
            description="Política por preço final, fontes econômicas e simulação sem alteração de anúncios." />

          <Alert
            type="info"
            showIcon
            message="Aplicação controlada"
            description="Salvar altera somente os próximos cálculos. Nenhum preço atual, anúncio ou produto será modificado automaticamente."
          />

          <Card style={configuracoesCardStyle} title="Política canônica por preço final">
            <Row gutter={[12, 12]}>
              {FINAL_PRICE_POLICY.bands.map((band, index) => (
                <Col xs={24} xl={8} key={band.id}>
                  <Title level={5}>{["Até R$ 200,00", "R$ 200,01 a R$ 1.000,00", "Acima de R$ 1.000,00"][index]}</Title>
                  <Text>Piso {band.floor.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 2 })} · Alvo {band.target.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 2 })} · Limite {band.limit.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 2 })}</Text>
                </Col>
              ))}
            </Row>
            <p>O piso orienta diagnóstico. O limite não é margem máxima e não autoriza reduzir preços.</p>
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
              <Title level={5} style={{ color: "#f5f5f5", margin: 0 }}>Preço por quantidade — execução bloqueada</Title>
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
                  <Col xs={24} sm={8}><Text type="secondary">Custo</Text><InputNumber value={simulatorCost} disabled={simulating} onChange={(value) => { setSimulatorCost(Number(value || 0)); setSimulation(null); }} min={0} precision={2} prefix="R$" style={inputStyle} /></Col>
                  <Col xs={24} sm={8}><Text type="secondary">Frete</Text><InputNumber value={simulatorShipping} disabled={simulating} onChange={(value) => { setSimulatorShipping(Number(value || 0)); setSimulation(null); }} min={0} precision={2} prefix="R$" style={inputStyle} /></Col>
                  <Col xs={24} sm={8}><Text type="secondary">Taxa ML</Text><InputNumber value={simulatorFee} disabled={simulating} onChange={(value) => { setSimulatorFee(Number(value || 0)); setSimulation(null); }} min={0} max={99.99} precision={2} suffix="%" style={inputStyle} /></Col>
                </Row>
                <Button htmlType="button" onClick={() => void simulate()} loading={simulating} style={{ marginTop: 12 }}>Simular no servidor</Button>
                <Divider style={{ borderColor: "#303030", margin: "16px 0 10px" }} />
                <Text type="secondary">Alíquota fiscal aplicada: </Text><Text style={{ color: "#f5f5f5" }}>{rateLabel(taxContext)}</Text>
              </Col>
              <Col xs={24} xl={9}>
                <div style={{ background: "linear-gradient(135deg, #ffc400 0%, #8a6200 100%)", borderRadius: 10, padding: 18, color: "#0b0b0b" }}>
                  <Text style={{ color: "#2a2100" }}>Preço sugerido</Text>
                  <div style={{ fontSize: 30, fontWeight: 800 }}>{simulation?.target.ok ? money(simulation.target.priceCents / 100) : simulation ? "Indisponível" : "Aguardando simulação"}</div>
                  <Text style={{ color: "#2a2100" }}>Lucro líquido projetado: {simulation?.target.ok ? money(simulation.target.evaluation.memory.resultCents / 100) : "—"}</Text>
                </div>
              </Col>
            </Row>
          </Card>

          {simulation && !simulation.target.ok && <Alert type="warning" showIcon message="Simulação inconclusiva" description={simulation.target.reasons.map(reason => `${reason.field}: ${reason.code}`).join("; ")} />}
          {taxContext?.warning && <Alert type="warning" showIcon message={taxContext.warning} />}

          <Button type="primary" htmlType="submit" loading={saving}>
            Salvar política comercial
          </Button>
        </Space>
      </Form>
    </Spin>
  );
}
