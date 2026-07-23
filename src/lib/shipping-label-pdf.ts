import { degrees, PDFDocument, type PDFEmbeddedPage, type PDFPage } from 'pdf-lib';

const POINTS_PER_MM = 72 / 25.4;
const TARGET_WIDTH = 100 * POINTS_PER_MM;
const TARGET_HEIGHT = 150 * POINTS_PER_MM;
const ML_COMPACT_LABEL_WIDTH = 90 * POINTS_PER_MM;
const ML_COMPACT_LABEL_HEIGHT = 150 * POINTS_PER_MM;
const ML_A4_LABEL_MARGIN = 10 * POINTS_PER_MM;
const DIMENSION_TOLERANCE = 4;

function isClose(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= DIMENSION_TOLERANCE;
}

function isA4Page(width: number, height: number): boolean {
  const a4Width = 210 * POINTS_PER_MM;
  const a4Height = 297 * POINTS_PER_MM;
  return (
    (isClose(width, a4Width) && isClose(height, a4Height)) ||
    (isClose(width, a4Height) && isClose(height, a4Width))
  );
}

function isPortraitThermalPage(width: number, height: number): boolean {
  return (
    width < height &&
    width >= 85 * POINTS_PER_MM &&
    width <= 105 * POINTS_PER_MM &&
    height >= 140 * POINTS_PER_MM &&
    height <= 160 * POINTS_PER_MM
  );
}

function isLandscapeThermalPage(width: number, height: number): boolean {
  return isPortraitThermalPage(height, width);
}

function drawPortraitPage(
  targetPage: PDFPage,
  embeddedPage: PDFEmbeddedPage,
  sourceWidth: number,
  sourceHeight: number,
): void {
  const scale = Math.min(TARGET_WIDTH / sourceWidth, TARGET_HEIGHT / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  targetPage.drawPage(embeddedPage, {
    x: (TARGET_WIDTH - width) / 2,
    y: (TARGET_HEIGHT - height) / 2,
    width,
    height,
  });
}

/**
 * Recorta somente a etiqueta oficial do Mercado Livre e a coloca, sem
 * distorção, em uma página PDF vertical de 100 x 150 mm.
 *
 * O PDF brasileiro do ML pode trazer a etiqueta compacta de 90 x 150 mm no
 * canto superior esquerdo de uma folha A4. Páginas adicionais de resumo não
 * fazem parte da etiqueta térmica e são deliberadamente descartadas.
 */
export async function normalizeMlShippingLabelPdfForThermalPrint(
  input: Buffer | Uint8Array,
): Promise<Buffer> {
  const sourceDocument = await PDFDocument.load(input);
  if (sourceDocument.getPageCount() < 1) {
    throw new Error('PDF do Mercado Livre não contém páginas');
  }

  const sourcePage = sourceDocument.getPage(0);
  const sourceWidth = sourcePage.getWidth();
  const sourceHeight = sourcePage.getHeight();
  const outputDocument = await PDFDocument.create();
  const targetPage = outputDocument.addPage([TARGET_WIDTH, TARGET_HEIGHT]);

  if (isA4Page(sourceWidth, sourceHeight)) {
    const top = sourceHeight - ML_A4_LABEL_MARGIN;
    const bottom = top - ML_COMPACT_LABEL_HEIGHT;
    const left = ML_A4_LABEL_MARGIN;
    const right = left + ML_COMPACT_LABEL_WIDTH;
    if (bottom < 0 || right > sourceWidth) {
      throw new Error('Etiqueta compacta não cabe na primeira página A4');
    }

    const embeddedPage = await outputDocument.embedPage(sourcePage, {
      left,
      right,
      bottom,
      top,
    });
    targetPage.drawPage(embeddedPage, {
      x: (TARGET_WIDTH - ML_COMPACT_LABEL_WIDTH) / 2,
      y: 0,
      width: ML_COMPACT_LABEL_WIDTH,
      height: ML_COMPACT_LABEL_HEIGHT,
    });
  } else if (isPortraitThermalPage(sourceWidth, sourceHeight)) {
    const embeddedPage = await outputDocument.embedPage(sourcePage);
    drawPortraitPage(targetPage, embeddedPage, sourceWidth, sourceHeight);
  } else if (isLandscapeThermalPage(sourceWidth, sourceHeight)) {
    const embeddedPage = await outputDocument.embedPage(sourcePage);
    const scale = Math.min(TARGET_WIDTH / sourceHeight, TARGET_HEIGHT / sourceWidth);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    targetPage.drawPage(embeddedPage, {
      x: (TARGET_WIDTH + height) / 2,
      y: (TARGET_HEIGHT - width) / 2,
      width,
      height,
      rotate: degrees(90),
    });
  } else {
    throw new Error(
      `Formato de etiqueta PDF não suportado (${sourceWidth.toFixed(1)} x ${sourceHeight.toFixed(1)} pontos)`,
    );
  }

  outputDocument.setTitle('Etiqueta Mercado Livre 100x150mm');
  outputDocument.setProducer('Vortek');
  return Buffer.from(await outputDocument.save({ useObjectStreams: false }));
}
