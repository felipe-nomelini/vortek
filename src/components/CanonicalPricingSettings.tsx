'use client';
import { useState } from 'react';
import { Alert, Button, Input, InputNumber, Space, Table, Typography, message } from 'antd';
import { PRICING_POLICY, type PricingPolicy } from '@/services/pricing-policy';
export default function CanonicalPricingSettings({ initial }: {
    initial: {
        pricing_policy?: PricingPolicy;
        pricing_tax_config?: any;
    };
}) {
    const [policy, setPolicy] = useState(initial.pricing_policy ?? PRICING_POLICY);
    const [version, setVersion] = useState(policy.version);
    const [tax, setTax] = useState(initial.pricing_tax_config ?? {});
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    async function save() {
        setSaving(true);
        try {
            const response = await fetch('/api/configuracoes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pricing_policy: policy, pricing_tax_config: tax, expectedVersion: version, reason }) });
            const data = await response.json();
            if (!response.ok)
                throw new Error(data.erro);
            setVersion(data.pricing_policy.version);
            setPolicy(data.pricing_policy);
            message.success('Política registrada. Preços dependem de nova simulação e aprovação.');
        }
        catch (error: any) {
            message.error(error.message);
        }
        finally {
            setSaving(false);
        }
    }
    return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert type="info" showIcon message="Comercial / Precificação" description="Faixas pelo preço final. Limite é teto de busca, sem reduzir margens premium. Radar observa; publicação e alteração de preço exigem confirmação."/>
    <Table pagination={false} rowKey="id" dataSource={policy.bands} columns={[
            { title: 'Preço final', dataIndex: 'maxCents', render: (_, row) => row.id === 'BELOW_200' ? 'Até R$ 200,00' : row.id === 'FROM_200_TO_1000' ? 'R$ 200,01 a R$ 1.000,00' : 'Acima de R$ 1.000,00' },
            ...(['floor', 'target', 'limit'] as const).map((field, index) => ({ title: ['Piso %', 'Alvo %', 'Limite de busca %'][index], key: field, render: (_: unknown, row: PricingPolicy['bands'][number]) => <InputNumber min={0} max={99} value={row[field] * 100} onChange={value => { if (value !== null)
                    setPolicy(p => ({ ...p, bands: p.bands.map(b => b.id === row.id ? { ...b, [field]: value / 100 } : b) as PricingPolicy['bands'] })); }}/> }))
        ]}/>
    <Typography.Text>Tarifa fallback (%) — usada somente como estimativa</Typography.Text>
    <InputNumber min={0} max={99} value={policy.feeFallbackRate === null ? null : policy.feeFallbackRate * 100} onChange={v => setPolicy(p => ({ ...p, feeFallbackRate: v === null ? null : v / 100 }))}/>
    <Typography.Text>Início da atividade (RBT12 estimado)</Typography.Text>
    <Input type="date" value={tax.activityStartDate ?? ''} onChange={e => setTax({ ...tax, activityStartDate: e.target.value })}/>
    <Typography.Text>Confirmação fiscal: competência, alíquota (%) e evidência</Typography.Text>
    <Space wrap><Input type="month" value={tax.confirmed?.month ?? ''} onChange={e => setTax({ ...tax, confirmed: { ...tax.confirmed, month: e.target.value } })}/><InputNumber min={0} max={99} value={tax.confirmed?.rate === undefined ? null : tax.confirmed.rate * 100} onChange={v => setTax({ ...tax, confirmed: { ...tax.confirmed, rate: v === null ? undefined : v / 100 } })}/><Input placeholder="Referência da validação contábil" value={tax.confirmed?.evidence ?? ''} onChange={e => setTax({ ...tax, confirmed: { ...tax.confirmed, evidence: e.target.value } })}/><Button onClick={() => { const { confirmed, ...rest } = tax; setTax(rest); }}>Usar estimativa RBT12</Button></Space>
    <Typography.Text>Radar: horário inicial (Brasília), lote e concorrência</Typography.Text>
    <Space>{(['hour', 'batchSize', 'concurrency'] as const).map((field, index) => <InputNumber key={field} aria-label={field} min={index ? 1 : 0} max={[23, 50, 4][index]} value={policy.radar[field]} onChange={v => { if (v !== null)
        setPolicy(p => ({ ...p, radar: { ...p.radar, [field]: v } })); }}/>)}</Space>
    <Input.TextArea placeholder="Razão da mudança" value={reason} onChange={e => setReason(e.target.value)}/>
    <Button type="primary" loading={saving} disabled={!reason.trim()} onClick={save}>Registrar configuração para novas simulações</Button>
  </Space>;
}
