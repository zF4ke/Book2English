// Build a PageLayout from a pdfjs page at a given scale. Segmentation is
// scale-invariant in structure, so block ids match across scales (cheap
// scale-1 extraction for prefetch lines up with display-scale rendering).
'use client';

import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { getPageText } from './loadPdf';
import { buildPageLayout, type PageLayout, type RawItem } from './segment';

export async function extractLayout(
  page: PDFPageProxy,
  pageNum: number,
  scale: number
): Promise<PageLayout> {
  const viewport = page.getViewport({ scale });
  const { items } = await getPageText(page);
  const raw: RawItem[] = items.map((it) => ({
    str: it.str,
    transform: it.transform,
    width: it.width,
    height: it.height,
    fontName: it.fontName,
    dir: it.dir,
    hasEOL: it.hasEOL,
  }));
  return buildPageLayout(
    pageNum,
    raw,
    viewport.transform as number[],
    scale,
    viewport.width,
    viewport.height
  );
}
