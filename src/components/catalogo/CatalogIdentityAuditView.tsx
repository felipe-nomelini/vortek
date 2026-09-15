'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Drawer, Input, Modal, Progress, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined, PlayCircleOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { CATALOG_IDENTITY_EXPORTS } from '@/lib/catalog-identity-exports';

const { Title, Text, Paragraph } = Typography;

type Run = {
  id: string; state: string; baseline_filename: string; baseline_count: number; delta_count: number;
  total_count: number; manifest_hash: string | null; created_at: string; snapshot_at: string | null;
  summary: Record<string, unknown>; safety_stop: { code?: string } | null;
};
type Audit = {
  id: number; ml_item_id: string; source_origin: string; sku: string | null; produto_id: string | null;
  catalog_product_id: string | null; identity_state: string | null; reason_code: string | null;
  conflict_type: string | null; risk_tier: string | null; gap_pct: number | null; block_price_write: boolean;
  ml_live_source_available: boolean; comparisons: Array<Record<string, unknown>>; action: string | null;
  action_result: string | null; error: string | null;
};

const stateColor: Record<string, string> = {
  SEM_CONFLITO: 'green', CONFLITO_CONFIRMADO: 'red', PENDENCIA_VALIDACAO: 'orange', INCONCLUSIVO: 'default',
  awaiting_approval: 'gold', approved: 'green', running: 'blue', queued: 'blue', paused: 'red', failed: 'red',
};

