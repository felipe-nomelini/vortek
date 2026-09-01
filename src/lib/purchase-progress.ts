export type PurchaseStepStatus = 'wait' | 'process' | 'finish' | 'error';

export interface PurchaseProgressInput {
  status?: string | null;
  supplier_payment_mode?: string | null;
  supplier_payment_status?: string | null;
  bkr1_pix_deferred?: boolean;
  nf_numero?: string | null;
  nf_chave?: string | null;
  rastreio?: string | null;
}

export interface PurchaseProgress {
  items: Array<{ title: string; status: PurchaseStepStatus }>;
  nextLabel: string;
}

function isPresent(value: unknown): boolean {
  return Boolean(String(value || '').trim());
}

export function resolvePurchaseProgress(purchase: PurchaseProgressInput): PurchaseProgress {
  const purchaseStatus = String(purchase.status || '').trim();
  const paymentMode = String(purchase.supplier_payment_mode || '').trim();
  const paymentStatus = String(purchase.supplier_payment_status || '').trim();
  const hasInvoice = isPresent(purchase.nf_numero) || isPresent(purchase.nf_chave);
  const hasTracking = isPresent(purchase.rastreio);

  if (purchaseStatus === 'Cancelado') {
    return {
      items: [
        { title: 'DSLite', status: 'error' },
        { title: 'PIX', status: 'wait' },
        { title: 'NF', status: 'wait' },
        { title: 'Envio', status: 'wait' },
      ],
      nextLabel: 'Fluxo encerrado: compra cancelada',
    };
  }

  if (purchaseStatus === 'Revisão') {
    return {
      items: [
        { title: 'DSLite', status: 'error' },
        { title: 'PIX', status: 'wait' },
        { title: 'NF', status: 'wait' },
        { title: 'Envio', status: 'wait' },
      ],
      nextLabel: 'Revisar os dados da compra',
    };
  }

  if (purchaseStatus === 'Aguardando Informações') {
    return {
      items: [
        { title: 'DSLite', status: 'process' },
        { title: 'PIX', status: 'wait' },
        { title: 'NF', status: 'wait' },
        { title: 'Envio', status: 'wait' },
      ],
      nextLabel: 'Completar as informações da compra',
    };
  }

  let paymentStep: PurchaseStepStatus = 'finish';
  if (paymentMode === 'prepaid_pix') {
    if (paymentStatus === 'paid') paymentStep = 'finish';
    else if (paymentStatus === 'failed' || paymentStatus === 'cancelled') paymentStep = 'error';
    else paymentStep = 'process';
  }

  const invoiceStep: PurchaseStepStatus = hasInvoice
    ? 'finish'
    : paymentStep === 'finish' ? 'process' : 'wait';
  const shippingStep: PurchaseStepStatus = hasTracking
    ? 'process'
    : hasInvoice ? 'process' : 'wait';

  let nextLabel = 'Aguardar faturamento do fornecedor';
  if (paymentMode === 'prepaid_pix' && paymentStatus === 'failed') {
    nextLabel = 'Revisar o registro do PIX';
  } else if (paymentMode === 'prepaid_pix' && paymentStatus === 'cancelled') {
    nextLabel = 'Revisar o pagamento cancelado';
  } else if (paymentMode === 'prepaid_pix' && paymentStatus !== 'paid' && purchase.bkr1_pix_deferred) {
    nextLabel = 'Aguardar a etiqueta do Mercado Livre';
  } else if (paymentMode === 'prepaid_pix' && paymentStatus !== 'paid') {
    nextLabel = 'Registrar o PIX do fornecedor';
  } else if (!hasInvoice) {
    nextLabel = 'Aguardar faturamento do fornecedor';
  } else if (!hasTracking) {
    nextLabel = 'Aguardar o código de rastreio';
  } else {
    nextLabel = 'Acompanhar a entrega';
  }

  return {
    items: [
      { title: 'DSLite', status: 'finish' },
      { title: 'PIX', status: paymentStep },
      { title: 'NF', status: invoiceStep },
      { title: 'Envio', status: shippingStep },
    ],
    nextLabel,
  };
}
