'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, message, Row, Statistic, Table, Tag, Typography } from 'antd';

type ItemEstoque = {
  produto_id: string;
  sku: string;
  nome: string;
  quantidade: number;
  disponivel: number;
  motivos: string;
};

type EstoqueResponse = {
  data: ItemEstoque[];
  total: number;
  disponivel: number;
  bloqueado: number;
};

const initialData: EstoqueResponse = { data: [], total: 0, disponivel: 0, bloqueado: 0 };

export default function EstoquePage() {
  const [data, setData] = useState<EstoqueResponse>(initialData);
  const [loading, setLoading] = useState(true);
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/estoque');
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao carregar estoque interno.');
      setData(result);
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao carregar estoque interno.');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { void load(); }, [load]);

  const alterarVenda = async (item: ItemEstoque, disponivel: boolean) => {
    try {
      const response = await fetch(`/api/estoque/${item.produto_id}/venda`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disponivel }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Falha ao atualizar produto.');
      messageApi.success(disponivel ? 'Produto liberado para venda.' : 'Produto bloqueado para venda.');
      await load();
    } catch (error: any) {
      messageApi.error(error?.message || 'Falha ao atualizar produto.');
    }
  };

  return <>
    {contextHolder}
    <Typography.Title level={4}>Estoque interno</Typography.Title>
    <Typography.Paragraph type="secondary">Devoluções entram bloqueadas. Libere somente após conferência física.</Typography.Paragraph>
    <Row gutter={16}>
      <Col xs={24} md={8}><Card><Statistic title="Produtos" value={data.total} /></Card></Col>
      <Col xs={24} md={8}><Card><Statistic title="Unidades liberadas" value={data.disponivel} valueStyle={{ color: '#52c41a' }} /></Card></Col>
      <Col xs={24} md={8}><Card><Statistic title="Unidades bloqueadas" value={data.bloqueado} valueStyle={{ color: '#faad14' }} /></Card></Col>
    </Row>
    <Table<ItemEstoque>
      style={{ marginTop: 16 }}
      rowKey="produto_id"
      loading={loading}
      dataSource={data.data}
      pagination={{ pageSize: 50 }}
      columns={[
        { title: 'SKU', dataIndex: 'sku' },
        { title: 'Produto', dataIndex: 'nome' },
        { title: 'Quantidade', dataIndex: 'quantidade' },
        { title: 'Motivo da devolução', dataIndex: 'motivos' },
        {
          title: 'Venda',
          render: (_, item) => <Tag color={item.disponivel ? 'green' : 'orange'}>{item.disponivel ? `${item.disponivel} liberada(s)` : 'Bloqueado'}</Tag>,
        },
        {
          title: 'Ações',
          render: (_, item) => <Button onClick={() => void alterarVenda(item, !item.disponivel)}>{item.disponivel ? 'Bloquear venda' : 'Liberar para venda'}</Button>,
        },
      ]}
    />
  </>;
}
