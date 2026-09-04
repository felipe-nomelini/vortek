"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
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
import type { MessageInstance } from "antd/es/message/interface";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/fiscal/cnpj.js";
import { configuracoesCardStyle, configuracoesInputStyle } from "./styles";

const { Text, Title } = Typography;

const stateOptions = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
].map((state) => ({ value: state, label: state }));

type CompanyFormValues = {
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  endereco_fiscal: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    municipio: string;
    uf: string;
    codigo_ibge: string;
  };
};

type CompanyDto = CompanyFormValues & {
  id: string;
  endereco_legado: string | null;
  endereco_estruturado: boolean;
};

type PricingTaxContext = {
  appliedRate: number | null;
  estimatedRate: number | null;
  rbt12: number | null;
  bracket: number | null;
  warning: string | null;
};

type EnvironmentStatus = {
  code: 1 | 2 | null;
  label: string;
  valid: boolean;
};

type FiscalFormValues = {
  simples_inicio_atividade: string;
  simples_aliquota_confirmada_percentual: number | null;
  simples_aliquota_confirmada_em: string | null;
};

type FiscalDto = FiscalFormValues & {
  pricing_tax_context: PricingTaxContext;
  emissor: {
    provider: string;
    emission_environment: EnvironmentStatus;
    return_environment: EnvironmentStatus;
    strict_validation: boolean;
    allowed_cfops: string[];
  };
};

const emptyCompany: CompanyFormValues = {
  nome: "",
  cnpj: "",
  email: "",
  telefone: "",
  endereco_fiscal: {
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    municipio: "",
    uf: "",
    codigo_ibge: "",
  },
};

function companyFormValues(data: CompanyDto | null): CompanyFormValues {
  if (!data) return emptyCompany;
  return {
    nome: data.nome || "",
    cnpj: formatCnpj(data.cnpj),
    email: data.email || "",
    telefone: data.telefone || "",
    endereco_fiscal: {
      ...emptyCompany.endereco_fiscal,
      ...(data.endereco_fiscal || {}),
    },
  };
}

