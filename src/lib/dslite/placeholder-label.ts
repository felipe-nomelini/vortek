import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isBkr1Supplier } from '@/lib/supplier-balance';

export const DSLITE_PLACEHOLDER_LABEL_FILE_NAME = 'etiqueta_frete_terceiros_posterior.pdf';
export const DSLITE_PLACEHOLDER_LABEL_SOURCE = 'placeholder_release_window';
export const DSLITE_BKR1_PLACEHOLDER_LABEL_FILE_NAME = 'etiqueta_bkr1_aguardando_etiqueta_ml.pdf';
export const DSLITE_BKR1_PLACEHOLDER_LABEL_SOURCE = 'placeholder_release_window_bkr1';
export const DSLITE_MERCADO_LIVRE_LABEL_SOURCE = 'mercado_livre';

const PLACEHOLDER_LABEL_PATH = path.join(
  process.cwd(),
  'public',
  'dslite',
  'labels',
  'etiqueta-frete-terceiros-posterior.pdf',
);
const BKR1_PLACEHOLDER_LABEL_PATH = path.join(
  process.cwd(),
  'public',
  'dslite',
  'labels',
  DSLITE_BKR1_PLACEHOLDER_LABEL_FILE_NAME,
);

export function getDslitePlaceholderLabelConfig(
  fornecedorId?: string | number | null,
  fornecedorNome?: string | null,
) {
  if (isBkr1Supplier(fornecedorId, fornecedorNome)) {
    return {
      source: DSLITE_BKR1_PLACEHOLDER_LABEL_SOURCE,
      fileName: DSLITE_BKR1_PLACEHOLDER_LABEL_FILE_NAME,
      path: BKR1_PLACEHOLDER_LABEL_PATH,
      supplierLabel: 'BKR1',
    };
  }
  return {
    source: DSLITE_PLACEHOLDER_LABEL_SOURCE,
    fileName: DSLITE_PLACEHOLDER_LABEL_FILE_NAME,
    path: PLACEHOLDER_LABEL_PATH,
    supplierLabel: 'Hayamax',
  };
}

export async function loadDslitePlaceholderLabel(
  fornecedorId?: string | number | null,
  fornecedorNome?: string | null,
): Promise<Buffer> {
  const config = getDslitePlaceholderLabelConfig(fornecedorId, fornecedorNome);
  const buffer = await readFile(config.path);
  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
    throw new Error('Etiqueta padrão DSLite inválida: arquivo não é PDF.');
  }
  return buffer;
}
