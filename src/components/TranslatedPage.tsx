// Renders one PDF page to canvas (full fidelity) and overlays translated text
// blocks in place. Falls back to the bare page when there's nothing to translate.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { renderPageToCanvas } from '@/lib/pdf/loadPdf';
import { extractLayout } from '@/lib/pdf/extract';
import type { PageLayout } from '@/lib/pdf/segment';
import { sampleBackground, sampleInk } from '@/lib/pdf/colors';
import BlockOverlay from './BlockOverlay';

type Props = {
  pdfDoc: PDFDocumentProxy;
  pageNum: number;
  width: number;
  translations: Record<string, string> | undefined;
  showOriginal: boolean;
  fontScale: number;
  placeholderHeight?: number;
};

type RenderState = {
  layout: PageLayout;
  width: number;
  height: number;
  masks: Record<string, string>;
  inks: Record<string, string>;
};

export default function TranslatedPage({
  pdfDoc,
  pageNum,
  width,
  translations,
  showOriginal,
  fontScale,
  placeholderHeight,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<RenderState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      setState(null);
      setError(null);
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (!alive) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rendered = await renderPageToCanvas(page, width, canvas);
        if (!alive) return;
        const layout = await extractLayout(page, pageNum, rendered.scale);
        if (!alive) return;

        const masks: Record<string, string> = {};
        const inks: Record<string, string> = {};
        for (const block of layout.blocks) {
          const bg = sampleBackground(canvas, block.box);
          masks[block.id] = bg;
          inks[block.id] = sampleInk(canvas, block.box, bg);
        }
        if (!alive) return;
        setState({ layout, width: rendered.width, height: rendered.height, masks, inks });
      } catch (e) {
        if (alive) setError((e as Error)?.message || 'Failed to render page');
      }
    })();

    return () => {
      alive = false;
    };
  }, [pdfDoc, pageNum, width]);

  const showOverlay = state && !showOriginal && translations;

  return (
    <div
      className="relative mx-auto"
      style={{ width: state?.width ?? width, height: state?.height ?? placeholderHeight }}
    >
      <canvas ref={canvasRef} className="block rounded-[2px]" />

      {showOverlay &&
        state.layout.blocks.map((block) => {
          const text = translations?.[block.id];
          if (!text) return null; // leave original visible until translated
          return (
            <BlockOverlay
              key={block.id}
              block={block}
              text={text}
              maskColor={state.masks[block.id] || '#ffffff'}
              inkColor={state.inks[block.id] || '#1a1a1a'}
              fontScale={fontScale}
            />
          );
        })}

      {state && state.layout.blocks.length > 0 && !state.layout.hasText && !showOriginal && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-[#2f251a]/85 px-3 py-1 text-xs text-[#fdf4e6] shadow">
          This page looks scanned — nothing to translate in place.
        </div>
      )}

      {!state && !error && (
        <div className="absolute inset-0 animate-pulse rounded bg-[#e9ddca]/60" />
      )}
      {error && (
        <div className="absolute inset-x-0 top-6 mx-auto w-fit rounded-lg bg-red-900/85 px-4 py-2 text-sm text-white">
          {error}
        </div>
      )}
    </div>
  );
}
