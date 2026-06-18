// Sample the rendered page canvas to decide a mask (background) color for each
// text block and an ink (text) color, so overlaid translations blend in.
'use client';

import type { Box } from './segment';

type RGB = { r: number; g: number; b: number };

function toCss({ r, g, b }: RGB): string {
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

function luminance({ r, g, b }: RGB): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Backing-store pixels per CSS px (devicePixelRatio baked into canvas.width).
function dprOf(canvas: HTMLCanvasElement): number {
  const cssW = parseFloat(canvas.style.width || '0') || canvas.width;
  return cssW ? canvas.width / cssW : 1;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Median color of a ring of samples just outside the block + page corners.
export function sampleBackground(canvas: HTMLCanvasElement, box: Box): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#ffffff';
  const dpr = dprOf(canvas);
  const W = canvas.width;
  const H = canvas.height;

  const pts: Array<[number, number]> = [];
  const pad = 4 * dpr;
  const x0 = box.left * dpr;
  const y0 = box.top * dpr;
  const x1 = (box.left + box.width) * dpr;
  const y1 = (box.top + box.height) * dpr;
  for (let t = 0; t <= 1; t += 0.25) {
    pts.push([x0 + (x1 - x0) * t, y0 - pad]); // above
    pts.push([x0 + (x1 - x0) * t, y1 + pad]); // below
    pts.push([x0 - pad, y0 + (y1 - y0) * t]); // left
    pts.push([x1 + pad, y0 + (y1 - y0) * t]); // right
  }
  // page corners as a stable fallback signal
  pts.push([2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]);

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (const [px, py] of pts) {
    const x = Math.min(W - 1, Math.max(0, Math.round(px)));
    const y = Math.min(H - 1, Math.max(0, Math.round(py)));
    try {
      const d = ctx.getImageData(x, y, 1, 1).data;
      rs.push(d[0]);
      gs.push(d[1]);
      bs.push(d[2]);
    } catch {
      return '#ffffff';
    }
  }
  return toCss({ r: median(rs), g: median(gs), b: median(bs) });
}

// Average of the darkest pixels inside the block => approximate ink color.
export function sampleInk(canvas: HTMLCanvasElement, box: Box, bg: string): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#1a1a1a';
  const dpr = dprOf(canvas);
  const x = Math.max(0, Math.round(box.left * dpr));
  const y = Math.max(0, Math.round(box.top * dpr));
  const w = Math.min(canvas.width - x, Math.round(box.width * dpr));
  const h = Math.min(canvas.height - y, Math.round(box.height * dpr));
  if (w <= 0 || h <= 0) return '#1a1a1a';

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return '#1a1a1a';
  }

  const bgLum = luminance(parseRgb(bg));
  const dark: RGB[] = [];
  // Sample on a stride so big blocks stay cheap.
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
  for (let py = 0; py < h; py += stride) {
    for (let px = 0; px < w; px += stride) {
      const i = (py * w + px) * 4;
      const rgb = { r: data[i], g: data[i + 1], b: data[i + 2] };
      // ink = noticeably darker than background
      if (bgLum - luminance(rgb) > 50) dark.push(rgb);
    }
  }
  if (dark.length < 4) return '#1a1a1a';
  dark.sort((a, b) => luminance(a) - luminance(b));
  const take = dark.slice(0, Math.max(4, Math.floor(dark.length * 0.3)));
  const r = take.reduce((s, c) => s + c.r, 0) / take.length;
  const g = take.reduce((s, c) => s + c.g, 0) / take.length;
  const b = take.reduce((s, c) => s + c.b, 0) / take.length;
  return toCss({ r, g, b });
}

function parseRgb(css: string): RGB {
  const m = css.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 255, g: 255, b: 255 };
}
