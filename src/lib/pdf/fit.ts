// Fit translated text into a fixed block box: greedy word-wrap + binary-search
// font size, measured with an offscreen canvas. Translated text is often longer
// than the source, so we shrink (never upscale) to keep the original footprint.
'use client';

let measureCtx: CanvasRenderingContext2D | null = null;

function ctx(): CanvasRenderingContext2D {
  if (measureCtx) return measureCtx;
  const c = document.createElement('canvas');
  measureCtx = c.getContext('2d')!;
  return measureCtx;
}

export type FitResult = {
  fontPx: number;
  lines: string[];
  lineHeightPx: number;
};

const SERIF_STACK = `Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif`;

function wrap(text: string, maxWidth: number, font: string): string[] {
  const c = ctx();
  c.font = font;
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = line + ' ' + words[i];
      if (c.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        out.push(line);
        line = words[i];
      }
    }
    out.push(line);
  }
  return out;
}

export function fitText(
  text: string,
  box: { width: number; height: number },
  maxFontPx: number,
  fontStack: string = SERIF_STACK,
  bold = false
): FitResult {
  const minFontPx = 5;
  const weight = bold ? '600 ' : '';
  let best: FitResult = {
    fontPx: minFontPx,
    lines: wrap(text, box.width, `${weight}${minFontPx}px ${fontStack}`),
    lineHeightPx: minFontPx * 1.25,
  };

  let lo = minFontPx;
  let hi = Math.max(minFontPx, maxFontPx);
  // binary search the largest size whose wrapped text fits the box height
  for (let iter = 0; iter < 12 && hi - lo > 0.3; iter++) {
    const mid = (lo + hi) / 2;
    const lh = mid * 1.25;
    const lines = wrap(text, box.width, `${weight}${mid}px ${fontStack}`);
    const totalH = lines.length * lh;
    if (totalH <= box.height) {
      best = { fontPx: mid, lines, lineHeightPx: lh };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

export { SERIF_STACK };
