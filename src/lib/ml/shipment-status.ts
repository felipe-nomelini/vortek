import type { Database } from '@/types/database';

export function mapearStatusShipment(
  shipmentStatus: string,
  shipmentSubstatus?: string,
): Database['public']['Enums']['pedido_status'] {
  switch (shipmentStatus) {
    case 'pending':
      return 'pendente';
    case 'handling':
      return 'preparando';
    case 'ready_to_ship':
      if (shipmentSubstatus === 'printed') return 'etiqueta_impressa';
      if (shipmentSubstatus === 'dropped_off') return 'coletado';
      if (shipmentSubstatus === 'picked_up') return 'coletado';
      if (shipmentSubstatus === 'authorized_by_carrier') return 'coletado';
      if (shipmentSubstatus === 'in_hub') return 'coletado';
      if (shipmentSubstatus === 'in_packing_list') return 'coletado';
      return 'pronto_envio';
    case 'shipped':
      if (shipmentSubstatus === 'out_for_delivery') return 'saiu_entrega';
      if (shipmentSubstatus === 'receiver_absent') return 'dest_ausente';
      return 'em_transito';
    case 'delivered':
      return 'entregue';
    case 'not_delivered':
      if (shipmentSubstatus === 'refused_delivery') return 'recusado';
      return 'dest_ausente';
    case 'cancelled':
      return 'cancelado';
    default:
      return 'aberto';
  }
}
