const fs = require('node:fs');
const path = require('node:path');
const {
  PDFDocument,
  StandardFonts,
  rgb,
} = require('pdf-lib');

const OUTPUT_PATH = path.join(
  process.cwd(),
  'public',
  'dslite',
  'labels',
  'etiqueta_evolusom_aguardando_etiqueta_ml.pdf',
);

function drawCenteredText(page, text, y, font, size) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (page.getWidth() - width) / 2,
    y,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

async function main() {
  const document = await PDFDocument.create();
  document.setTitle('Etiqueta provisória Evolusom');
  document.setSubject('Aguardar etiqueta oficial do Mercado Livre');
  document.setAuthor('Vortek');
  document.setCreator('Vortek ERP');
  document.setProducer('Vortek ERP');
  const fixedDate = new Date('2026-07-27T12:00:00.000Z');
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);

  const page = document.addPage([595.28, 841.89]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  const boxX = 82;
  const boxY = 228;
  const boxWidth = 431;
  const boxHeight = 400;
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 2,
  });

  drawCenteredText(page, 'EVOLUSOM', 574, bold, 25);
  drawCenteredText(page, 'ETIQUETA PROVISÓRIA', 532, bold, 21);
  page.drawLine({
    start: { x: boxX, y: 510 },
    end: { x: boxX + boxWidth, y: 510 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  drawCenteredText(page, 'Pedido com etiqueta do Mercado Livre pendente.', 470, regular, 14);
  drawCenteredText(page, 'A etiqueta oficial será enviada posteriormente', 442, regular, 14);
  drawCenteredText(page, 'pelo vendedor assim que estiver disponível.', 414, regular, 14);

  page.drawLine({
    start: { x: boxX, y: 382 },
    end: { x: boxX + boxWidth, y: 382 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  drawCenteredText(page, 'AGUARDE A ETIQUETA OFICIAL', 338, bold, 18);
  drawCenteredText(page, 'NÃO DESPACHE COM ESTE DOCUMENTO', 300, bold, 16);
  drawCenteredText(
    page,
    'Documento provisório para liberação do pedido na DSLite.',
    252,
    regular,
    10,
  );

  const bytes = await document.save({ useObjectStreams: true });
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, bytes);
  process.stdout.write(`${OUTPUT_PATH} (${bytes.length} bytes)\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
