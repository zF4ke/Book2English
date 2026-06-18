// Copy pdf.js standard fonts and CMaps into public/ so the viewer can render
// base-14 fonts (Times/Helvetica) and CJK text without hitting a CDN.
// Regenerated from the installed package; output is gitignored.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/pdfjs-dist');
const dest = resolve(root, 'public/pdfjs');

if (!existsSync(src)) {
  console.warn('[copy-pdfjs-assets] pdfjs-dist not installed; skipping.');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps']) {
  const from = resolve(src, dir);
  if (existsSync(from)) {
    cpSync(from, resolve(dest, dir), { recursive: true });
    console.log(`[copy-pdfjs-assets] copied ${dir}`);
  }
}
