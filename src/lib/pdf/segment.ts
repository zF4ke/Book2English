// Pure, DOM-free segmentation: turn raw pdfjs text items into positioned
// lines, then paragraph/heading blocks, detecting 1-2 column layouts.
// Kept free of pdfjs/DOM imports so it can be unit-tested with plain arrays.

export type RawItem = {
  str: string;
  transform: number[]; // [a,b,c,d,e,f] glyph->user space
  width: number; // user-space width @ scale 1
  height: number;
  fontName: string;
  dir?: string; // 'ltr' | 'rtl' | 'ttb'
  hasEOL?: boolean;
};

export type Box = { left: number; top: number; width: number; height: number };

export type MappedItem = {
  str: string;
  x: number; // left, CSS px
  baselineY: number; // CSS px (top-left origin)
  width: number; // CSS px
  fontPx: number;
  fontName: string;
  dir: string;
  hasEOL: boolean;
  rotated: boolean;
};

export type LineLayout = {
  items: MappedItem[];
  text: string;
  baselineY: number;
  top: number;
  bottom: number;
  xStart: number;
  xEnd: number;
  fontPx: number;
};

export type BlockLayout = {
  id: string;
  kind: 'heading' | 'body';
  column: number;
  align: 'left' | 'center' | 'justify';
  box: Box;
  fontPx: number;
  lineHeightPx: number;
  sourceText: string;
  dir: string;
};

export type PageLayout = {
  page: number;
  width: number;
  height: number;
  blocks: BlockLayout[];
  hasText: boolean;
};

// Compose two affine matrices the same way pdfjs Util.transform does.
function compose(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Map raw items into viewport (CSS px) space at the given scale.
export function mapItems(
  items: RawItem[],
  viewportTransform: number[],
  scale: number
): MappedItem[] {
  const out: MappedItem[] = [];
  for (const it of items) {
    if (!it.str || !it.str.length) continue;
    const m = compose(viewportTransform, it.transform);
    const fontPx = Math.hypot(m[2], m[3]);
    if (fontPx < 0.5) continue;
    const angle = Math.atan2(m[1], m[0]);
    const rotated = Math.abs(angle) > 0.06; // ~3.5deg
    out.push({
      str: it.str,
      x: m[4],
      baselineY: m[5],
      width: it.width * scale,
      fontPx,
      fontName: it.fontName,
      dir: it.dir || 'ltr',
      hasEOL: !!it.hasEOL,
      rotated,
    });
  }
  return out;
}

// Cluster items sharing a baseline into lines.
export function clusterLines(items: MappedItem[]): LineLayout[] {
  const usable = items.filter((i) => !i.rotated && i.dir === 'ltr');
  if (!usable.length) return [];
  const medFont = median(usable.map((i) => i.fontPx)) || 12;
  const yTol = Math.max(2, medFont * 0.5);

  const sorted = [...usable].sort((a, b) => a.baselineY - b.baselineY || a.x - b.x);
  const lines: MappedItem[][] = [];
  let current: MappedItem[] = [];
  let currentY = NaN;

  for (const it of sorted) {
    if (current.length === 0) {
      current = [it];
      currentY = it.baselineY;
    } else if (Math.abs(it.baselineY - currentY) <= yTol) {
      current.push(it);
      // rolling baseline keeps drift in check on slightly skewed lines
      currentY = (currentY * (current.length - 1) + it.baselineY) / current.length;
    } else {
      lines.push(current);
      current = [it];
      currentY = it.baselineY;
    }
  }
  if (current.length) lines.push(current);

  return lines.map(buildLine).sort((a, b) => a.top - b.top);
}

function buildLine(raw: MappedItem[]): LineLayout {
  const items = [...raw].sort((a, b) => a.x - b.x);
  const fontPx = median(items.map((i) => i.fontPx)) || 12;
  let text = '';
  let prev: MappedItem | null = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.width);
      const needsSpace = gap > prev.fontPx * 0.2 && !text.endsWith(' ') && !it.str.startsWith(' ');
      if (needsSpace) text += ' ';
    }
    text += it.str;
    prev = it;
  }
  text = text.replace(/\s+/g, ' ').trim();

  const baselineY = median(items.map((i) => i.baselineY));
  const xStart = Math.min(...items.map((i) => i.x));
  const xEnd = Math.max(...items.map((i) => i.x + i.width));
  const top = baselineY - fontPx * 0.82;
  const bottom = baselineY + fontPx * 0.22;
  return { items, text, baselineY, top, bottom, xStart, xEnd, fontPx };
}

// Detect a single vertical whitespace "river" splitting the page into 2 columns.
// Returns column index per line. Falls back to all-zero (1 column).
export function detectColumns(lines: LineLayout[], pageWidth: number): number[] {
  const n = lines.length;
  const result = new Array(n).fill(0);
  if (n < 6) return result;

  let best = { x: 0, crossings: Infinity, left: 0, right: 0 };
  for (let frac = 0.35; frac <= 0.65; frac += 0.02) {
    const x = pageWidth * frac;
    let crossings = 0;
    let left = 0;
    let right = 0;
    for (const ln of lines) {
      if (ln.xStart < x && ln.xEnd > x) crossings++;
      else if (ln.xEnd <= x) left++;
      else right++;
    }
    if (crossings < best.crossings) best = { x, crossings, left, right };
  }

  const minSide = Math.max(2, Math.floor(n * 0.2));
  const isTwoCol =
    best.crossings <= Math.max(1, Math.floor(n * 0.05)) &&
    best.left >= minSide &&
    best.right >= minSide;
  if (!isTwoCol) return result;

  lines.forEach((ln, i) => {
    result[i] = ln.xStart >= best.x ? 1 : 0;
  });
  return result;
}

