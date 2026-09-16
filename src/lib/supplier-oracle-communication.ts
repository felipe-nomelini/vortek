import { createHash } from 'node:crypto';

type Settlement = {
  id: string;
  fornecedor_nome_snapshot: string;
  cnpj_snapshot: string;
  gross_amount: number;
  credit_amount: number;
  pix_amount: number;
  payment_reference: string | null;
};

type Item = {
  settlement_id: string;
  sale_number_snapshot: number;
  product_description_snapshot: string | null;
  quantity_snapshot: number | null;
};

export function supplierOracleSelectionKey(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join('|')).digest('hex');
}

function money(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function oneLine(value: string | null): string {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildSupplierOracleMessage(settlements: Settlement[], items: Item[]): string {
  const sections = [...settlements].sort((a, b) => a.cnpj_snapshot.localeCompare(b.cnpj_snapshot) || a.id.localeCompare(b.id))
    .map((settlement) => {
      const purchases = items.filter((item) => item.settlement_id === settlement.id)
        .sort((a, b) => a.sale_number_snapshot - b.sale_number_snapshot);
      if (!purchases.length) throw new Error('Liquidação sem itens');
      const lines = [
        `${oneLine(settlement.fornecedor_nome_snapshot)} — CNPJ ${settlement.cnpj_snapshot}`,
        `Liquidação ${settlement.id}`,
        ...purchases.map((item) => `Venda #${item.sale_number_snapshot}: ${oneLine(item.product_description_snapshot) || 'Produto'} (${item.quantity_snapshot || 1} un.)`),
        `Bruto: ${money(Number(settlement.gross_amount))}`,
        `Crédito aplicado: ${money(Number(settlement.credit_amount))}`,
        `PIX líquido: ${money(Number(settlement.pix_amount))}`,
      ];
      if (Number(settlement.pix_amount) === 0) lines.push('Quitação integral por crédito; sem transferência PIX.');
      else if (settlement.payment_reference) lines.push(`Referência PIX: ${oneLine(settlement.payment_reference)}`);
      return lines.join('\n');
    });
  const body = `Olá! Segue o resumo das liquidações confirmadas:\n\n${sections.join('\n\n')}\n\nConfira os dados e nos avise em caso de divergência.`;
  if (body.length > 10000) throw new Error('Mensagem excede o limite de 10.000 caracteres');
  return body;
}
