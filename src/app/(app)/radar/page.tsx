'use client';
import { useState, useEffect, useCallback } from 'react';
import { Alert, Button, Select, Space, Table, Tag, Typography, Modal, Input } from 'antd';
import Link from 'next/link';
import { formatCurrency } from '@/lib/format';
const queues: Record<string, string> = { PRONTOS_PARA_ANALISE: 'Prontos para análise', ALTA_PRIORIDADE: 'Alta prioridade', REATIVACOES: 'Reativações', PENDENCIAS_IDENTIDADE: 'Pendências de identidade', CONFLITOS: 'Conflitos', ECONOMICAMENTE_INVIAVEIS: 'Economicamente inviáveis', EXPLORATORIOS: 'Exploratórios', INCONCLUSIVOS: 'Inconclusivos', REVISAR: 'Revisar', JA_ANUNCIADOS: 'Já anunciados' };
const explanations: Record<string, string> = { PRONTOS_PARA_ANALISE: 'Sinais indiretos; conferir identidade, economia e preparação.', ALTA_PRIORIDADE: 'Histórico próprio ou ranking observado. Prioridade não elimina pendências.', REATIVACOES: 'Há anúncio pausado: revisar reativação na gestão de anúncios.', PENDENCIAS_IDENTIDADE: 'Faltam evidências de modelo, apresentação ou quantidade.', CONFLITOS: 'Atributos materiais divergem. Resolver antes de preparar publicação.', ECONOMICAMENTE_INVIAVEIS: 'Preço competitivo produz resultado negativo. Não perseguir Buy Box destrutiva.', EXPLORATORIOS: 'Demanda ainda sem evidência; isso não é conflito.', INCONCLUSIVOS: 'Fontes ou vínculos insuficientes para decidir.', REVISAR: 'Revisar estoque ou estratégia abaixo do piso.', JA_ANUNCIADOS: 'Produto já coberto por anúncio ativo.' };
export default function RadarPage() {
    const [rows, setRows] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [queue, setQueue] = useState('PRONTOS_PARA_ANALISE');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [review,setReview]=useState<{row:any;stage:string;reason:string}|null>(null);
    async function saveReview(){if(!review)return;const response=await fetch('/api/radar',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:review.row.id,expectedStage:review.row.stage,stage:review.stage,reason:review.reason})});const data=await response.json();if(!response.ok){setError(data.error);return;}setReview(null);await load();}
    const load = useCallback(async () => { setLoading(true); try {
        const r = await fetch(`/api/radar?queue=${queue}&page=${page}`);
        const d = await r.json();
        if (!r.ok)
            throw new Error(d.error);
        setRows(d.rows);
        setTotal(d.total);
        setError('');
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setLoading(false);
    } }, [queue, page]);
    useEffect(() => { void load(); }, [load]);
    const price = (e: any) => formatCurrency(e?.memory?.price ?? null);
    return <Space direction="vertical" style={{ width: '100%' }}><Typography.Title level={2}>Radar de Oportunidades</Typography.Title><Alert type="info" message="Observação automática • publicação exige confirmação" description="Prioridade considera identidade, economia, demanda, competitividade, estoque e preparação. Margens premium com vendas devem ser preservadas."/>{error && <Alert type="error" message={error}/>}<Space wrap><Select style={{ width: 300 }} value={queue} options={Object.entries(queues).map(([value, label]) => ({ value, label }))} onChange={v => { setQueue(v); setPage(1); }}/><Button loading={loading} onClick={load}>Atualizar filas</Button></Space><Typography.Paragraph>{explanations[queue]}</Typography.Paragraph>
 <Table rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 1900 }} pagination={{ current: page, pageSize: 50, total, onChange: setPage }} expandable={{ expandedRowRender: r => <Space direction="vertical"><Typography.Text>{r.recommendation}</Typography.Text><Typography.Text>Estado: {r.stage} · {r.conflict_state}</Typography.Text><Typography.Text>Pendências: {r.assessment.reasons.join('; ') || 'Nenhuma'}</Typography.Text><Typography.Text>Avisos: {(r.assessment.warnings ?? []).join('; ') || 'Nenhum'}</Typography.Text><Typography.Text>Atualizado: {new Date(r.processed_at).toLocaleString('pt-BR')} · Fontes: {r.economics?.memory?.fee?.source ?? 'ausente'} / {r.economics?.memory?.shipping?.source ?? 'ausente'} · Tributo: {r.economics?.memory?.tax?.status ?? 'ausente'}</Typography.Text><Typography.Text>{r.economics && !r.economics.valid ? 'Memória vencida: renovar simulação antes de decidir.' : ''}</Typography.Text><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.priority, null, 2)}</pre><Space>{['REVISAR','REJEITADO','VALIDADO'].map(stage=><Button key={stage} onClick={()=>setReview({row:r,stage,reason:''})}>{stage==='REVISAR'?'Revisar':stage==='REJEITADO'?'Rejeitar investimento':'Validar experimento'}</Button>)}</Space><Link href={r.assessment.listing === 'REATIVACAO_CANDIDATA' ? '/anuncios' : `/produtos/${r.produto_id}`}>Abrir produto / anúncio para revisão</Link></Space> }} columns={[
            { title: 'SKU', dataIndex: 'sku', fixed: 'left' }, { title: 'Produto', render: (_, r) => r.evidence.product }, { title: 'Fornecedor', render: (_, r) => r.evidence.supplier ?? 'Pendente' }, { title: 'Custo', render: (_, r) => formatCurrency(r.evidence.cost ?? null) }, { title: 'Estoque', dataIndex: 'stock' },
            { title: 'Competitivo', render: (_, r) => formatCurrency(r.evidence.competitivePrice ?? null) }, { title: 'Piso', render: (_, r) => price(r.floor) }, { title: 'Alvo', render: (_, r) => price(r.target) }, { title: 'Break-even', render: (_, r) => price(r.breakEven) }, { title: 'Margem competitiva', render: (_, r) => r.economics?.memory?.margin == null ? '—' : `${(r.economics.memory.margin * 100).toFixed(2)}%` }, { title: 'Contribuição', render: (_, r) => formatCurrency(r.contribution) },
            { title: 'Demanda', render: (_, r) => r.priority.demand }, { title: 'Identidade', render: (_, r) => r.assessment.identity }, { title: 'Conflitos', render: (_, r) => <Tag>{r.conflict_state}</Tag> }, { title: 'Recomendação', dataIndex: 'recommendation' }
        ]}/><Modal open={!!review} title="Registrar decisão comercial" onCancel={()=>setReview(null)} onOk={saveReview} okButtonProps={{disabled:!review?.reason.trim()}}><Typography.Paragraph>A decisão registra a etapa e sua razão. Alterações no anúncio dependem de aprovação própria.</Typography.Paragraph><Input.TextArea value={review?.reason??''} onChange={e=>setReview(r=>r?{...r,reason:e.target.value}:r)} placeholder="Razão e evidências da decisão"/></Modal></Space>;
}
