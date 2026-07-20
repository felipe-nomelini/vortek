'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, message, Row, Statistic, Table, Tabs, Tag, Typography } from 'antd';

type SituacaoEstoque = 'revisao' | 'liberado' | 'nao_aproveitavel';
type ItemEstoque = {
  id: string; produto_id: string; pedido_id: string; sku: string; nome: string; quantidade: number;
  motivo: string; status_devolucao: string; situacao_estoque: SituacaoEstoque;
};
type EstoqueResponse = { data: ItemEstoque[]; revisao: number; liberado: number; nao_aproveitavel: number };
const initialData: EstoqueResponse = { data: [], revisao: 0, liberado: 0, nao_aproveitavel: 0 };

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: 'Devolução iniciada', color: 'blue' },
  ready_to_ship: { label: 'Aguardando postagem', color: 'blue' },
  label_generated: { label: 'Etiqueta de devolução gerada', color: 'blue' },
  scheduled: { label: 'Coleta agendada', color: 'blue' },
  shipped: { label: 'Em trânsito', color: 'processing' },
  pending_delivered: { label: 'Aguardando confirmação de entrega', color: 'processing' },
  delivered_warehouse: { label: 'Entregue ao centro de devoluções', color: 'orange' },
  delivered: { label: 'Entregue', color: 'green' },
  not_delivered: { label: 'Entrega não realizada', color: 'red' },
  cancelled: { label: 'Devolução cancelada', color: 'red' },
  failed: { label: 'Falha na devolução', color: 'red' },
  expired: { label: 'Devolução expirada', color: 'red' },
  return_to_buyer: { label: 'Retornando ao cliente', color: 'orange' },
  aguardando_confirmacao: { label: 'Aguardando confirmação', color: 'default' },
};

export default function EstoquePage() {
  const [data, setData] = useState<EstoqueResponse>(initialData);
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/estoque'); const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao carregar estoque interno.');
      setData(result);
    } catch (error: any) { messageApi.error(error?.message || 'Falha ao carregar estoque interno.'); }
    finally { setLoading(false); }
  }, [messageApi]);
  useEffect(() => { void load(); }, [load]);

  const atualizarSituacao = async (item: ItemEstoque, situacao: Exclude<SituacaoEstoque, 'revisao'>) => {
    try {
      const response = await fetch(`/api/estoque/${item.id}/situacao`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ situacao }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao atualizar devolução.');
      messageApi.success(situacao === 'liberado' ? 'Produto liberado para venda.' : 'Produto movido para Não aproveitável.');
      await load();
    } catch (error: any) { messageApi.error(error?.message || 'Falha ao atualizar devolução.'); }
  };

  const columns = [
    { title: 'SKU', dataIndex: 'sku' }, { title: 'Produto', dataIndex: 'nome' }, { title: 'Quantidade', dataIndex: 'quantidade' },
    { title: 'Motivo', dataIndex: 'motivo' },
    { title: 'Status', render: (_: unknown, item: ItemEstoque) => { const status = statusLabels[item.status_devolucao] || { label: item.status_devolucao, color: 'default' }; return <Tag color={status.color}>{status.label}</Tag>; } },
    { title: 'Ações', render: (_: unknown, item: ItemEstoque) => {
      const entregue = item.status_devolucao === 'delivered';
      if (item.situacao_estoque !== 'revisao') return <Tag color={item.situacao_estoque === 'liberado' ? 'green' : 'red'}>{item.situacao_estoque === 'liberado' ? 'Liberado' : 'Não aproveitável'}</Tag>;
      return <>{<Button type="primary" disabled={!entregue} onClick={() => void atualizarSituacao(item, 'liberado')}>Liberar para venda</Button>}{<Button danger disabled={!entregue} style={{ marginLeft: 8 }} onClick={() => void atualizarSituacao(item, 'nao_aproveitavel')}>Não aproveitar</Button>}</>;
    } },
  ];
  const tabela = (situacao: SituacaoEstoque) => <Table<ItemEstoque> rowKey="id" loading={loading} dataSource={data.data.filter((item) => item.situacao_estoque === situacao)} columns={columns} pagination={{ pageSize: 50 }} />;

  return <>{contextHolder}<Typography.Title level={4}>Estoque interno</Typography.Title><Typography.Paragraph type="secondary">Devoluções entram em revisão. Ações liberadas somente após entrega confirmada pelo Mercado Livre.</Typography.Paragraph>
    <Row gutter={16}><Col xs={24} md={8}><Card><Statistic title="Para revisão" value={data.revisao} valueStyle={{ color: '#faad14' }} /></Card></Col><Col xs={24} md={8}><Card><Statistic title="Liberadas para venda" value={data.liberado} valueStyle={{ color: '#52c41a' }} /></Card></Col><Col xs={24} md={8}><Card><Statistic title="Não aproveitáveis" value={data.nao_aproveitavel} valueStyle={{ color: '#ff4d4f' }} /></Card></Col></Row>
    <Tabs style={{ marginTop: 16 }} items={[{ key: 'revisao', label: `Para revisão (${data.revisao})`, children: tabela('revisao') }, { key: 'liberado', label: `Liberado (${data.liberado})`, children: tabela('liberado') }, { key: 'nao-aproveitavel', label: `Não aproveitável (${data.nao_aproveitavel})`, children: tabela('nao_aproveitavel') }]} />
  </>;
}
