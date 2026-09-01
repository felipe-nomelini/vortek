'use client';

import { Button, Modal } from 'antd';
import { CarOutlined } from '@ant-design/icons';
import OrderTrackingDetails from '@/components/pedidos/OrderTrackingDetails';
import type { OrderStatus } from '@/types/order';

type TrackingModalProps = {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderStatus: OrderStatus;
};

export default function TrackingModal({
  open,
  onClose,
  orderId,
  orderStatus,
}: TrackingModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Fechar</Button>}
      width={720}
      destroyOnHidden
      title={<><CarOutlined /> Acompanhamento da entrega</>}
    >
      <OrderTrackingDetails
        orderId={orderId}
        orderStatus={orderStatus}
        enabled={open}
      />
    </Modal>
  );
}