function money(value: number | null) {
  if (value === null) return "Indisponível";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function percent(value: number | null) {
  if (value === null) return "Indisponível";
  return `${(value * 100).toFixed(4).replace(".", ",")}%`;
}

export default function EmpresaTab({
  messageApi,
}: {
  messageApi: MessageInstance;
}) {
  const [companyForm] = Form.useForm<CompanyFormValues>();
  const [fiscalForm] = Form.useForm<FiscalFormValues>();
  const [modal, modalContextHolder] = Modal.useModal();
  const [company, setCompany] = useState<CompanyDto | null>(null);
  const [fiscal, setFiscal] = useState<FiscalDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingFiscal, setSavingFiscal] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [companyResponse, fiscalResponse] = await Promise.all([
          fetch("/api/configuracoes/empresa"),
          fetch("/api/configuracoes/fiscal"),
        ]);
        const [companyData, fiscalData] = await Promise.all([
          companyResponse.json().catch(() => null),
          fiscalResponse.json().catch(() => ({})),
        ]);
        if (!companyResponse.ok) {
          throw new Error(companyData?.erro || "Falha ao carregar a empresa");
        }
        if (!fiscalResponse.ok) {
          throw new Error(fiscalData?.erro || "Falha ao carregar a tributação");
        }
        setCompany(companyData);
        setFiscal(fiscalData);
        companyForm.setFieldsValue(companyFormValues(companyData));
        fiscalForm.setFieldsValue({
          simples_inicio_atividade: fiscalData.simples_inicio_atividade,
          simples_aliquota_confirmada_percentual:
            fiscalData.simples_aliquota_confirmada_percentual,
          simples_aliquota_confirmada_em:
            fiscalData.simples_aliquota_confirmada_em,
        });
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : "Falha ao carregar o cadastro",
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [companyForm, fiscalForm, messageApi]);

  const persistCompany = async (values: CompanyFormValues) => {
    setSavingCompany(true);
    try {
      const response = await fetch("/api/configuracoes/empresa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao salvar a empresa");
        return;
      }
      setCompany(data);
      companyForm.setFieldsValue(companyFormValues(data));
      messageApi.success("Cadastro da empresa salvo");
    } catch {
      messageApi.error("Falha ao salvar a empresa");
    } finally {
      setSavingCompany(false);
    }
  };

  const saveCompany = (values: CompanyFormValues) => {
    const controlledChanged = !company
      || normalizeCnpj(values.cnpj) !== normalizeCnpj(company.cnpj)
      || JSON.stringify(values.endereco_fiscal) !== JSON.stringify(company.endereco_fiscal);
    if (!controlledChanged) {
      void persistCompany(values);
      return;
    }
    modal.confirm({
      title: "Confirmar alteração fiscal",
      content:
        "CNPJ, UF e município identificam a empresa nos fluxos fiscais. Confirme os dados antes de salvar.",
      okText: "Confirmar e salvar",
      cancelText: "Revisar",
      onOk: () => persistCompany(values),
    });
  };

  const persistFiscal = async (values: FiscalFormValues) => {
    setSavingFiscal(true);
    try {
      const response = await fetch("/api/configuracoes/fiscal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          simples_aliquota_confirmada_em:
            values.simples_aliquota_confirmada_em || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        messageApi.error(data?.erro || "Falha ao salvar a tributação");
        return;
      }
      setFiscal(data);
      fiscalForm.setFieldsValue({
        simples_inicio_atividade: data.simples_inicio_atividade,
        simples_aliquota_confirmada_percentual:
          data.simples_aliquota_confirmada_percentual,
        simples_aliquota_confirmada_em:
          data.simples_aliquota_confirmada_em,
      });
      messageApi.success("Tributação salva");
    } catch {
      messageApi.error("Falha ao salvar a tributação");
    } finally {
      setSavingFiscal(false);
    }
  };

  const saveFiscal = (values: FiscalFormValues) => {
    modal.confirm({
      title: "Confirmar parâmetros tributários",
      content:
        "Esses valores alteram a alíquota usada na formação de preços. O PGDAS continua sendo a fonte fiscal oficial.",
      okText: "Confirmar e salvar",
      cancelText: "Revisar",
      onOk: () => persistFiscal(values),
    });
  };

  return (
    <Spin spinning={loading}>
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div>
          <Title level={5} style={{ color: "#f5f5f5", margin: 0 }}>
            Empresa e cadastro fiscal
          </Title>
          <Text style={{ color: "#858585" }}>
            Identidade da Bentevi usada pela operação, precificação e emissão fiscal.
          </Text>
        </div>

        {!company?.endereco_estruturado && company?.endereco_legado ? (
          <Alert
            type="warning"
            showIcon
            message="Endereço antigo preservado"
            description={`Preencha o endereço estruturado antes de substituir o cadastro legado: ${company.endereco_legado}`}
          />
        ) : null}

        <Form<CompanyFormValues>
          form={companyForm}
          layout="vertical"
          initialValues={emptyCompany}
          onFinish={saveCompany}
          requiredMark="optional"
        >
          <Card
            title="Identidade e contato"
            style={{ ...configuracoesCardStyle, marginBottom: 16 }}
          >
            <Row gutter={[16, 0]}>
              <Col xs={24} lg={12}>
                <Form.Item
                  name="nome"
                  label="Nome comercial"
                  rules={[{ required: true, message: "Informe o nome da empresa" }]}
                >
                  <Input style={configuracoesInputStyle} maxLength={200} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item
                  name="cnpj"
                  label="CNPJ"
                  rules={[
                    { required: true, message: "Informe o CNPJ" },
                    {
                      validator: (_, value) =>
                        isValidCnpj(value)
                          ? Promise.resolve()
                          : Promise.reject(new Error("CNPJ inválido")),
                    },
                  ]}
                >
                  <Input
                    style={configuracoesInputStyle}
                    maxLength={18}
                    onChange={(event) =>
                      companyForm.setFieldValue("cnpj", formatCnpj(event.target.value))
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item
                  name="email"
                  label="E-mail"
                  rules={[{ type: "email", message: "E-mail inválido" }]}
                >
                  <Input style={configuracoesInputStyle} maxLength={320} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item name="telefone" label="Telefone">
                  <Input style={configuracoesInputStyle} maxLength={40} />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card
            title="Endereço fiscal"
            style={{ ...configuracoesCardStyle, marginBottom: 16 }}
          >
            <Row gutter={[16, 0]}>
              <Col xs={24} md={8}>
                <Form.Item
                  name={["endereco_fiscal", "cep"]}
                  label="CEP"
                  rules={[{ required: true, pattern: /^\d{8}$/, message: "Use 8 dígitos" }]}
                >
                  <Input
                    style={configuracoesInputStyle}
                    maxLength={8}
                    onChange={(event) =>
                      companyForm.setFieldValue(
                        ["endereco_fiscal", "cep"],
                        event.target.value.replace(/\D/g, ""),
                      )
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item
                  name={["endereco_fiscal", "logradouro"]}
                  label="Logradouro"
                  rules={[{ required: true, message: "Informe o logradouro" }]}
                >
                  <Input style={configuracoesInputStyle} maxLength={200} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name={["endereco_fiscal", "numero"]}
                  label="Número"
                  rules={[{ required: true, message: "Informe o número ou S/N" }]}
                >
                  <Input style={configuracoesInputStyle} maxLength={30} />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item name={["endereco_fiscal", "complemento"]} label="Complemento">
                  <Input style={configuracoesInputStyle} maxLength={120} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name={["endereco_fiscal", "bairro"]}
                  label="Bairro"
                  rules={[{ required: true, message: "Informe o bairro" }]}
                >
                  <Input style={configuracoesInputStyle} maxLength={120} />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item
                  name={["endereco_fiscal", "municipio"]}
                  label="Município"
                  rules={[{ required: true, message: "Informe o município" }]}
                >
                  <Input style={configuracoesInputStyle} maxLength={120} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name={["endereco_fiscal", "uf"]}
                  label="UF"
                  rules={[{ required: true, message: "Selecione a UF" }]}
                >
                  <Select options={stateOptions} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name={["endereco_fiscal", "codigo_ibge"]}
                  label="Código do município (IBGE)"
                  rules={[{ required: true, pattern: /^\d{7}$/, message: "Use 7 dígitos" }]}
                  extra="Os dois primeiros dígitos devem corresponder à UF."
                >
                  <Input
                    style={configuracoesInputStyle}
                    maxLength={7}
                    onChange={(event) =>
                      companyForm.setFieldValue(
                        ["endereco_fiscal", "codigo_ibge"],
                        event.target.value.replace(/\D/g, ""),
                      )
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Button
            type="primary"
            htmlType="submit"
            loading={savingCompany}
            style={{ marginBottom: 8 }}
          >
            Salvar empresa
          </Button>
        </Form>

        <Form<FiscalFormValues>
          form={fiscalForm}
          layout="vertical"
          onFinish={saveFiscal}
          requiredMark="optional"
        >
          <Card
            title="Simples Nacional"
            style={{ ...configuracoesCardStyle, marginBottom: 16 }}
          >
            <Row gutter={[16, 0]}>
              <Col xs={24} md={8}>
                <Form.Item
                  name="simples_inicio_atividade"
                  label="Início da atividade"
                  rules={[{ required: true, message: "Informe o início da atividade" }]}
                >
                  <Input type="date" style={configuracoesInputStyle} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="simples_aliquota_confirmada_percentual"
                  label="Alíquota confirmada no PGDAS"
                  extra="Opcional; informe junto com a data da confirmação."
                >
                  <InputNumber
                    suffix="%"
                    min={4}
                    max={99.9999}
                    precision={4}
                    style={{ ...configuracoesInputStyle, width: "100%" }}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="simples_aliquota_confirmada_em"
                  label="Data da confirmação"
                >
                  <Input type="date" style={configuracoesInputStyle} />
                </Form.Item>
              </Col>
            </Row>
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
              <Descriptions.Item label="RBT12">
                {money(fiscal?.pricing_tax_context.rbt12 ?? null)}
              </Descriptions.Item>
              <Descriptions.Item label="Faixa">
                {fiscal?.pricing_tax_context.bracket ?? "Manual"}
              </Descriptions.Item>
              <Descriptions.Item label="Alíquota estimada">
                {percent(fiscal?.pricing_tax_context.estimatedRate ?? null)}
              </Descriptions.Item>
              <Descriptions.Item label="Alíquota aplicada">
                <Text strong style={{ color: "#ffc400" }}>
                  {percent(fiscal?.pricing_tax_context.appliedRate ?? null)}
                </Text>
              </Descriptions.Item>
            </Descriptions>
            {fiscal?.pricing_tax_context.warning ? (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message={fiscal.pricing_tax_context.warning}
              />
            ) : null}
          </Card>
          <Button
            type="primary"
            htmlType="submit"
            loading={savingFiscal}
            style={{ marginBottom: 8 }}
          >
            Salvar tributação
          </Button>
        </Form>

        <Card title="Saúde do emissor fiscal" style={configuracoesCardStyle}>
          <Descriptions size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="Provedor">
              <Tag color="gold">{fiscal?.emissor.provider || "Brasil NFe"}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Validação estrita">
              <Tag color={fiscal?.emissor.strict_validation ? "green" : "red"}>
                {fiscal?.emissor.strict_validation ? "Ativa" : "Inativa"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Emissão de venda">
              <Tag color={fiscal?.emissor.emission_environment.valid ? "blue" : "red"}>
                {fiscal?.emissor.emission_environment.label || "Não configurado"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Nota de devolução">
              <Tag color={fiscal?.emissor.return_environment.valid ? "cyan" : "red"}>
                {fiscal?.emissor.return_environment.label || "Não configurado"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="CFOPs permitidos">
              {fiscal?.emissor.allowed_cfops.join(" e ") || "5120 e 6120"}
            </Descriptions.Item>
            <Descriptions.Item label="Fuso operacional">
              America/Sao_Paulo
            </Descriptions.Item>
          </Descriptions>
          <Text style={{ color: "#777", display: "block", marginTop: 12 }}>
            Provedor, ambientes, validação e CFOPs são contratos protegidos e não podem ser alterados nesta tela.
          </Text>
        </Card>
      </Space>
    </Spin>
  );
}
