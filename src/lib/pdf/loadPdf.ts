// pdfjs entry point. Loads documents, renders pages to canvas, and pulls text
// content with geometry. The worker is bundled locally via import.meta.url so we
// don't depend on a CDN at runtime.
'use client';

import * as pdfjsLib from 'pdfjs-dist';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem,
  TextStyle,
} from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';

let workerConfigured = false;

function ensureWorker() {
  if (workerConfigured) return;
  // Resolve the worker as a bundled asset (Turbopack/Webpack understand this).
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  workerConfigured = true;
}

export type PageTextContent = {
  items: TextItem[];
  styles: Record<string, TextStyle>;
};

export async function loadDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  ensureWorker();
  // getDocument detaches the buffer it's given, so hand it a private copy and
  // keep the caller's ArrayBuffer intact (we reuse it for hashing the file).
  const bytes = new Uint8Array(data.slice(0));
  const task = pdfjsLib.getDocument({
    data: bytes,
    // Bundled (copied to /public/pdfjs) so base-14 fonts and CJK render offline.
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
  });
  return task.promise;
}

export async function getPageText(page: PDFPageProxy): Promise<PageTextContent> {
  const content = await page.getTextContent();
  // Filter to TextItems (TextMarkedContent items have no `str`).
  const items = content.items.filter(
    (it): it is TextItem => (it as TextItem).str !== undefined
  );
  return { items, styles: content.styles as Record<string, TextStyle> };
}

export type RenderedPage = {
  viewport: PageViewport;
  width: number; // CSS px
  height: number; // CSS px
  scale: number;
};

// Track the in-flight render per canvas so a new render (StrictMode double-invoke,
// fast page flips, resizes) cancels the previous one instead of colliding —
// pdf.js throws if two renders target the same canvas concurrently.
type RenderTask = { cancel: () => void; promise: Promise<void> };
const canvasTasks = new WeakMap<HTMLCanvasElement, RenderTask>();

// Renders `page` into `canvas` sized to `cssWidth`. Uses devicePixelRatio for a
// crisp backing store while keeping layout coordinates in CSS pixels.
export async function renderPageToCanvas(
  page: PDFPageProxy,
  cssWidth: number,
  canvas: HTMLCanvasElement
): Promise<RenderedPage> {
  const prev = canvasTasks.get(canvas);
  if (prev) {
    prev.cancel();
    try {
      await prev.promise;
    } catch {
      // expected RenderingCancelledException
    }
  }

  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const viewport = page.getViewport({ scale });
  const dpr =
    typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  // v5 canvas-mode: pass the canvas element only (no canvasContext) and let
  // pdf.js own the 2D context. Scale the backing store via `transform` for HiDPI.
  const task = page.render({
    canvas,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  });
  canvasTasks.set(canvas, task);
  try {
    await task.promise;
  } finally {
    if (canvasTasks.get(canvas) === task) canvasTasks.delete(canvas);
  }

  return {
    viewport,
    width: viewport.width,
    height: viewport.height,
    scale,
  };
}
