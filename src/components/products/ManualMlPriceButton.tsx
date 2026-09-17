'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, InputNumber, Modal, Space, Typography } from 'antd';

export default function ManualMlPriceButton({ productId, itemId, priceCents, disabled = false,
  disableAutomaticPricing = false, onConfirmed }: {
  productId: string; itemId: string; priceCents?: number; disabled?: boolean;
  disableAutomaticPricing?: boolean; onConfirmed?: () => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const lastCommand = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    if (!operationId || !open || ['confirmed', 'failed', 'inconclusive'].includes(state || '')) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/ml/operacoes?operationId=${encodeURIComponent(operationId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const operation = await response.json();
        if (operation.state) {
          setState(operation.state);
          if (operation.state === 'confirmed') onConfirmed?.();
        }
      } catch { /* A consulta pode ser repetida sem enviar preço novamente. */ }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [operationId, open, state, onConfirmed]);

  async function confirm() {
    if (!price || price <= 0) return;
    const cents = Math.round(price * 100);
    const key = `${productId}:${itemId}:${cents}`;
    const id = lastCommand.current?.key === key ? lastCommand.current.id : crypto.randomUUID();
    lastCommand.current = { key, id };
    setBusy(true);
    try {
      const response = await fetch('/api/ml/anuncio/atualizar-preco', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: id,
          produtoId: productId, mlItemId: itemId, priceCents: cents, disableAutomaticPricing }) });
      const result = await response.json();
      if (!response.ok || !result.operationId) throw new Error(result.error || 'Alteração não confirmada.');
      setOperationId(result.operationId);
      setState('prepared');
      message.success('Alteração enviada. Acompanhando a confirmação no Mercado Livre.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Não foi possível confirmar o preço.');
    } finally { setBusy(false); }
  }

  return <>
    <Button disabled={disabled} onClick={() => { setPrice(priceCents == null ? null : priceCents / 100);
      if (state === 'confirmed' || state === 'failed') lastCommand.current = null;
      setState(null); setOperationId(null); setOpen(true); }}>Alterar preço</Button>
    <Modal title="Alterar preço no Mercado Livre" open={open} onCancel={() => setOpen(false)}
      footer={state ? <Button onClick={() => setOpen(false)}>Fechar</Button>
        : <Button type="primary" loading={busy} disabled={!price || price <= 0} onClick={() => void confirm()}>Confirmar</Button>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>Anúncio {itemId}</Typography.Text>
        <InputNumber aria-label="Novo preço" prefix="R$" min={0.01} precision={2} value={price}
          disabled={busy || Boolean(state)} onChange={setPrice} style={{ width: '100%' }} />
        {disableAutomaticPricing && <Alert type="info" message="A automação de preço do ML será desligada antes de aplicar este valor." />}
        {state && <Alert type={state === 'confirmed' ? 'success' : state === 'failed' || state === 'inconclusive' ? 'warning' : 'info'}
          message={state === 'confirmed' ? 'Preço aplicado e conferido.' : state === 'failed' ? 'Alteração não concluída.'
            : state === 'inconclusive' ? 'Resultado incerto. Confira o anúncio; o sistema não reenviará o preço.'
              : 'Enviado. Aguardando conferência no Mercado Livre.'} />}
      </Space>
    </Modal>
  </>;
}
