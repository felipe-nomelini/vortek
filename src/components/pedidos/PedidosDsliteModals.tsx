'use client';

import { Button, Input, Modal, Select, Space, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import ProgressModal from '@/components/modals/ProgressModal';
import { formatCurrency } from '@/lib/format';
import type { PedidosDsliteFlow } from './usePedidosDsliteFlow';

const { Text } = Typography;

interface PedidosDsliteModalsProps {
  flow: PedidosDsliteFlow;
}

function SupplierPaymentModal({ flow }: PedidosDsliteModalsProps) {
  const prompt = flow.paymentPrompt;
  const resumePaidFlow = Boolean(
    prompt?.resumeAfterConfirm
    && prompt.order.supplier_payment_status === 'paid',
  );

  return (
    <Modal
      title={resumePaidFlow
        ? 'Retomar fluxo DSLite'
        : prompt?.resumeAfterConfirm === false
          ? 'Enviar comprovante PIX ao fornecedor'
          : 'Confirmar PIX do fornecedor'}
      open={flow.paymentModalOpen}
      onCancel={flow.closePaymentModal}
      onOk={flow.confirmSupplierPayment}
      okText={resumePaidFlow
        ? 'Retomar fluxo'
        : prompt?.resumeAfterConfirm === false
          ? 'Enviar comprovante'
          : 'Confirmar PIX e continuar'}
      cancelText="Depois"
      confirmLoading={flow.confirmingPayment}
      maskClosable={false}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Text style={{ color: '#a0a0a0' }}>
          {resumePaidFlow
            ? 'O comprovante já foi enviado ao fornecedor. Esta ação apenas retoma etiqueta/transportadora.'
            : prompt?.resumeAfterConfirm === false
              ? 'Envie ou reenvie o comprovante PIX ao fornecedor sem retomar etapas de etiqueta.'
              : 'O pedido DSLite foi criado e precisa da confirmação do PIX para continuar etiqueta/transportadora.'}
        </Text>
        {(prompt?.supplierPixKeyMissing || prompt?.supplierPhoneMissing) && (
          <div style={{ background: '#2a1f00', border: '1px solid #faad1444', borderRadius: 8, padding: 12 }}>
            {prompt?.supplierPixKeyMissing && (
              <Text style={{ color: '#faad14', display: 'block' }}>
                Chave PIX não cadastrada para este fornecedor.
              </Text>
            )}
            {prompt?.supplierPhoneMissing && (
              <Text style={{ color: '#faad14', display: 'block' }}>
                WhatsApp do fornecedor não cadastrado. O comprovante será salvo, mas não será enviado automaticamente.
              </Text>
            )}
          </div>
        )}
        <div style={{ background: '#141414', border: '1px solid #303030', borderRadius: 8, padding: 12 }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text><b>Pedido DSLite:</b> #{prompt?.dsid || '—'}</Text>
            <Text><b>Fornecedor:</b> {prompt?.fornecedorNome || '—'}</Text>
            <Text><b>Valor PIX:</b> {formatCurrency(Number(prompt?.supplierPaymentAmount || 0))}</Text>
            <Space>
              <Text><b>Chave PIX:</b> {prompt?.supplierPixKey || 'Não cadastrada'}</Text>
              {prompt?.supplierPixKey && (
                <Button size="small" onClick={flow.copySupplierPixKey}>
                  Copiar
                </Button>
              )}
            </Space>
          </Space>
        </div>
        <Input
          placeholder="Referência do PIX (opcional)"
          value={flow.paymentReference}
          onChange={(event) => flow.setPaymentReference(event.target.value)}
          disabled={flow.confirmingPayment}
        />
        <Input.TextArea
          placeholder="Observações para o fornecedor (opcional)"
          value={flow.paymentNotes}
          onChange={(event) => flow.setPaymentNotes(event.target.value)}
          disabled={flow.confirmingPayment}
          rows={3}
        />
        {!(resumePaidFlow && prompt?.order.supplier_payment_receipt_path) && (
          <>
            <Upload
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              maxCount={1}
              beforeUpload={(file) => {
                flow.setPaymentReceiptFile(file);
                return false;
              }}
              onRemove={() => {
                flow.setPaymentReceiptFile(null);
              }}
              fileList={flow.paymentReceiptFile ? [{
                uid: 'supplier-payment-receipt',
                name: flow.paymentReceiptFile.name,
                status: 'done' as const,
              }] : []}
              disabled={flow.confirmingPayment}
            >
              <Button icon={<UploadOutlined />} disabled={flow.confirmingPayment}>
                {prompt?.order.supplier_payment_receipt_path ? 'Substituir comprovante' : 'Anexar comprovante'}
              </Button>
            </Upload>
            {prompt?.order.supplier_payment_receipt_path && !flow.paymentReceiptFile && (
              <Text type="secondary">Comprovante já salvo. Você pode continuar sem anexar novamente.</Text>
            )}
          </>
        )}
        {resumePaidFlow && prompt?.order.supplier_payment_receipt_path && (
          <Text type="secondary">Comprovante já salvo e já enviado. Nenhum novo envio será feito.</Text>
        )}
      </Space>
    </Modal>
  );
}

function DsliteShippingModal({ flow }: PedidosDsliteModalsProps) {
  return (
    <Modal
      title="Escolher frete pago da DSLite"
      open={flow.shippingModalOpen}
      onCancel={flow.closeShippingModal}
      onOk={flow.confirmShipping}
      okText="Selecionar frete"
      cancelText="Depois"
      confirmLoading={flow.confirmingShipping}
      okButtonProps={{ disabled: !flow.shippingSelection }}
      maskClosable={false}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Text type="secondary">
          Venda sem Mercado Envios. O fornecedor fará o transporte pelo próprio convênio e cobrará o frete da Vortek.
        </Text>
        <Text>
          <b>Pedido DSLite:</b> #{flow.shippingPrompt?.dsid || '—'}
        </Text>
        <Select
          style={{ width: '100%' }}
          placeholder="Selecione preço e prazo"
          value={flow.shippingSelection}
          onChange={flow.setShippingSelection}
          disabled={flow.confirmingShipping}
          options={(flow.shippingPrompt?.options || []).map((option) => ({
            value: option.transportadoraId,
            label: `${option.serviceName} · ${formatCurrency(option.price)} · ${
              option.deliveryDays > 0
                ? `${option.deliveryDays} dia${option.deliveryDays === 1 ? '' : 's'}`
                : 'prazo não informado'
            }`,
          }))}
        />
        <Text type="secondary">
          Valor estimado pela DSLite. Cobrança final do fornecedor pode sofrer ajuste.
        </Text>
      </Space>
    </Modal>
  );
}

export default function PedidosDsliteModals({ flow }: PedidosDsliteModalsProps) {
  return (
    <>
      <SupplierPaymentModal flow={flow} />
      <DsliteShippingModal flow={flow} />
      <ProgressModal
        open={flow.progressOpen}
        title="Criando Pedido DSLite"
        steps={flow.steps}
        onClose={flow.closeProgress}
        onCancel={flow.retryProgress}
        showCloseButton={flow.steps.some((step) => (
          step.status === 'error' || step.status === 'success' || step.status === 'warning'
        ))}
      />
    </>
  );
}
