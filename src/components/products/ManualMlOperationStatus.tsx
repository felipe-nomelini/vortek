'use client';

import { useEffect, useState } from 'react';
import { Alert } from 'antd';

export default function ManualMlOperationStatus({ operationId }: { operationId: string }) {
  const [operation, setOperation] = useState<{ state: string; item_id: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let attempts = 0;
    let terminal = false;
    const read = async () => {
      try {
        const response = await fetch(`/api/ml/operacoes?operationId=${encodeURIComponent(operationId)}`, { cache: 'no-store' });
        if (response.ok && active) {
          const next = await response.json();
          setOperation(next);
          terminal = ['confirmed', 'failed', 'inconclusive'].includes(next.state);
        }
      } catch { /* Falha de leitura não reenfileira a operação. */ }
      attempts++;
      if (active && !terminal && attempts < 90) timer = window.setTimeout(read, 2000);
    };
    void read();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [operationId]);
  const state = operation?.state;
  return <Alert showIcon type={state === 'confirmed' ? 'success' : state === 'failed' || state === 'inconclusive' ? 'warning' : 'info'}
    message={state === 'confirmed' ? `Confirmado no Mercado Livre${operation?.item_id ? `: ${operation.item_id}` : ''}`
      : state === 'failed' ? 'Operação não concluída. Confira os dados do anúncio.'
        : state === 'inconclusive' ? 'Resultado incerto. Confira o anúncio no ML; o sistema não reenviará a ação.'
          : 'Enviado. Aguardando conferência no Mercado Livre.'} />;
}
