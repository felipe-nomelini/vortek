'use client';

import { Input, Modal, Space, Typography } from 'antd';
import ProgressModal from '@/components/modals/ProgressModal';
import type { PedidosLabelWhatsappFlow } from './usePedidosLabelWhatsappFlow';

const { Text } = Typography;

interface PedidosLabelWhatsappModalsProps {
  flow: PedidosLabelWhatsappFlow;
}

export default function PedidosLabelWhatsappModals({ flow }: PedidosLabelWhatsappModalsProps) {
  return (
    <>
      <Modal
        title={flow.whatsappUsePlaceholderLabel
          ? 'Enviar etiqueta genérica por WhatsApp'
          : `Enviar etiqueta real${flow.whatsappOrder?.fornecedor_nome ? ` — ${flow.whatsappOrder.fornecedor_nome}` : ''}`}
        open={flow.whatsappModalOpen}
        onCancel={flow.closeWhatsappLabelModal}
        onOk={flow.sendWhatsappLabel}
        okText="Enviar"
        cancelText="Cancelar"
        confirmLoading={flow.sendingWhatsappLabel}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text style={{ color: '#a0a0a0' }}>
            Pedido venda #{flow.whatsappOrder?.numero || '—'}.
            {flow.whatsappOrder?.dslite_id ? ` Pedido DSLite #${flow.whatsappOrder.dslite_id}.` : ' Sem pedido DSLite vinculado.'}
            {flow.whatsappUsePlaceholderLabel ? ' Será enviada a etiqueta genérica de teste.' : ''}
            {' '}Confirme o WhatsApp do fornecedor para envio da etiqueta real.
          </Text>
          <Input
            placeholder="Ex.: 11999999999"
            value={flow.whatsappPhone}
            onChange={(event) => flow.setWhatsappPhone(event.target.value)}
            disabled={flow.sendingWhatsappLabel}
          />
        </Space>
      </Modal>
      <ProgressModal
        open={flow.whatsappProgressOpen}
        title="Enviando Etiqueta por WhatsApp"
        steps={flow.whatsappSteps}
        onClose={flow.closeWhatsappProgress}
        showCloseButton={flow.whatsappSteps.some((step) => (
          step.status === 'error' || step.status === 'success' || step.status === 'warning'
        ))}
      />
      <ProgressModal
        open={flow.labelProgressOpen}
        title={flow.labelDownloadUrl ? 'Etiqueta pronta para envio próprio' : 'Completando Etiqueta DSLite'}
        steps={flow.labelSteps}
        onClose={flow.closeLabelProgress}
        showCloseButton={flow.labelSteps.some((step) => step.status === 'error' || step.status === 'success')}
        customActions={flow.labelDownloadUrl ? [
          {
            key: 'download_direct_label',
            label: 'Baixar térmica PDF 100x150',
            primary: true,
            onClick: () => window.open(flow.labelDownloadUrl || '', '_blank', 'noopener,noreferrer'),
          },
          ...(flow.labelZplDownloadUrl ? [{
            key: 'download_direct_label_zpl',
            label: 'Baixar ZPL',
            onClick: () => window.open(flow.labelZplDownloadUrl || '', '_blank', 'noopener,noreferrer'),
          }] : []),
        ] : flow.labelDuplicateDecision ? [
          {
            key: 'open_nf_found',
            label: 'Abrir Nota Encontrada',
            onClick: flow.openDuplicateInvoice,
          },
          {
            key: 'use_existing_nf',
            label: 'Prosseguir com Nota Encontrada',
            primary: true,
            onClick: () => { void flow.runDuplicateAction('use_existing'); },
          },
          {
            key: 'reissue_nf',
            label: 'Gerar Nova Nota',
            danger: true,
            onClick: () => { void flow.runDuplicateAction('reissue'); },
          },
        ] : []}
      />
    </>
  );
}
