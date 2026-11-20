import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from 'pdf-lib';

/** Generates a small multi-page PDF with text, an image and shapes for demos and tests. */
export async function createSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Sample document');
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const courier = await doc.embedFont(StandardFonts.Courier);

  // A 64x64 gradient image as a raw RGB image XObject.
  const size = 64;
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      pixels[i] = 40 + x * 3;
      pixels[i + 1] = 90 + y * 2;
      pixels[i + 2] = 200;
    }
  }
  const imageRef = doc.context.register(
    doc.context.flateStream(pixels, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: size,
      Height: size,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
    }),
  );

  const p1 = doc.addPage([612, 792]);
  p1.drawRectangle({ x: 0, y: 712, width: 612, height: 80, color: rgb(0.93, 0.95, 1) });
  p1.drawText('Quarterly Report', { x: 50, y: 740, size: 28, font: helvBold, color: rgb(0.1, 0.2, 0.5) });
  p1.drawText('Prepared by the Example Company', { x: 50, y: 680, size: 14, font: helv, color: rgb(0.3, 0.3, 0.3) });
  const body = [
    'This sample document demonstrates the in-browser PDF editor.',
    'Click any line of text to change its wording, font, size or color.',
    'Use the eraser to remove content, or add text, images and shapes.',
    'Pages can be reordered, rotated and deleted from the sidebar.',
  ];
  body.forEach((line, i) => p1.drawText(line, { x: 50, y: 630 - i * 20, size: 12, font: times }));
  p1.drawText('Total revenue: $1,234,567', { x: 50, y: 530, size: 16, font: helvBold, color: rgb(0.7, 0.1, 0.1) });
  p1.drawText('Figures are unaudited.', { x: 50, y: 508, size: 11, font: timesItalic });
  const imgName = p1.node.newXObject('Im', imageRef);
  p1.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(160, 0, 0, 160, 400, 450),
    drawObject(imgName),
    popGraphicsState(),
  );
  p1.drawText('Code: SAMPLE-001', { x: 50, y: 470, size: 10, font: courier });

  const p2 = doc.addPage([612, 792]);
  p2.drawText('Page Two', { x: 50, y: 730, size: 24, font: helvBold });
  p2.drawText('A second page with some shapes.', { x: 50, y: 700, size: 12, font: helv });
  p2.drawCircle({ x: 150, y: 550, size: 60, color: rgb(0.2, 0.6, 0.3) });
  p2.drawRectangle({ x: 300, y: 500, width: 150, height: 100, borderColor: rgb(0.8, 0.4, 0), borderWidth: 3 });

  const p3 = doc.addPage([612, 792]);
  p3.drawText('Page Three', { x: 50, y: 730, size: 24, font: helvBold });
  p3.drawText('The last page of the sample.', { x: 50, y: 700, size: 12, font: times });

  return doc.save();
}
