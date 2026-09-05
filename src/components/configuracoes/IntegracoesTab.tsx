"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, Modal, Space, Spin, Tag } from "antd";
import { ReloadOutlined, SettingOutlined, ArrowRightOutlined, MailOutlined, BellOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { MessageInstance } from "antd/es/message/interface";
import type { IntegrationConfigDto } from "@/lib/integration-config-dto";
import { INTEGRATION_STATE_LABELS, type IntegrationSummary, type IntegrationTestResult } from "@/lib/integration-configuration";
import styles from "./IntegracoesTab.module.css";
import ConfiguracoesTabHeading from "./ConfiguracoesTabHeading";

type Overview = { integracoes: IntegrationConfigDto[]; resumo: IntegrationSummary[] };
type SecretField = "access_token" | "refresh_token";
const originLabels = { erp: "Cadastro do ERP", runtime: "Servidor", default: "Padrão do provedor", missing: "Não configurado" };
const stateColors = { missing: "default", incomplete: "gold", configured: "default", validated: "green", reconnect: "orange", error: "red" };
const artwork: Record<string, string> = {
  mercadolivre: "mercadolivre.png", dslite: "dslite.png", brasilnfe: "brasilnfe.webp",
  mercadopago: "mercadopago.svg", waha: "waha.svg", github: "github.svg",
  openrouter: "openrouter.png", firecrawl: "firecrawl.png",
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || data.message || "Não foi possível concluir a operação.");
  return data;
}

function SecretCredentialField({ label, value, configured, runtimeConfigured, disabled, onChange, onRemove }: {
  label: string; value: string; configured: boolean; runtimeConfigured: boolean; disabled: boolean;
  onChange: (value: string) => void; onRemove: () => void;
}) {
  return <div className={styles.field}>
    <label>{label}</label>
    <Input.Password aria-label={label} value={value} disabled={disabled} autoComplete="new-password"
      placeholder="Preencha somente para substituir" onChange={(event) => onChange(event.target.value)} />
    <div className={styles.fieldHint}>
      <span>{configured ? "Valor cadastrado no ERP" : "Sem valor cadastrado no ERP"}{runtimeConfigured ? " · Também configurado no servidor" : ""}</span>
      {configured && <Button danger size="small" type="link" disabled={disabled} onClick={onRemove}>Remover valor cadastrado</Button>}
    </div>
  </div>;
}