export default function CatalogIdentityAuditView() {
  const [messageApi, messageContext] = message.useMessage();
  const [modalApi, modalContext] = Modal.useModal();
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [items, setItems] = useState<Audit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [identityState, setIdentityState] = useState('all');
  const [risk, setRisk] = useState('all');
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<Audit | null>(null);

  const loadRuns = useCallback(async () => {
    const response = await fetch('/api/catalogo/identity-audit', { cache: 'no-store' });
    if (!response.ok) throw new Error('Falha ao carregar auditorias');
    const payload = await response.json();
    setRuns(payload.data || []);
    setSelectedId(current => current || payload.data?.[0]?.id || null);
  }, []);

  const loadRun = useCallback(async () => {
    if (!selectedId) { setRun(null); setItems([]); return; }
    const params = new URLSearchParams({ page: String(page), state: identityState, risk });
    if (search.trim()) params.set('search', search.trim());
    const [runResponse, itemsResponse] = await Promise.all([
      fetch(`/api/catalogo/identity-audit/runs/${selectedId}`, { cache: 'no-store' }),
      fetch(`/api/catalogo/identity-audit/runs/${selectedId}/items?${params}`, { cache: 'no-store' }),
    ]);
    if (!runResponse.ok || !itemsResponse.ok) throw new Error('Falha ao carregar a auditoria');
    const [runPayload, itemsPayload] = await Promise.all([runResponse.json(), itemsResponse.json()]);
    setRun(runPayload.data); setCounters(runPayload.counters || {});
    setItems(itemsPayload.data || []); setTotal(itemsPayload.total || 0);
  }, [identityState, page, risk, search, selectedId]);

  useEffect(() => { void loadRuns().catch(() => messageApi.error('Não foi possível carregar as auditorias.')); }, [loadRuns, messageApi]);
  useEffect(() => { void loadRun().catch(() => messageApi.error('Não foi possível carregar o detalhe.')); }, [loadRun, messageApi]);
  useEffect(() => {
    if (!run || !['queued','running'].includes(run.state)) return;
    const timer = window.setInterval(() => { void Promise.all([loadRuns(), loadRun()]); }, 4_000);
    return () => window.clearInterval(timer);
  }, [loadRun, loadRuns, run]);

  async function importBaseline() {
    const file = files[0]?.originFileObj;
    if (!file) return messageApi.warning('Selecione o CSV ou XLSX original.');
    setBusy(true);
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/catalogo/identity-audit', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Importação recusada');
      setFiles([]); setSelectedId(payload.data.id); await loadRuns();
      messageApi.success('Baseline de 1.550 anúncios importado e congelado.');
    } catch (error) { messageApi.error(error instanceof Error ? error.message : 'Falha na importação.'); }
    finally { setBusy(false); }
  }

  async function startDryRun() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/catalogo/identity-audit/runs/${selectedId}/start`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Dry-run recusado');
      await Promise.all([loadRuns(), loadRun()]);
      messageApi.success(`Dry-run iniciado para ${payload.data.total} anúncios.`);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : 'Falha ao iniciar.'); }
    finally { setBusy(false); }
  }

  function approve() {
    if (!run?.manifest_hash) return;
    let reason = '';
    modalApi.confirm({
      title: 'Aprovar exatamente este manifesto?',
      content: <Space direction="vertical" style={{ width: '100%' }}>
        <Text type="secondary">A aprovação fica inválida se o diff ou fingerprint mudar.</Text>
        <Input.TextArea rows={3} minLength={10} maxLength={500} placeholder="Motivo da aprovação"
          onChange={event => { reason = event.target.value; }} />
      </Space>,
      okText: 'Aprovar manifesto', okButtonProps: { danger: true },
      async onOk() {
        if (reason.trim().length < 10) throw new Error('Informe um motivo com ao menos 10 caracteres.');
        const response = await fetch(`/api/catalogo/identity-audit/runs/${run.id}/approve`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifestHash: run.manifest_hash, reason: reason.trim() }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Aprovação recusada');
        await Promise.all([loadRuns(), loadRun()]);
        messageApi.success('Manifesto aprovado. Nenhuma correção foi executada automaticamente.');
      },
    });
  }

  const processed = Number(counters.processed || 0);
  const progress = run?.total_count ? Math.floor(processed * 100 / run.total_count) : 0;
  const cards = useMemo(() => [
    ['Total', run?.total_count || 0], ['Sem conflito', counters.clear || 0],
    ['Conflitos', counters.conflict || 0], ['Pendências', (counters.validation || 0) + (counters.inconclusive || 0)],
  ], [counters, run]);

  return <div style={{ padding: 24 }}>
    {messageContext}{modalContext}
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div>
        <Title level={2} style={{ marginBottom: 4 }}>Saneamento de identidade do catálogo</Title>
        <Paragraph type="secondary">Identidade antes de preço. O dry-run persiste evidências e bloqueios, sem alterar preço, estoque ou produto ativo.</Paragraph>
      </div>
      <Alert type="warning" showIcon icon={<SafetyCertificateOutlined />} message="Containment P0"
        description="price_to_win é evidência. Qualquer automação sem identidade SEM_CONFLITO falha fechada; preço manual digitado permanece independente." />
      <Card title="1. Importar baseline original">
        <Upload.Dragger accept=".csv,.xlsx" maxCount={1} fileList={files} beforeUpload={() => false}
          onChange={info => setFiles(info.fileList.slice(-1))} disabled={busy}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p>CSV ou XLSX com exatamente 1.550 ml_item_id únicos</p>
        </Upload.Dragger>
        <Button type="primary" style={{ marginTop: 12 }} loading={busy} disabled={!files.length} onClick={() => void importBaseline()}>Importar e calcular checksum</Button>
      </Card>
      <Card title="2. Dry-run e manifesto" extra={<Space>
        <Select style={{ width: 320 }} value={selectedId} placeholder="Selecione uma execução" onChange={value => { setSelectedId(value); setPage(1); }}
          options={runs.map(candidate => ({ value: candidate.id, label: `${new Date(candidate.created_at).toLocaleString('pt-BR')} — ${candidate.state}` }))} />
        <Button icon={<ReloadOutlined />} onClick={() => void Promise.all([loadRuns(), loadRun()])}>Atualizar</Button>
      </Space>}>
        {run ? <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>{cards.map(([label, value]) => <Card size="small" key={String(label)}><Text type="secondary">{label}</Text><Title level={3} style={{ margin: 0 }}>{value}</Title></Card>)}</Space>
          <Space wrap>
            <Tag color={stateColor[run.state] || 'default'}>{run.state}</Tag>
            <Text>Baseline: {run.baseline_count}</Text><Text>Delta vivo: {run.delta_count}</Text>
            {run.manifest_hash && <Text code copyable>{run.manifest_hash}</Text>}
          </Space>
          {['queued','running'].includes(run.state) && <Progress percent={progress} status="active" format={() => `${processed}/${run.total_count}`} />}
          {run.safety_stop && <Alert type="error" showIcon message="Safety stop acionado" description={run.safety_stop.code || 'Execução pausada'} />}
          <Space wrap>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={busy} disabled={!['imported','paused','failed'].includes(run.state)} onClick={() => void startDryRun()}>Executar dry-run</Button>
            <Button danger disabled={run.state !== 'awaiting_approval' || !run.manifest_hash} onClick={approve}>Aprovar manifesto</Button>
            <Select style={{ width: 340 }} placeholder="Baixar entregável" suffixIcon={<DownloadOutlined />}
              onSelect={name => {
                const link = document.createElement('a');
                link.href = `/api/catalogo/identity-audit/runs/${run.id}/exports/${name}`;
                link.download = name;
                link.click();
              }}
              options={CATALOG_IDENTITY_EXPORTS.map(name => ({ value: name, label: name }))} />
          </Space>
          {run.state === 'approved' && <Alert type="info" showIcon message="Gate aprovado"
            description="As correções continuam separadas e não são disparadas por esta tela sem uma etapa de aplicação controlada." />}
        </Space> : <Text type="secondary">Importe ou selecione uma execução.</Text>}
      </Card>
      {run && <Card title="3. Fila de revisão">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder="MLB, SKU ou produto de catálogo" style={{ width: 300 }} onSearch={value => { setSearch(value); setPage(1); }} />
          <Select value={identityState} style={{ width: 230 }} onChange={value => { setIdentityState(value); setPage(1); }} options={[
            { value: 'all', label: 'Todos os estados' }, { value: 'SEM_CONFLITO', label: 'Sem conflito' },
            { value: 'CONFLITO_CONFIRMADO', label: 'Conflito confirmado' }, { value: 'PENDENCIA_VALIDACAO', label: 'Pendência' },
            { value: 'INCONCLUSIVO', label: 'Inconclusivo' },
          ]} />
          <Select value={risk} style={{ width: 170 }} onChange={value => { setRisk(value); setPage(1); }} options={[
            { value: 'all', label: 'Todos os riscos' }, ...['CRITICO','ALTO','MEDIO','BAIXO'].map(value => ({ value, label: value })),
          ]} />
        </Space>
        <Table rowKey="id" dataSource={items} pagination={{ current: page, pageSize: 50, total, showSizeChanger: false, onChange: setPage }}
          onRow={record => ({ onClick: () => setDrawer(record), style: { cursor: 'pointer' } })} columns={[
            { title: 'Anúncio', dataIndex: 'ml_item_id' }, { title: 'SKU', dataIndex: 'sku' },
            { title: 'Estado', dataIndex: 'identity_state', render: value => <Tag color={stateColor[value] || 'default'}>{value || 'PENDENTE'}</Tag> },
            { title: 'Risco', dataIndex: 'risk_tier' }, { title: 'Gap', dataIndex: 'gap_pct', render: value => value == null ? '—' : `${Number(value).toFixed(1)}%` },
            { title: 'Motivo', dataIndex: 'reason_code', ellipsis: true }, { title: 'Ação', dataIndex: 'action' },
          ]} />
      </Card>}
    </Space>
    <Drawer width={720} open={Boolean(drawer)} onClose={() => setDrawer(null)} title={drawer?.ml_item_id}>
      {drawer && <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type={drawer.block_price_write ? 'warning' : 'success'} showIcon
          message={drawer.block_price_write ? 'Pricing bloqueado' : 'Identidade liberada'} description={drawer.reason_code} />
        <Text>Produto Bentevi: {drawer.produto_id || 'não identificado'} · SKU: {drawer.sku || 'não informado'}</Text>
        <Text>Produto de catálogo ML: {drawer.catalog_product_id || 'não informado'}</Text>
        <Text>Fonte ML: {drawer.ml_live_source_available ? 'disponível' : 'indisponível/incompleta'}</Text>
        <Title level={4}>Comparações materiais</Title>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(drawer.comparisons, null, 2)}</pre>
        {drawer.error && <Alert type="error" message="Falha registrada" description={drawer.error} />}
      </Space>}
    </Drawer>
  </div>;
}
