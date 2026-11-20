// Copies pdf.js runtime assets (CMaps, standard fonts, wasm decoders, ICC profiles)
// into public/pdfjs so they are served alongside the app.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const target = join(root, 'public', 'pdfjs');
mkdirSync(target, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = join(pdfjsRoot, dir);
  if (existsSync(src)) cpSync(src, join(target, dir), { recursive: true });
}
console.log('Copied pdf.js assets to', target);
