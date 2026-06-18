// One translated text block, masked over the original and shrink-to-fit so it
// keeps the source footprint.
'use client';

import { useMemo } from 'react';
import type { BlockLayout } from '@/lib/pdf/segment';
import { fitText, SERIF_STACK } from '@/lib/pdf/fit';

type Props = {
  block: BlockLayout;
  text: string;
  maskColor: string;
  inkColor: string;
  fontScale: number;
};

export default function BlockOverlay({ block, text, maskColor, inkColor, fontScale }: Props) {
  const { box, align, kind } = block;
  const bold = kind === 'heading';

  const fit = useMemo(() => {
    const maxFont = block.fontPx * fontScale * 1.05;
    return fitText(text, { width: box.width, height: box.height }, maxFont, SERIF_STACK, bold);
  }, [text, box.width, box.height, block.fontPx, fontScale, bold]);

  // Expand the mask slightly so original ascenders/descenders are fully covered.
  const padX = 1.5;
  const padY = Math.max(1.5, block.fontPx * 0.12);

  return (
    <div
      style={{
        position: 'absolute',
        left: box.left - padX,
        top: box.top - padY,
        width: box.width + padX * 2,
        height: box.height + padY * 2,
        background: maskColor,
        boxShadow: `0 0 2px 1px ${maskColor}`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-start',
        boxSizing: 'border-box',
        padding: `${padY}px ${padX}px`,
      }}
    >
      <div
        style={{
          width: '100%',
          color: inkColor,
          fontFamily: SERIF_STACK,
          fontSize: `${fit.fontPx}px`,
          lineHeight: `${fit.lineHeightPx}px`,
          fontWeight: bold ? 600 : 400,
          textAlign: align,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
        }}
      >
        {text}
      </div>
    </div>
  );
}
