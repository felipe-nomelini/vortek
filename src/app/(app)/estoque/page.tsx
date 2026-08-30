'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, message, Modal, Popconfirm, Row, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';

type SituacaoEstoque = 'revisao' | 'liberado' | 'nao_aproveitavel';
type ItemEstoque = {
  id: string; produto_id: string; pedido_id: string; sku: string; nome: string; quantidade: number;
  motivo: string; status_devolucao: string; situacao_estoque: SituacaoEstoque;
  origem_entrada: 'devolucao' | 'compra' | 'ajuste_manual'; custo_unitario: number | null;
  pedido_ml: string; pedido_ml_link_id: string | null;
};
type ItemVendido = { id: string; sku: string; nome: string; quantidade: number; pedido_ml: string; pedido_ml_link_id: string | null; vendido_em: string };
type EstoqueResponse = { data: ItemEstoque[]; revisao: number; liberado: number; nao_aproveitavel: number; vendidos: ItemVendido[]; vendidosQuantidade: number };
const initialData: EstoqueResponse = { data: [], revisao: 0, liberado: 0, nao_aproveitavel: 0, vendidos: [], vendidosQuantidade: 0 };

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
  returning_to_sender: { label: 'Retornando ao remetente', color: 'processing' },
  returned: { label: 'Devolvido ao remetente', color: 'green' },
  lost: { label: 'Extraviado', color: 'red' },
  aguardando_confirmacao: { label: 'Aguardando confirmação', color: 'default' },
};

