import { z } from 'zod';

const NCM_REGEX = /^\d{4}\.?\d{2}\.?\d{2}$/;
const ORIGEM_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8'] as const;

export const fiscalStrictSchema = z.object({
  ncm: z.string().trim().regex(NCM_REGEX, 'NCM inválido. Use 8 dígitos (com ou sem pontos).'),
  origem_fiscal: z.enum(ORIGEM_VALUES, { message: 'Origem fiscal inválida.' }),
  csosn: z.string().trim().min(3, 'CSOSN é obrigatório.'),
  sku: z.string().trim().min(1, 'SKU é obrigatório.'),
  title: z.string().trim().min(1, 'Título é obrigatório.'),
});

export function mapOriginType(origemFiscal: string): 'manufacturer' | 'reseller' | 'imported' {
  if (origemFiscal === '1') return 'manufacturer';
  if (origemFiscal === '3' || origemFiscal === '5' || origemFiscal === '8') return 'imported';
  return 'reseller';
}

export function normalizeNcm(ncm: string): string {
  return ncm.replace(/\./g, '');
}
