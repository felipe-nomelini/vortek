const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  PDFDocument,
  StandardFonts,
  rgb,
} = require('pdf-lib');

const POINTS_PER_MM = 72 / 25.4;
const PAGE_WIDTH = 100 * POINTS_PER_MM;
const PAGE_HEIGHT = 150 * POINTS_PER_MM;
const LABEL_HEIGHT = PAGE_HEIGHT / 2;
const OUTPUT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.homedir(), 'Downloads', 'etiqueta_seguranca_vortek_100x150.pdf');
const LOGO_PATH = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(process.cwd(), 'public', 'logo.png');
const THERMAL_MONO = process.argv.includes('--thermal-mono');

function mm(value) {
  return value * POINTS_PER_MM;
}

function drawCenteredText(page, text, y, font, size, color = rgb(0, 0, 0)) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (PAGE_WIDTH - width) / 2,
    y,
    size,
    font,
    color,
  });
}

async function loadLogoWithoutTransparentMargins() {
  const source = fs.readFileSync(LOGO_PATH);
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const hasVisibleInk = data[offset + 3] > 10
        && (data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245);
      if (!hasVisibleInk) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) throw new Error('Logotipo Vortek sem conteúdo visível');
  const width = right - left + 1;
  const height = bottom - top + 1;
  const cropped = await sharp(source)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer();
  if (!THERMAL_MONO) {
    return sharp(cropped, { raw: { width, height, channels: 4 } }).png().toBuffer();
  }

  for (let offset = 0; offset < cropped.length; offset += 4) {
    const red = cropped[offset];
    const green = cropped[offset + 1];
    const blue = cropped[offset + 2];
    const alpha = cropped[offset + 3];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const isBlackLogoInk = alpha > 10 && maximum < 220 && maximum - minimum < 45;
    const isRedLogoInk = alpha > 10 && red > 100 && red - green > 60 && red - blue > 60;
    const thermalGray = isRedLogoInk ? 165 : 0;
    cropped[offset] = thermalGray;
    cropped[offset + 1] = thermalGray;
    cropped[offset + 2] = thermalGray;
    cropped[offset + 3] = isBlackLogoInk || isRedLogoInk ? alpha : 0;
  }

  return sharp(cropped, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function drawLabel(page, bottom, logo, regular, bold) {
  const left = mm(3);
  const right = PAGE_WIDTH - mm(3);
  const lower = bottom + mm(3);
  const upper = bottom + LABEL_HEIGHT - mm(3);
  const corner = mm(4);
  const framePoints = [
    { x: left + corner, y: lower },
    { x: right - corner, y: lower },
    { x: right, y: lower + corner },
    { x: right, y: upper - corner },
    { x: right - corner, y: upper },
    { x: left + corner, y: upper },
    { x: left, y: upper - corner },
    { x: left, y: lower + corner },
  ];
  for (let index = 0; index < framePoints.length; index += 1) {
    page.drawLine({
      start: framePoints[index],
      end: framePoints[(index + 1) % framePoints.length],
      thickness: 0.8,
      color: rgb(0.58, 0.58, 0.58),
    });
  }

  const accentLength = mm(12);
  const accentThickness = 2.1;
  page.drawLine({
    start: { x: left + corner, y: upper },
    end: { x: left + corner + accentLength, y: upper },
    thickness: accentThickness,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: left, y: upper - corner },
    end: { x: left + corner, y: upper },
    thickness: accentThickness,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: right - corner - accentLength, y: lower },
    end: { x: right - corner, y: lower },
    thickness: accentThickness,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: right - corner, y: lower },
    end: { x: right, y: lower + corner },
    thickness: accentThickness,
    color: rgb(0, 0, 0),
  });

  const logoScale = Math.min(mm(72) / logo.width, mm(13) / logo.height);
  const logoWidth = logo.width * logoScale;
  const logoHeight = logo.height * logoScale;
  page.drawImage(logo, {
    x: (PAGE_WIDTH - logoWidth) / 2,
    y: bottom + mm(53),
    width: logoWidth,
    height: logoHeight,
  });

  page.drawRectangle({
    x: mm(6),
    y: bottom + mm(39.5),
    width: PAGE_WIDTH - mm(12),
    height: mm(10),
    color: rgb(0.88, 0.88, 0.88),
  });
  page.drawRectangle({
    x: mm(6),
    y: bottom + mm(39.5),
    width: mm(1.5),
    height: mm(10),
    color: rgb(0, 0, 0),
  });
  page.drawRectangle({
    x: PAGE_WIDTH - mm(7.5),
    y: bottom + mm(39.5),
    width: mm(1.5),
    height: mm(10),
    color: rgb(0, 0, 0),
  });
  drawCenteredText(
    page,
    'ETIQUETA DE SEGURANÇA',
    bottom + mm(42.1),
    bold,
    14.5,
  );

  drawCenteredText(
    page,
    'Confira a integridade desta etiqueta',
    bottom + mm(31.5),
    regular,
    10.5,
  );
  drawCenteredText(
    page,
    'antes de receber o produto.',
    bottom + mm(26),
    regular,
    10.5,
  );
  drawCenteredText(
    page,
    'Se estiver rompida, cortada ou violada,',
    bottom + mm(20.5),
    bold,
    10.2,
  );

  page.drawLine({
    start: { x: mm(5), y: bottom + mm(11) },
    end: { x: mm(15), y: bottom + mm(11) },
    thickness: 1.4,
    color: rgb(0.58, 0.58, 0.58),
  });
  page.drawLine({
    start: { x: PAGE_WIDTH - mm(15), y: bottom + mm(11) },
    end: { x: PAGE_WIDTH - mm(5), y: bottom + mm(11) },
    thickness: 1.4,
    color: rgb(0.58, 0.58, 0.58),
  });
  page.drawRectangle({
    x: mm(17),
    y: bottom + mm(6.5),
    width: PAGE_WIDTH - mm(34),
    height: mm(9),
    color: rgb(0, 0, 0),
  });
  drawCenteredText(
    page,
    'NÃO RECEBA O PRODUTO',
    bottom + mm(9),
    bold,
    11.5,
    rgb(1, 1, 1),
  );
}

async function main() {
  const logoBytes = await loadLogoWithoutTransparentMargins();

  const document = await PDFDocument.create();
  document.setTitle('Etiqueta de Segurança Vortek 100x150mm');
  document.setSubject('Duas etiquetas de segurança de 100x75mm');
  document.setAuthor('Vortek');
  document.setCreator('Vortek ERP');
  document.setProducer('Vortek ERP');

  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await document.embedPng(logoBytes);

  drawLabel(page, 0, logo, regular, bold);
  drawLabel(page, LABEL_HEIGHT, logo, regular, bold);

  for (let x = mm(1.5); x < PAGE_WIDTH; x += mm(5)) {
    page.drawLine({
      start: { x, y: LABEL_HEIGHT },
      end: { x: Math.min(x + mm(3), PAGE_WIDTH), y: LABEL_HEIGHT },
      thickness: 0.8,
      color: rgb(0, 0, 0),
    });
  }

  const bytes = await document.save({ useObjectStreams: false });
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, bytes);
  process.stdout.write(`${OUTPUT_PATH} (${bytes.length} bytes)\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
