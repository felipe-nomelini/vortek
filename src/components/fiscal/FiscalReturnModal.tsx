'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Descriptions, Input, InputNumber, Modal, Radio, Select,
  Space, Steps, Table, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  FISCAL_RETURN_TYPE_LABELS,
  type FiscalReturnType,
} from '@/lib/fiscal/nfe-return';
import { formatCurrency } from '@/lib/format';

type SaleOption = {
  id: string;
  pedido: number;
  numero: string;
  cliente: string;
  ml_pack_id: string | null;
  ml_order_id: string | null;
  is_homologation_fixture: boolean;
};

type OriginItem = {
  id: string;
  titulo: string;
  seller_sku: string | null;
  quantidade_vendida: number;
  quantidade_retornada: number;
  quantidade_disponivel: number;
  valor_unitario: number;
  nitem_original: number;
};

type Origin = {
  pedido: {
    id: string;
    numero: number;
    ml_order_id: string | null;
    ml_pack_id: string | null;
    cliente: string;
    nfe_numero: string | null;
    nfe_chave: string;
    total: number;
  };
  itens: OriginItem[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
};

const RETURN_TYPE_OPTIONS = (Object.entries(FISCAL_RETURN_TYPE_LABELS) as Array<[FiscalReturnType, string]>)
  .map(([value, label]) => ({ value, label }));

export default function FiscalReturnModal({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [sales, setSales] = useState<SaleOption[]>([]);
  const [saleId, setSaleId] = useState<string>();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [type, setType] = useState<FiscalReturnType>('devolucao_pos_recebimento');
  const [reason, setReason] = useState('Devolução de mercadoria solicitada pelo cliente');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loadingSales, setLoadingSales] = useState(false);
  const [loadingOrigin, setLoadingOrigin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [messageApi, contextHolder] = message.useMessage();

  const reset = useCallback(() => {
    setStep(0);
    setSaleId(undefined);
    setOrigin(null);
    setType('devolucao_pos_recebimento');
    setReason('Devolução de mercadoria solicitada pelo cliente');
    setQuantities({});
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    setLoadingSales(true);
    fetch('/api/notas-fiscais?status=autorizada&page=1&pageSize=100', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || payload.erro || 'Falha ao carregar as vendas');
        setSales((payload.data || []).filter((row: SaleOption) => !row.is_homologation_fixture));
      })
      .catch((error) => messageApi.error(error instanceof Error ? error.message : 'Falha ao carregar as vendas'))
      .finally(() => setLoadingSales(false));
  }, [messageApi, open, reset]);

  const loadOrigin = useCallback(async (id: string) => {
    setSaleId(id);
    setOrigin(null);
    setQuantities({});
    setLoadingOrigin(true);
    try {
      const response = await fetch(`/api/notas-fiscais/retornos/origem/${id}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha ao carregar a venda');
      const nextOrigin = payload.data as Origin;
      setOrigin(nextOrigin);
      setQuantities(Object.fromEntries(nextOrigin.itens.map((item) => [item.id, 0])));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Falha ao carregar a venda');
    } finally {
      setLoadingOrigin(false);
    }
  }, [messageApi]);

  const forceTotal = type === 'recusa_total' || type === 'nao_localizado';
  useEffect(() => {
    if (!origin || !forceTotal) return;
    setQuantities(Object.fromEntries(origin.itens.map((item) => [item.id, item.quantidade_disponivel])));
  }, [forceTotal, origin]);

  const selectedItems = useMemo(() => (origin?.itens || [])
    .map((item) => ({ ...item, quantidade: Number(quantities[item.id] || 0) }))
    .filter((item) => item.quantidade > 0), [origin, quantities]);
  const totalValue = selectedItems.reduce((sum, item) => sum + item.quantidade * item.valor_unitario, 0);
  const isSelectionTotal = Boolean(origin) && origin!.itens.every(
    (item) => Number(quantities[item.id] || 0) === item.quantidade_disponivel,
  );

  const selectionError = useMemo(() => {
    if (!origin) return 'Selecione uma venda.';
    if (selectedItems.length === 0) return 'Selecione ao menos um item.';
    if (reason.trim().length < 15) return 'Informe um motivo com pelo menos 15 caracteres.';
    if (type === 'recusa_parcial' && isSelectionTotal) return 'Recusa parcial exige quantidade menor que o saldo total.';
    return null;
  }, [isSelectionTotal, origin, reason, selectedItems.length, type]);

  const columns: ColumnsType<OriginItem> = [
    {
      title: 'Produto', dataIndex: 'titulo', key: 'titulo',
      render: (value, item) => <div><strong>{value}</strong><br /><Typography.Text type="secondary">SKU {item.seller_sku || '—'} · Item {item.nitem_original}</Typography.Text></div>,
    },
    { title: 'Vendido', dataIndex: 'quantidade_vendida', key: 'vendido', width: 85 },
    { title: 'Já retornado', dataIndex: 'quantidade_retornada', key: 'retornado', width: 105 },
    { title: 'Disponível', dataIndex: 'quantidade_disponivel', key: 'disponivel', width: 90 },
    {
      title: 'Retornar', key: 'quantidade', width: 120,
      render: (_, item) => <InputNumber
        min={0}
        max={item.quantidade_disponivel}
        precision={0}
        disabled={forceTotal || item.quantidade_disponivel <= 0}
        value={quantities[item.id] || 0}
        onChange={(value) => setQuantities((current) => ({ ...current, [item.id]: Number(value || 0) }))}
      />,
    },
  ];

  const submit = useCallback(async () => {
    if (!origin || selectionError) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/notas-fiscais/retornos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId: origin.pedido.id,
          tipoRetorno: type,
          motivo: reason,
          idempotencyKey,
          itens: selectedItems.map((item) => ({ pedidoItemId: item.id, quantidade: item.quantidade })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha ao emitir a nota de retorno');
      messageApi.success('Nota de devolução/retorno emitida com sucesso.');
      await onCreated();
      onClose();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Falha ao emitir a nota de retorno');
    } finally {
      setSubmitting(false);
    }
  }, [idempotencyKey, messageApi, onClose, onCreated, origin, reason, selectedItems, selectionError, type]);

  return <>
    {contextHolder}
    <Modal
      title="Criar devolução ou retorno fiscal"
      open={open}
      width={920}
      onCancel={onClose}
      destroyOnHidden
      footer={<Space>
        <Button onClick={onClose}>Cancelar</Button>
        {step > 0 && <Button onClick={() => setStep((current) => current - 1)}>Voltar</Button>}
        {step < 2
          ? <Button type="primary" disabled={step === 0 ? !origin : Boolean(selectionError)} onClick={() => setStep((current) => current + 1)}>Continuar</Button>
          : <Button type="primary" loading={submitting} disabled={Boolean(selectionError)} onClick={() => void submit()}>Pré-validar e emitir</Button>}
      </Space>}
    >
      <Steps current={step} items={[{ title: 'Venda' }, { title: 'Itens e motivo' }, { title: 'Revisão' }]} style={{ marginBottom: 24 }} />
      {step === 0 && <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert type="info" showIcon message="Somente vendas com NF-e autorizada e dados fiscais completos podem gerar devolução." />
        <Select
          showSearch
          loading={loadingSales}
          placeholder="Selecione a venda ou pesquise pelo cliente"
          value={saleId}
          optionFilterProp="label"
          style={{ width: '100%' }}
          options={sales.map((sale) => ({
            value: sale.id,
            label: `${sale.ml_pack_id ? `Pack ${sale.ml_pack_id}` : `Venda ${sale.ml_order_id || sale.pedido}`} · NF-e ${sale.numero} · ${sale.cliente}`,
          }))}
          onChange={(value) => void loadOrigin(value)}
        />
        {loadingOrigin && <Typography.Text type="secondary">Conferindo XML, itens e saldo disponível…</Typography.Text>}
        {origin && <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Venda">{origin.pedido.ml_pack_id ? `Pack ${origin.pedido.ml_pack_id}` : `Venda ${origin.pedido.ml_order_id || origin.pedido.numero}`}</Descriptions.Item>
          <Descriptions.Item label="NF-e original">{origin.pedido.nfe_numero}</Descriptions.Item>
          <Descriptions.Item label="Cliente">{origin.pedido.cliente}</Descriptions.Item>
          <Descriptions.Item label="Valor da venda">{formatCurrency(origin.pedido.total)}</Descriptions.Item>
        </Descriptions>}
      </Space>}
      {step === 1 && origin && <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Radio.Group options={RETURN_TYPE_OPTIONS} value={type} optionType="button" buttonStyle="solid" onChange={(event) => setType(event.target.value)} />
        <Input.TextArea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Descreva o motivo fiscal" />
        {forceTotal && <Alert type="warning" showIcon message="Este motivo exige o retorno de todo o saldo disponível da venda." />}
        <Table rowKey="id" size="small" pagination={false} dataSource={origin.itens} columns={columns} scroll={{ x: 760 }} />
        {selectionError && <Typography.Text type="danger">{selectionError}</Typography.Text>}
      </Space>}
      {step === 2 && origin && <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert type="warning" showIcon message="A confirmação executará primeiro a pré-visualização e, se válida, enviará a NF-e à Brasil NFe." />
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Operação">{FISCAL_RETURN_TYPE_LABELS[type]}</Descriptions.Item>
          <Descriptions.Item label="Escopo">{isSelectionTotal ? 'Total' : 'Parcial'}</Descriptions.Item>
          <Descriptions.Item label="NF-e original">{origin.pedido.nfe_numero}</Descriptions.Item>
          <Descriptions.Item label="Cliente">{origin.pedido.cliente}</Descriptions.Item>
          <Descriptions.Item label="Itens">{selectedItems.length}</Descriptions.Item>
          <Descriptions.Item label="Valor do retorno">{formatCurrency(totalValue)}</Descriptions.Item>
          <Descriptions.Item label="Motivo" span={2}>{reason}</Descriptions.Item>
        </Descriptions>
        <Table
          rowKey="id" size="small" pagination={false} dataSource={selectedItems}
          columns={[
            { title: 'Produto', dataIndex: 'titulo' },
            { title: 'Quantidade', dataIndex: 'quantidade', width: 110 },
            { title: 'Valor', width: 130, render: (_, item) => formatCurrency(item.quantidade * item.valor_unitario) },
          ]}
        />
      </Space>}
    </Modal>
  </>;
}
