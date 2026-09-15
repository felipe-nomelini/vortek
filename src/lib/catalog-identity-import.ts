import ExcelJS from 'exceljs';

export type CatalogIdentityBaselineRow = {
  mlItemId: string;
  inputRow: Record<string, string | number | boolean | null>;
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_ROWS = 3_000;
const ITEM_ID_ALIASES = new Set([
  'ml_item_id', 'ml item id', 'item id', 'id do anuncio', 'id anuncio', 'anuncio id', 'anuncio_id', 'codigo ml',
]);

function normalizeHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function safeCell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text || '').slice(0, 1_000);
  if (typeof value === 'object' && 'result' in value) return safeCell((value as { result?: unknown }).result);
  return String(value).trim().slice(0, 1_000);
}

function parseCsvRows(source: string): string[][] {
  let commas = 0;
  let semicolons = 0;
  let headerQuoted = false;
  for (const char of source.split(/\r?\n/, 1)[0] || '') {
    if (char === '"') headerQuoted = !headerQuoted;
    else if (!headerQuoted && char === ',') commas += 1;
    else if (!headerQuoted && char === ';') semicolons += 1;
  }
  const delimiter = semicolons > commas ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell); cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
  }
  return rows;
}

async function spreadsheetRows(fileName: string, buffer: Buffer): Promise<unknown[][]> {
  if (/\.csv$/i.test(fileName)) return parseCsvRows(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  if (!/\.xlsx$/i.test(fileName)) throw new Error('baseline_file_type_invalid');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('baseline_worksheet_missing');
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (excelRow) => {
    const values = Array.isArray(excelRow.values) ? excelRow.values.slice(1) : [];
    rows.push(values);
  });
  return rows;
}

export async function parseCatalogIdentityBaseline(fileName: string, buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('baseline_file_size_invalid');
  const rows = await spreadsheetRows(fileName, buffer);
  if (rows.length < 2 || rows.length > MAX_ROWS + 1) throw new Error('baseline_row_count_invalid');
  const headers = rows[0].map((value, index) => normalizeHeader(value) || `coluna ${index + 1}`);
  let itemIndex = headers.findIndex(header => ITEM_ID_ALIASES.has(header));
  if (itemIndex < 0) {
    itemIndex = rows[1].findIndex(value => /^MLB\d+$/i.test(String(safeCell(value) || '').trim()));
  }
  if (itemIndex < 0) throw new Error('baseline_ml_item_id_column_missing');
  const parsed: CatalogIdentityBaselineRow[] = [];
  for (const sourceRow of rows.slice(1)) {
    const mlItemId = String(safeCell(sourceRow[itemIndex]) || '').trim().toUpperCase();
    if (!mlItemId) continue;
    if (!/^MLB\d+$/.test(mlItemId)) throw new Error(`baseline_ml_item_id_invalid:${parsed.length + 2}`);
    const inputRow = Object.fromEntries(headers.map((header, index) => [header, safeCell(sourceRow[index])]));
    parsed.push({ mlItemId, inputRow });
  }
  const uniqueIds = new Set(parsed.map(row => row.mlItemId));
  if (parsed.length !== 1_550 || uniqueIds.size !== 1_550) throw new Error('baseline_requires_1550_unique_items');
  return parsed;
}
