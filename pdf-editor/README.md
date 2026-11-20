# PDF Editor

A free PDF editor that runs entirely in the browser. Upload a PDF, edit it, and download the result. Files are never uploaded anywhere.

Built with Vite, React and TypeScript, using [pdf.js](https://github.com/mozilla/pdf.js) for rendering and text extraction and [pdf-lib](https://pdf-lib.js.org/) for writing.

## Features

- **Edit existing text in place.** Click any line to change its wording, font family (sans, serif, mono), size, color, bold and italic. The original font style and color are detected automatically.
- **True removal of original text.** Edited and deleted text is removed from the page's content stream instead of being painted over (see "How text editing works" below).
- **Erase and remove.** The eraser (whiteout) tool removes text and images under a region and paints it with a fill color (or with no fill). You can also select and delete images that are part of the original PDF.
- **Add content.** Add text boxes, images (PNG, JPEG, and any other format the browser can decode), rectangles, ellipses and lines. Objects can be moved, resized, restyled and deleted.
- **Page operations.** Reorder pages (drag and drop or arrow buttons), rotate them, delete them, and add blank pages.
- **Undo and redo** for every change (<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>). Each drag counts as a single step.
- **Download** the edited PDF. Document-level data such as metadata, outlines and form fields is preserved.

## Run it

Requires Node.js 20 or newer.

```bash
cd pdf-editor
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and build a static site into `dist/` (deployable to any static host) |
| `npm run preview` | Serve the production build |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | Browser end-to-end test (start `npm run dev` first; see below) |
| `npm run typecheck` | TypeScript only |

`npm run dev` and `npm run build` first copy pdf.js runtime assets (CMaps, standard fonts, wasm decoders) into `public/pdfjs/`.

### End-to-end test

`e2e/run-e2e.mjs` drives the app in Chromium with Playwright using the built-in sample PDF. It edits and restyles text, deletes text, erases a region, deletes an image, and adds text, shapes and an image. It also tests undo/redo and page operations, downloads the result, and verifies the downloaded PDF with pdf.js.

```bash
npx playwright install chromium   # or set CHROME_PATH=/path/to/chrome
npm run dev &
npm run test:e2e                  # E2E_VIDEO=1 records a video into e2e/output/
```

## How text editing works

1. pdf.js extracts text items, and neighbouring items on the same line with the same font are merged into editable runs.
2. A small content-stream interpreter (`src/lib/pdfAnalysis.ts`) replays the page's operators (graphics state, `cm`, text state, `Tj`/`TJ`/`'`/`"`, `Do`, inline images). Using each font's real metrics (`/Widths`, CID `/W` arrays, or standard-14 AFM metrics), it computes a bounding box for every glyph and image.
3. On export, glyphs whose centers fall inside an edited run or erased region are removed. Each removed glyph is replaced by an equivalent `TJ` position adjustment, so the remaining text on the line stays exactly where it was. Images are removed by dropping their `Do`/`BI` operators.
4. The replacement text is drawn with the closest standard PDF font, matched from the original font name: Helvetica, Times or Courier, including bold/italic variants. It is placed on the original baseline in the color sampled from the rendered page.
5. **Fallback:** if the original text can't be removed (for example, it's inside a form XObject or uses an unsupported encoding), the area is covered with the background color sampled from the page (cover-and-replace).

## Project layout

```
src/
  lib/            core logic (framework-independent, unit tested)
    contentStream.ts   PDF content stream tokenizer/parser
    pdfAnalysis.ts     glyph/image geometry + content rewriting
    fontMetrics.ts     font widths for simple, CID and standard-14 fonts
    exportPdf.ts       applies all edits and writes the PDF with pdf-lib
    textRuns.ts        merges pdf.js text items into editable runs
    runFonts.ts, fonts.ts, color.ts, matrix.ts, samplePdf.ts
  state/          document model, reducer and undo/redo history
  editor/         React UI (pages, overlays, sidebar, properties panel)
tests/            Vitest tests (including a Chrome-printed PDF with CID fonts)
e2e/              Playwright browser test
```

## Known limitations

- New and replacement text uses the standard PDF fonts (Helvetica, Times, Courier), so the result is a close match rather than the original embedded font. Characters outside Windows-1252 (for example CJK or emoji) are replaced with `?`.
- Only horizontal text can be edited in place. Rotated and vertical text can still be erased with the eraser.
- Text and images inside form XObjects, and text in fonts with non-Identity CMaps, fall back to cover-and-replace.
- Vector graphics (paths) are not removed by the eraser; they are covered by the fill color.
- Edits are made per text run (roughly a line or phrase), not per paragraph, and text doesn't reflow.
- Password-protected PDFs can't be opened. PDFs with only an owner password open, but their saved output may not.
- Page thumbnails show added objects, but not the removal of original content until the PDF is downloaded and reopened.
