import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DSLITE_PLACEHOLDER_LABEL_FILE_NAME = 'etiqueta_frete_terceiros_posterior.pdf';
export const DSLITE_PLACEHOLDER_LABEL_SOURCE = 'placeholder_release_window';

const PLACEHOLDER_LABEL_PATH = path.join(
  process.cwd(),
  'public',
  'dslite',
  'labels',
  'etiqueta-frete-terceiros-posterior.pdf',
);

export async function loadDslitePlaceholderLabel(): Promise<Buffer> {
  const buffer = await readFile(PLACEHOLDER_LABEL_PATH);
  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
    throw new Error('Etiqueta padrão DSLite inválida: arquivo não é PDF.');
  }
  return buffer;
}