export default function EstoquePage() {
  const [data, setData] = useState<EstoqueResponse>(initialData);
  const [loading, setLoading] = useState(true);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualProduct, setManualProduct] = useState<{ sku: string; nome: string } | null>(null);
  const [lookingUpProduct, setLookingUpProduct] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [deletingManualId, setDeletingManualId] = useState<string | null>(null);
  const [manualForm] = Form.useForm<{ sku: string; quantidade: number; custo_unitario: number }>();
  const [messageApi, contextHolder] = message.useMessage();
  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch('/api/estoque'); const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao carregar estoque interno.');
      setData(result);
    } catch (error: any) {
      if (showLoading) messageApi.error(error?.message || 'Falha ao carregar estoque interno.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [messageApi]);
  useEffect(() => {
    void load();
    const refresh = () => void load(false);
    const interval = window.setInterval(refresh, 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load]);

  const atualizarSituacao = async (item: ItemEstoque, situacao: Exclude<SituacaoEstoque, 'revisao'>) => {
    try {
      const response = await fetch(`/api/estoque/${item.id}/situacao`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ situacao }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao atualizar devolução.');
      messageApi.success(situacao === 'liberado' ? 'Produto liberado para venda.' : 'Produto movido para Não aproveitável.');
      if (result?.mlSyncWarning) messageApi.warning(result.mlSyncWarning);
      if (Array.isArray(result?.automaticPricing?.errors) && result.automaticPricing.errors.length > 0) {
        messageApi.warning('O estoque foi liberado, mas o preço automático precisa ser revisado.');
      }
      await load();
    } catch (error: any) { messageApi.error(error?.message || 'Falha ao atualizar devolução.'); }
  };

  const buscarProdutoManual = async () => {
    const sku = String(manualForm.getFieldValue('sku') || '').trim();
    if (!sku) return;
    setLookingUpProduct(true);
    setManualProduct(null);
    try {
      const response = await fetch(`/api/estoque/produto?sku=${encodeURIComponent(sku)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Produto não encontrado.');
      setManualProduct(result.produto);
      manualForm.setFieldsValue({ sku: result.produto.sku });
    } catch (error: any) { messageApi.error(error?.message || 'Produto não encontrado.'); }
    finally { setLookingUpProduct(false); }
  };

  const inserirEstoqueManual = async (values: { sku: string; quantidade: number; custo_unitario: number }) => {
    setSavingManual(true);
    try {
      const response = await fetch('/api/estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, origem: 'compra' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao inserir estoque interno.');
      messageApi.success('Compra inserida para revisão.');
      setManualModalOpen(false);
      setManualProduct(null);
      manualForm.resetFields();
      await load();
    } catch (error: any) { messageApi.error(error?.message || 'Falha ao inserir estoque interno.'); }
    finally { setSavingManual(false); }
  };

  const excluirEstoqueManual = async (item: ItemEstoque) => {
    setDeletingManualId(item.id);
    try {
      const response = await fetch(`/api/estoque/${item.id}/situacao`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao excluir inserção manual.');
      messageApi.success('Inserção manual excluída.');
      await load();
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao excluir inserção manual.');
    } finally {
      setDeletingManualId(null);
    }
  };

  const columns = [
    { title: 'SKU', dataIndex: 'sku' },
    { title: 'Origem', render: (_: unknown, item: ItemEstoque) => item.origem_entrada === 'compra' ? <Tag color="blue">Compra</Tag> : item.pedido_ml_link_id ? <Typography.Link href={`https://www.mercadolivre.com.br/vendas/${item.pedido_ml_link_id}/detalhe`} target="_blank" rel="noopener noreferrer">Devolução #{item.pedido_ml}</Typography.Link> : <Tag>Devolução</Tag> },
    { title: 'Produto', dataIndex: 'nome' }, { title: 'Quantidade', dataIndex: 'quantidade' },
    { title: 'Custo unitário', render: (_: unknown, item: ItemEstoque) => item.custo_unitario == null ? <Typography.Text type="secondary">—</Typography.Text> : item.custo_unitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
    { title: 'Motivo', dataIndex: 'motivo' },
    { title: 'Status', render: (_: unknown, item: ItemEstoque) => {
      if (item.status_devolucao === 'manual') return <Tag color={item.origem_entrada === 'compra' ? 'blue' : 'default'}>{item.origem_entrada === 'compra' ? 'Compra recebida' : 'Entrada manual'}</Tag>;
      const status = statusLabels[item.status_devolucao] || { label: item.status_devolucao, color: 'default' };
      return <Tag color={status.color}>{status.label}</Tag>;
    } },
    { title: 'Ações', render: (_: unknown, item: ItemEstoque) => {
      const entregue = ['delivered', 'returned', 'manual'].includes(item.status_devolucao);
      const excluirManual = item.status_devolucao === 'manual' ? (
        <Popconfirm
          title="Excluir entrada?"
          description="A entrada será removida do estoque interno."
          okText="Excluir"
          cancelText="Cancelar"
          okButtonProps={{ danger: true }}
          onConfirm={() => excluirEstoqueManual(item)}
        >
          <Button danger loading={deletingManualId === item.id}>Excluir</Button>
        </Popconfirm>
      ) : null;
      if (item.situacao_estoque !== 'revisao') {
        return <Space><Tag color={item.situacao_estoque === 'liberado' ? 'green' : 'red'}>{item.situacao_estoque === 'liberado' ? 'Liberado' : 'Não aproveitável'}</Tag>{excluirManual}</Space>;
      }
      return <Space><Button type="primary" disabled={!entregue} onClick={() => void atualizarSituacao(item, 'liberado')}>Liberar para venda</Button><Button danger disabled={!entregue} onClick={() => void atualizarSituacao(item, 'nao_aproveitavel')}>Não aproveitar</Button>{excluirManual}</Space>;
    } },
  ];
  const tabela = (situacao: SituacaoEstoque) => <Table<ItemEstoque> rowKey="id" loading={loading} dataSource={data.data.filter((item) => item.situacao_estoque === situacao)} columns={columns} pagination={{ pageSize: 50 }} />;
  const tabelaVendidos = <Table<ItemVendido> rowKey="id" loading={loading} dataSource={data.vendidos} pagination={{ pageSize: 50 }} columns={[
    { title: 'SKU', dataIndex: 'sku' },
    { title: 'Venda com estoque interno', render: (_: unknown, item: ItemVendido) => item.pedido_ml_link_id ? <Typography.Link href={`https://www.mercadolivre.com.br/vendas/${item.pedido_ml_link_id}/detalhe`} target="_blank" rel="noopener noreferrer">#{item.pedido_ml}</Typography.Link> : <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Produto', dataIndex: 'nome' },
    { title: 'Quantidade', dataIndex: 'quantidade' },
    { title: 'Data do envio', render: (_: unknown, item: ItemVendido) => new Date(item.vendido_em).toLocaleString('pt-BR') },
  ]} />;

  return <>{contextHolder}<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}><div><Typography.Title level={4}>Estoque interno</Typography.Title><Typography.Paragraph type="secondary">Devoluções e compras recebidas entram em revisão antes de ficarem disponíveis para venda.</Typography.Paragraph></div><Button type="primary" onClick={() => setManualModalOpen(true)}>Registrar compra</Button></div>
    <Row gutter={16}><Col xs={24} md={8}><Card><Statistic title="Para revisão" value={data.revisao} valueStyle={{ color: '#faad14' }} /></Card></Col><Col xs={24} md={8}><Card><Statistic title="Liberadas para venda" value={data.liberado} valueStyle={{ color: '#52c41a' }} /></Card></Col><Col xs={24} md={8}><Card><Statistic title="Não aproveitáveis" value={data.nao_aproveitavel} valueStyle={{ color: '#ff4d4f' }} /></Card></Col></Row>
    <Tabs style={{ marginTop: 16 }} items={[{ key: 'revisao', label: `Para revisão (${data.revisao})`, children: tabela('revisao') }, { key: 'liberado', label: `Liberado (${data.liberado})`, children: tabela('liberado') }, { key: 'nao-aproveitavel', label: `Não aproveitável (${data.nao_aproveitavel})`, children: tabela('nao_aproveitavel') }, { key: 'vendidos', label: `Vendidos (${data.vendidosQuantidade})`, children: tabelaVendidos }]} />
    <Modal title="Registrar compra recebida" open={manualModalOpen} onCancel={() => { setManualModalOpen(false); setManualProduct(null); manualForm.resetFields(); }} onOk={() => manualForm.submit()} confirmLoading={savingManual} okText="Registrar compra">
      <Form form={manualForm} layout="vertical" onFinish={inserirEstoqueManual} onValuesChange={(changed) => { if (changed.sku !== undefined) setManualProduct(null); }}>
        <Form.Item label="SKU" name="sku" rules={[{ required: true, message: 'Informe o SKU.' }]}>
          <Input placeholder="Ex.: VTK001030" onBlur={() => void buscarProdutoManual()} onPressEnter={(event) => { event.preventDefault(); void buscarProdutoManual(); }} suffix={lookingUpProduct ? 'Buscando...' : undefined} />
        </Form.Item>
        <Form.Item label="Produto">
          <Input value={manualProduct?.nome || ''} placeholder="Informe o SKU para buscar o produto" readOnly />
        </Form.Item>
        <Form.Item label="Quantidade" name="quantidade" rules={[{ required: true, message: 'Informe a quantidade.' }]}>
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Custo unitário" name="custo_unitario" rules={[{ required: true, message: 'Informe o custo unitário.' }]}>
          <InputNumber<number>
            min={0.01}
            precision={2}
            step={0.01}
            prefix="R$"
            decimalSeparator=","
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  </>;
}
