"use client";

import { userSafeMessage } from "@/lib/user-feedback";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Col, Form, InputNumber, Modal, Radio, Row, Space, Spin, Typography } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import {
  commercialConfigurationSchema, commercialSimulationSchema,
  type CommercialConfigurationDto, type CommercialConfigurationInput,
  type CommercialSimulationDto,
} from "@/lib/configuracoes/contracts";
import { isFinalPricePolicy } from "@/services/pricing-policy";
import type { PricingTaxContext } from "@/services/pricing";
import { PricingQuoteSummary } from "@/components/products/LivePricingQuote";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";
import ConfiguracoesTabHeading from "./ConfiguracoesTabHeading";

const { Text, Title } = Typography;
const inputStyle = { ...configuracoesInputStyle, width: "100%" };
const fields = [
  { key: "mlFeeFallbackPercent", label: "Taxa estimada do ML", percent: true },
  { key: "unspecifiedShippingCost", label: "Frete estimado — a combinar", percent: false },
  { key: "inactiveCostThreshold", label: "Limite de custo da oferta", percent: false },
] as const;
const taxLabels: Record<PricingTaxContext["source"], string> = {
  estimated: "Estimada", confirmed: "Confirmada", protected: "Protegida", unavailable: "Indisponível",
};
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const percent = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) + "%";

// Somente os três campos editáveis entram no formulário e no PUT estrito.
function editableValues(dto: CommercialConfigurationInput): CommercialConfigurationInput {
  return { mlFeeFallbackPercent: dto.mlFeeFallbackPercent,
    unspecifiedShippingCost: dto.unspecifiedShippingCost, inactiveCostThreshold: dto.inactiveCostThreshold };
}