function detectAlign(
  lines: LineLayout[],
  colLeft: number,
  colRight: number
): 'left' | 'center' | 'justify' {
  if (lines.length === 0) return 'left';
  const colCenter = (colLeft + colRight) / 2;
  const colWidth = Math.max(1, colRight - colLeft);

  if (lines.length === 1) {
    const ln = lines[0];
    const lineCenter = (ln.xStart + ln.xEnd) / 2;
    const leftGap = ln.xStart - colLeft;
    if (Math.abs(lineCenter - colCenter) < colWidth * 0.08 && leftGap > colWidth * 0.12)
      return 'center';
    return 'left';
  }

  // Lines that aren't the last and reach close to the right edge => justified.
  const interior = lines.slice(0, -1);
  const reaching = interior.filter((ln) => colRight - ln.xEnd < colWidth * 0.04).length;
  if (interior.length && reaching / interior.length >= 0.6) return 'justify';

  // Balanced left/right gaps on every line => centered.
  const centered = lines.every((ln) => {
    const lineCenter = (ln.xStart + ln.xEnd) / 2;
    return Math.abs(lineCenter - colCenter) < colWidth * 0.1;
  });
  if (centered) return 'center';

  return 'left';
}

// Group adjacent lines (within a column) into paragraph/heading blocks.
export function groupBlocks(lines: LineLayout[], pageNum: number): BlockLayout[] {
  if (!lines.length) return [];
  const columns = detectColumns(lines, Math.max(...lines.map((l) => l.xEnd)));

  // Body font reference: length-weighted median of line font sizes.
  const fontSamples: number[] = [];
  for (const ln of lines) {
    const weight = Math.max(1, Math.round(ln.text.length / 4));
    for (let i = 0; i < weight; i++) fontSamples.push(ln.fontPx);
  }
  const bodyFont = median(fontSamples) || 12;

  const blocks: BlockLayout[] = [];
  const colCount = Math.max(...columns) + 1;

  for (let col = 0; col < colCount; col++) {
    const colLines = lines.filter((_, i) => columns[i] === col).sort((a, b) => a.top - b.top);
    if (!colLines.length) continue;
    const colLeft = Math.min(...colLines.map((l) => l.xStart));
    const colRight = Math.max(...colLines.map((l) => l.xEnd));

    let group: LineLayout[] = [];
    const flush = () => {
      if (!group.length) return;
      blocks.push(makeBlock(group, col, colLeft, colRight, bodyFont, pageNum, blocks.length));
      group = [];
    };

    for (const ln of colLines) {
      if (!group.length) {
        group = [ln];
        continue;
      }
      const prev = group[group.length - 1];
      const gap = ln.top - prev.bottom;
      const lineGapOk = gap <= ln.fontPx * 0.9 && gap > -ln.fontPx * 0.5;
      const fontOk = Math.max(ln.fontPx, prev.fontPx) / Math.min(ln.fontPx, prev.fontPx) <= 1.4;
      // A first-line indent (line starts noticeably right of the column margin)
      // marks a NEW paragraph — critical for justified prose where paragraphs are
      // separated by indentation rather than vertical space. (We deliberately do
      // NOT treat a short previous line as a break: ragged-right body lines end
      // short all the time, and the next paragraph's indent already splits it.)
      const newParagraph = ln.xStart - colLeft > Math.max(6, ln.fontPx * 0.7);
      if (lineGapOk && fontOk && !newParagraph) {
        group.push(ln);
      } else {
        flush();
        group = [ln];
      }
    }
    flush();
  }

  return blocks.sort((a, b) => a.column - b.column || a.box.top - b.box.top);
}

function makeBlock(
  lines: LineLayout[],
  col: number,
  colLeft: number,
  colRight: number,
  bodyFont: number,
  pageNum: number,
  index: number
): BlockLayout {
  const left = Math.min(...lines.map((l) => l.xStart));
  const top = Math.min(...lines.map((l) => l.top));
  const right = Math.max(...lines.map((l) => l.xEnd));
  const bottom = Math.max(...lines.map((l) => l.bottom));
  const fontPx = median(lines.map((l) => l.fontPx)) || bodyFont;

  // Line height from consecutive baseline deltas.
  let lineHeightPx = fontPx * 1.3;
  if (lines.length > 1) {
    const deltas: number[] = [];
    for (let i = 1; i < lines.length; i++) deltas.push(lines[i].baselineY - lines[i - 1].baselineY);
    const med = median(deltas);
    if (med > 0) lineHeightPx = med;
  }

  const kind: 'heading' | 'body' = fontPx >= bodyFont * 1.25 ? 'heading' : 'body';
  const align = detectAlign(lines, colLeft, colRight);
  const sourceText = lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
  const dir = lines[0]?.items[0]?.dir || 'ltr';

  return {
    id: `${pageNum}:${index}`,
    kind,
    column: col,
    align,
    box: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
    fontPx,
    lineHeightPx,
    sourceText,
    dir,
  };
}

// Full pipeline: mapped items -> PageLayout.
export function buildPageLayout(
  page: number,
  items: RawItem[],
  viewportTransform: number[],
  scale: number,
  width: number,
  height: number
): PageLayout {
  const mapped = mapItems(items, viewportTransform, scale);
  const lines = clusterLines(mapped);
  const blocks = groupBlocks(lines, page);
  const totalChars = blocks.reduce((s, b) => s + b.sourceText.length, 0);
  return { page, width, height, blocks, hasText: totalChars > 8 };
}