export default function IntegracoesTab({ messageApi }: { messageApi: MessageInstance }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [url, setUrl] = useState("");
  const [secrets, setSecrets] = useState({ access_token: "", refresh_token: "" });
  const [results, setResults] = useState<Record<string, IntegrationTestResult>>({});
  const selected = data?.resumo.find((item) => item.tipo === selectedId);
  const record = data?.integracoes.find((item) => item.tipo === selectedId);
  const dirty = Boolean(secrets.access_token.trim() || secrets.refresh_token.trim() || url !== (record?.url || ""));
  const busy = saving || testing;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await readResponse(await fetch("/api/integracoes/config", { cache: "no-store" })) as Overview;
      setData(payload);
      return payload;
    } catch {
      setError("Não foi possível carregar as integrações. Os estados não estão disponíveis.");
      return null;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const clearDraft = () => { setSecrets({ access_token: "", refresh_token: "" }); setUrl(record?.url || ""); };
  const open = (item: IntegrationSummary) => {
    setSelectedId(item.tipo);
    setUrl(data?.integracoes.find((row) => row.tipo === item.tipo)?.url || "");
    setSecrets({ access_token: "", refresh_token: "" });
  };
  const close = () => {
    if (busy) return;
    if (dirty) {
      Modal.confirm({ title: "Descartar alterações não salvas?", okText: "Descartar", cancelText: "Continuar editando", onOk: () => { clearDraft(); setSelectedId(null); } });
    } else { clearDraft(); setSelectedId(null); }
  };
  const save = async (values: Record<string, unknown>) => {
    if (!selected || busy) return;
    setSaving(true);
    try {
      await readResponse(await fetch("/api/integracoes/config", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: selected.tipo, values }),
      }));
      setSecrets({ access_token: "", refresh_token: "" });
      setResults({});
      const refreshed = await load();
      setUrl(refreshed?.integracoes.find((row) => row.tipo === selected.tipo)?.url || "");
      messageApi.success("Configuração salva. Execute o teste para verificar a conexão.");
    } catch (err) {
      // The endpoint explicitly reports partial persistence; never retain typed secrets after a failed save.
      setSecrets({ access_token: "", refresh_token: "" });
      setResults({});
      await load();
      messageApi.error(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally { setSaving(false); }
  };
  const saveDraft = () => {
    const values: Record<string, unknown> = {};
    if (url !== (record?.url || "")) values.url = url.trim() || null;
    for (const field of ["access_token", "refresh_token"] as const) if (secrets[field].trim()) values[field] = secrets[field].trim();
    if (Object.keys(values).length) void save(values);
  };
  const remove = (field: SecretField) => Modal.confirm({
    title: "Remover o valor cadastrado no ERP?",
    content: "Se houver uma credencial no servidor, ela poderá continuar sendo utilizada. Isto não revoga a credencial no provedor.",
    okText: "Remover", cancelText: "Cancelar", okButtonProps: { danger: true },
    onOk: () => save({ [field]: null }),
  });
  const testConnection = async () => {
    if (!selected || busy || dirty) return;
    setTesting(true);
    try {
      const response = await fetch(`/api/integracoes/teste/${selected.tipo}`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (typeof result.ok !== "boolean" || typeof result.checkedAt !== "string") throw new Error(result.erro || "Falha ao registrar o diagnóstico.");
      setResults((current) => ({ ...current, [selected.tipo]: result as IntegrationTestResult }));
    } catch (err) {
      setResults((current) => ({ ...current, [selected.tipo]: { ok: false, code: "request_failed", message: err instanceof Error ? err.message : "Falha ao testar.", checkedAt: new Date().toISOString() } }));
    } finally { setTesting(false); }
  };

  return <section className={styles.root} aria-label="Integrações">
    <div className={styles.header}>
      <ConfiguracoesTabHeading title="Integrações" description="Gerencie os serviços conectados à Bentevi." />
      <Button icon={<ReloadOutlined />} loading={loading} disabled={busy || dirty} onClick={() => { setResults({}); void load(); }}>Atualizar estados</Button>
    </div>
    {error && <Alert type="error" showIcon message="Estados indisponíveis" description={error} action={<Button onClick={() => void load()}>Tentar novamente</Button>} />}
    <Spin spinning={loading}>
      {!error && !data && !loading && <Empty description="Nenhuma integração disponível" />}
      {!error && data && <>
        <p className={styles.guidance}><InfoCircleOutlined aria-hidden /> Configuração cadastrada não significa conexão validada. Atualizar estados não testa os serviços.</p>
        <div className={styles.grid}>
        {data.resumo.map((item) => {
          const state = results[item.tipo] ? results[item.tipo].ok ? "validated" : "error" : item.state;
          const runtimeOnly = item.group === "Comunicação" || item.group === "Serviços técnicos";
          return <Card key={item.tipo} className={styles.integrationCard} variant="borderless" data-integration={item.tipo}>
            <div className={styles.cardIdentity}>
              <div className={`${styles.logo} ${item.tipo === "brasilnfe" ? styles.wideLogo : ""}`}>
                {artwork[item.tipo] ? <Image src={`/branding/integrations/${artwork[item.tipo]}`} alt="" width={96} height={48} unoptimized />
                  : item.tipo === "smtp" ? <MailOutlined aria-hidden /> : item.tipo === "push" ? <BellOutlined aria-hidden /> : <span>{item.name.slice(0, 2)}</span>}
              </div>
              <span className={styles.category}>{item.group}</span>
            </div>
            <h3>{item.name}</h3>
            <p className={styles.purpose}>{item.purpose}</p>
            <div className={styles.state}><Tag color={stateColors[state]}>{INTEGRATION_STATE_LABELS[state]}</Tag></div>
            {runtimeOnly ? <p className={styles.management}>Gerenciada no servidor</p>
              : item.restriction && <p className={styles.restriction}>{item.restriction}</p>}
            <div className={styles.cardAction}>
              {item.href ? <Link href={item.href}><Button icon={<ArrowRightOutlined />}>{item.action}</Button></Link>
                : <Button icon={item.editable ? <SettingOutlined /> : <InfoCircleOutlined />} onClick={() => open(item)}>{item.editable ? "Configurar" : "Ver detalhes"}</Button>}
            </div>
          </Card>;
        })}
        </div>
      </>}
    </Spin>
    <Drawer title={selected?.name} open={Boolean(selected)} onClose={close} width={620} destroyOnHidden
      extra={selected?.editable ? <Space><Button disabled={busy} onClick={clearDraft}>Cancelar</Button><Button type="primary" disabled={!dirty || busy || Boolean(error)} loading={saving} onClick={saveDraft}>Salvar alterações</Button></Space> : undefined}>
      {selected && <div className={styles.details}>
        <p>{selected.purpose}</p>
        {selected.restriction && <Alert type="info" showIcon message={selected.restriction} />}
        {record && <Descriptions size="small" column={1} items={[
          { key: "token", label: "Credencial efetiva", children: originLabels[record.effective.tokenOrigin] },
          ...(selected.tipo === "brasilnfe" ? [{ key: "user", label: "User token efetivo", children: originLabels[record.effective.userTokenOrigin] }] : []),
          ...(selected.tipo !== "mercadopago" ? [{ key: "url", label: "URL efetiva", children: record.effective.url || "Não configurada ou não permitida" }, { key: "origin", label: "Origem da URL", children: originLabels[record.effective.urlOrigin] }] : []),
          { key: "updated", label: "Atualização do cadastro", children: record.updated_at ? new Date(record.updated_at).toLocaleString("pt-BR") : "Sem registro" },
          ...(record.fiscalEnvironment ? [{ key: "fiscal", label: "Ambiente de emissão", children: record.fiscalEnvironment }, { key: "return", label: "Ambiente de devolução", children: record.returnEnvironment }] : []),
        ]} />}
        {selected.editable && <>
          {selected.tipo !== "mercadopago" && <div className={styles.field}><label htmlFor="integration-url">URL cadastrada no ERP</label>
            <Input id="integration-url" value={url} disabled={busy} placeholder={selected.tipo === "dslite" ? "https://api.master.dev.dslite.com.br" : "https://api.brasilnfe.com.br/services/"}
              onChange={(event) => setUrl(event.target.value)} />
            <small>{selected.tipo === "dslite" ? "Informe somente a origem, sem /v1. Os testes usam exclusivamente homologação." : "Em branco, utiliza a configuração do servidor ou o padrão do provedor."}</small>
          </div>}
          <SecretCredentialField label={selected.tipo === "brasilnfe" ? "Token da empresa" : "Token de acesso"}
            value={secrets.access_token} configured={Boolean(record?.access_token_configurado)} runtimeConfigured={Boolean(record?.runtime.tokenConfigured)} disabled={busy}
            onChange={(value) => setSecrets((current) => ({ ...current, access_token: value }))} onRemove={() => remove("access_token")} />
          {selected.tipo === "brasilnfe" && <SecretCredentialField label="User token (opcional)"
            value={secrets.refresh_token} configured={Boolean(record?.refresh_token_configurado)} runtimeConfigured={Boolean(record?.runtime.userTokenConfigured)} disabled={busy}
            onChange={(value) => setSecrets((current) => ({ ...current, refresh_token: value }))} onRemove={() => remove("refresh_token")} />}
        </>}
        {["dslite", "brasilnfe"].includes(selected.tipo) && <div>
          <Button loading={testing} disabled={!selected.testable || dirty || saving || Boolean(error)} onClick={testConnection}>Testar conexão em homologação</Button>
          <p className={styles.hint}>{dirty ? "Salve as alterações antes de testar." : "O teste consulta dados; não cria pedidos, não emite notas e não importa documentos."}</p>
          {results[selected.tipo] && <Alert showIcon type={results[selected.tipo].ok ? "success" : "error"} message={results[selected.tipo].message}
            description={`Consulta desta sessão: ${new Date(results[selected.tipo].checkedAt).toLocaleString("pt-BR")}`} />}
        </div>}
        {selected.tipo === "dslite" && <Link href="/configuracoes?tab=operacao" onClick={() => setSelectedId(null)}>Gerenciar feeds por fornecedor em Operação →</Link>}
        {selected.tipo === "mercadopago" && <Alert type="info" message="Esta configuração atende aos relatórios financeiros existentes. Salvar não valida o token nem ativa jobs, pagamentos ou conta-saldo." />}
        {selected.group === "Serviços técnicos" && <Alert type="info" message="Somente estado da configuração" description="Credenciais e parâmetros continuam no servidor. A edição pelo ERP será tratada em uma etapa própria." />}
      </div>}
    </Drawer>
  </section>;
}