export default function ComercialTab({ messageApi }: { messageApi: MessageInstance }) {
  const [form] = Form.useForm<CommercialConfigurationInput>();
  const draft = Form.useWatch([], form) as Partial<CommercialConfigurationInput> | undefined;
  const [modal, modalContextHolder] = Modal.useModal();
  const [saved, setSaved] = useState<CommercialConfigurationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [simulationSource, setSimulationSource] = useState<"saved" | "draft">("saved");
  const [simulatorCost, setSimulatorCost] = useState<number | null>(null);
  const [simulatorPrice, setSimulatorPrice] = useState<number | null>(null);
  const [simulation, setSimulation] = useState<CommercialSimulationDto | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const pendingLoad = useRef<AbortController | null>(null);
  const pendingSimulation = useRef<AbortController | null>(null);
  const pendingSave = useRef(false);

  const invalidateSimulation = useCallback(() => {
    pendingSimulation.current?.abort();
    pendingSimulation.current = null;
    setSimulating(false); setSimulation(null); setSimulationError(null);
  }, []);

  const acceptSaved = useCallback((dto: CommercialConfigurationDto) => {
    // Uma resposta vazia/incompatível não libera gravação nem inventa defaults.
    commercialConfigurationSchema.parse(editableValues(dto));
    if (!isFinalPricePolicy(dto.finalPricePolicy) || !dto.pricingTaxContext
      || !(dto.pricingTaxContext.source in taxLabels)) throw new Error("Resposta comercial inválida");
    form.setFieldsValue(editableValues(dto));
    setSaved(dto);
    invalidateSimulation(); // setFieldsValue não dispara onValuesChange.
  }, [form, invalidateSimulation]);

  const load = useCallback(async () => {
    pendingLoad.current?.abort();
    const controller = new AbortController(); pendingLoad.current = controller;
    setLoading(true); setLoadError(null); invalidateSimulation();
    try {
      const response = await fetch("/api/configuracoes/comercial", { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.erro || "Falha ao carregar parâmetros comerciais");
      if (!controller.signal.aborted) acceptSaved(data);
    } catch {
      if (!controller.signal.aborted) {
        setSaved(null);
        setLoadError("Não foi possível carregar os parâmetros comerciais. Atualize antes de editar ou simular.");
      }
    } finally {
      if (pendingLoad.current === controller) { pendingLoad.current = null; setLoading(false); }
    }
  }, [acceptSaved, invalidateSimulation]);

  useEffect(() => {
    void load();
    return () => { pendingLoad.current?.abort(); pendingSimulation.current?.abort(); };
  }, [load]);

  const dirty = !!saved && fields.some(({ key }) => draft?.[key] !== saved[key]);
  const validDraft = commercialConfigurationSchema.safeParse(draft).success;
  const simulationValues = simulationSource === "saved" ? saved : draft;
  const simulationInput = commercialSimulationSchema.safeParse({
    costCents: simulatorCost === null ? null : Math.round(simulatorCost * 100),
    priceCents: simulatorPrice === null ? null : Math.round(simulatorPrice * 100),
    shippingCents: simulationValues?.unspecifiedShippingCost == null ? null : Math.round(simulationValues.unspecifiedShippingCost * 100),
    feeRate: simulationValues?.mlFeeFallbackPercent == null ? null : simulationValues.mlFeeFallbackPercent / 100,
  });
  const taxContext = saved?.pricingTaxContext;
  const disabled = loading || saving || !saved;

  const refresh = () => {
    if (disabled && !loadError) return;
    if (!dirty) { void load(); return; }
    modal.confirm({ title: "Descartar alterações e atualizar?",
      content: "Os valores ainda não salvos serão substituídos pelos parâmetros do servidor, incluindo o contexto fiscal.",
      okText: "Descartar e atualizar", cancelText: "Continuar editando", onOk: load });
  };

  const simulate = async () => {
    if (disabled || !simulationInput.success) return;
    invalidateSimulation();
    const controller = new AbortController(); pendingSimulation.current = controller;
    setSimulating(true);
    try {
      const response = await fetch("/api/configuracoes/comercial/simular", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal, body: JSON.stringify(simulationInput.data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.erro || "Falha na simulação");
      if (!controller.signal.aborted) setSimulation(result);
    } catch (error) {
      if (!controller.signal.aborted) setSimulationError(error instanceof Error ? error.message : "Falha na simulação");
    } finally {
      if (pendingSimulation.current === controller) { pendingSimulation.current = null; setSimulating(false); }
    }
  };

  const save = async (values: CommercialConfigurationInput) => {
    if (disabled || !dirty) return;
    const parsed = commercialConfigurationSchema.safeParse(editableValues(values));
    if (!parsed.success) { messageApi.error("Revise os parâmetros comerciais"); return; }
    const changes = fields.filter(({ key }) => saved[key] !== parsed.data[key]);
    let alreadyPersisted = false;
    const dialog = modal.confirm({
      title: "Salvar parâmetros comerciais?", width: 580,
      content: <Space direction="vertical" size={12}>
        <Text>Os novos valores serão usados nos próximos cálculos. Salvar não publica anúncios, não reprecifica e não altera produtos.</Text>
        {changes.map(({ key, label, percent: isPercent }) => <div key={key}>
          <Text strong>{label}</Text><br />
          <Text>{isPercent ? percent(saved[key]) : money(saved[key])} → {isPercent ? percent(parsed.data[key]) : money(parsed.data[key])}</Text>
        </div>)}
      </Space>,
      okText: "Confirmar e salvar", cancelText: "Revisar", maskClosable: false,
      onOk: async () => {
        if (pendingSave.current || alreadyPersisted) throw new Error("Gravação já processada");
        pendingSave.current = true; setSaving(true); setSaveWarning(null); invalidateSimulation();
        try {
          const response = await fetch("/api/configuracoes/comercial", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
          });
          const data = await response.json();
          if (!response.ok && data.persisted === true) {
            alreadyPersisted = true;
            const warning = data.erro || "Parâmetros salvos, mas o histórico não pôde ser confirmado";
            setSaveWarning(warning);
            dialog.update({ title: "Salvo com pendência administrativa", content: warning,
              okButtonProps: { disabled: true }, cancelText: "Fechar" });
            await load(); // Somente leitura; jamais repete a gravação parcial.
            throw new Error(warning);
          }
          if (!response.ok) throw new Error(data.erro || "Falha ao salvar parâmetros comerciais");
          acceptSaved(data); alreadyPersisted = true;
          messageApi.success("Parâmetros comerciais salvos");
        } catch (error) {
          if (!alreadyPersisted) messageApi.error(userSafeMessage(error instanceof Error ? error.message : "", "Não foi possível salvar as regras comerciais. Revise os dados e tente novamente."));
          throw error; // Ant Design mantém a confirmação aberta quando a Promise rejeita.
        } finally { pendingSave.current = false; setSaving(false); }
      },
    });
    // O modo await do useModal mantém erros tratados na confirmação, sem rejeição global.
    await dialog;
  };

  return <Spin spinning={loading}>
    {modalContextHolder}
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <ConfiguracoesTabHeading title="Comercial e precificação"
          description="Política vigente, parâmetros operacionais e simulação sem alterar anúncios." />
        <Button onClick={refresh} disabled={loading || saving}>Atualizar dados</Button>
      </div>
      {loadError && <Alert type="error" showIcon message="Configuração indisponível" description={loadError} />}
      {saveWarning && <Alert type="warning" showIcon message="Salvo com pendência administrativa" description={saveWarning} />}

      <Card style={configuracoesCardStyle} title="Política vigente — somente consulta">
        {saved ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Text type="secondary">Política canônica por preço final · {saved.finalPricePolicy.version}</Text>
          <Row gutter={[20, 16]}>
            {saved.finalPricePolicy.bands.map((band, index, bands) => {
              const previousMax = index ? bands[index - 1].maxCents : null;
              const label = band.maxCents === null ? "Acima de " + money(previousMax! / 100)
                : previousMax === null ? "Até " + money(band.maxCents / 100)
                  : money((previousMax + 1) / 100) + " a " + money(band.maxCents / 100);
              return <Col xs={24} xl={8} key={band.id}>
                <Title level={5} style={{ marginTop: 0 }}>{label}</Title>
                <Text>Piso {percent(band.floor * 100)} · Alvo {percent(band.target * 100)} · Limite {percent(band.limit * 100)}</Text>
              </Col>;
            })}
          </Row>
          <Text type="secondary">Piso: mínimo operacional para diagnóstico. Alvo: referência para novos preços. Limite: teto de busca automática, não margem máxima nem ordem de desconto.</Text>
          {taxContext && <div>
            <Text strong>Contexto fiscal: </Text><Text>{taxLabels[taxContext.source]} · Competência {taxContext.referenceMonth} · Alíquota {taxContext.appliedRate === null ? "Indisponível" : percent(taxContext.appliedRate * 100)}</Text>
            <br /><Typography.Link href="/configuracoes?tab=empresa">Gerenciar em Empresa e fiscal</Typography.Link>
          </div>}
          {taxContext?.warning && <Alert type="warning" showIcon message={taxContext.warning} />}
        </Space> : <Text type="secondary">Política e contexto fiscal aguardando carregamento válido.</Text>}
      </Card>

      <Card style={configuracoesCardStyle} title="Parâmetros operacionais">
        <Form form={form} name="commercial-parameters" layout="vertical" onFinish={save} requiredMark={false}
          disabled={disabled} onValuesChange={invalidateSimulation} validateMessages={{ required: "Informe ${label}." }}>
          <Row gutter={[20, 8]}>
            <Col xs={24} md={8}>
              <Form.Item name="mlFeeFallbackPercent" label={fields[0].label}
                rules={[{ required: true }, { type: "number", min: 0, max: 99.99 }]}
                extra="Usada quando a taxa válida do ML estiver ausente. A taxa observada prevalece, inclusive 0%.">
                <InputNumber min={0} max={99.99} precision={2} suffix="%" style={inputStyle} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="unspecifiedShippingCost" label={fields[1].label}
                rules={[{ required: true }, { type: "number", min: 0, max: 10_000_000 }]}
                extra="Usado somente quando o envio fica a combinar e não há uma cotação válida. Não substitui o frete informado pelo Mercado Livre.">
                <InputNumber min={0} max={10_000_000} precision={2} prefix="R$" style={inputStyle} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="inactiveCostThreshold" label={fields[2].label}
                rules={[{ required: true }, { type: "number", min: 0.01, max: 10_000_000 }]}
                extra="Controla elegibilidade da oferta. Não inativa o produto e não participa da fórmula de margem.">
                <InputNumber min={0.01} max={10_000_000} precision={2} prefix="R$" style={inputStyle} />
              </Form.Item>
            </Col>
          </Row>
          <Space direction="vertical" size={12}>
            <Text type={dirty ? "warning" : "secondary"}>{saved ? dirty ? "Há alterações ainda não salvas." : "Exibindo parâmetros salvos." : "Aguardando carregamento."} Salvar afeta somente os próximos cálculos.</Text>
            <Button type="primary" htmlType="submit" loading={saving} disabled={disabled || !dirty || !validDraft}>Salvar parâmetros comerciais</Button>
          </Space>
        </Form>
      </Card>

      <Card style={{ ...configuracoesCardStyle, borderColor: "#5c4800" }} title="Simulador — sem gravação">
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <Radio.Group aria-label="Origem dos parâmetros da simulação" value={simulationSource} disabled={disabled}
            onChange={event => { setSimulationSource(event.target.value); invalidateSimulation(); }}>
            <Radio.Button value="saved">Valores salvos</Radio.Button>
            <Radio.Button value="draft">Alterações do formulário</Radio.Button>
          </Radio.Group>
          <Text type="secondary">Taxa simulada: {simulationValues?.mlFeeFallbackPercent == null ? "—" : percent(simulationValues.mlFeeFallbackPercent)} · Frete simulado: {simulationValues?.unspecifiedShippingCost == null ? "—" : money(simulationValues.unspecifiedShippingCost)}. Entradas hipotéticas, não cotações vivas do ML.</Text>
          <Row gutter={[20, 12]}>
            <Col xs={24} md={8}><label htmlFor="commercial-simulation-cost">Custo (CMV)</label>
              <InputNumber id="commercial-simulation-cost" value={simulatorCost} disabled={disabled}
                onChange={value => { setSimulatorCost(value); invalidateSimulation(); }} min={0} precision={2} prefix="R$" placeholder="Informe o custo" style={inputStyle} />
            </Col>
            <Col xs={24} md={8}><label htmlFor="commercial-simulation-price">Preço de venda para avaliar (opcional)</label>
              <InputNumber id="commercial-simulation-price" value={simulatorPrice} disabled={disabled}
                onChange={value => { setSimulatorPrice(value); invalidateSimulation(); }} min={0.01} precision={2} prefix="R$" placeholder="Sem preço: calcular referências" style={inputStyle} />
            </Col>
          </Row>
          <Button htmlType="button" onClick={() => void simulate()} loading={simulating} disabled={disabled || !simulationInput.success}>Simular no servidor</Button>
          {simulationError && <Alert type="error" showIcon message="Simulação indisponível" description={simulationError} />}
          {simulation && <>
            <Text type="secondary">Fiscal desta simulação: {taxLabels[simulation.pricingTaxContext.source]} · Competência {simulation.pricingTaxContext.referenceMonth}</Text>
            {simulation.pricingTaxContext.warning && <Alert type="warning" showIcon message={simulation.pricingTaxContext.warning} />}
            <PricingQuoteSummary pricing={simulation.pricing} currentLabel="Preço avaliado" presentation="simulation" />
          </>}
        </Space>
      </Card>
    </Space>
  </Spin>;
}
