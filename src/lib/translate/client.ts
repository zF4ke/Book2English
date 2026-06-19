// Per-page translation orchestration: cache lookup, in-batch dedupe of
// identical strings (repeated headers/footers), chunked requests, and DB persist.
'use client';

import { getCachedPage, putCachedPage } from '@/lib/cache/translationDB';

export type Lang = 'en' | 'pt';

export type TranslateOpts = {
  fileHash: string;
  model: string;
  lang: Lang;
  apiKey: string;
  signal?: AbortSignal;
};

type SrcBlock = { id: string; text: string };

// Smaller batches keep each model response short enough to stay valid JSON
// (long responses risk truncation -> unparseable output).
const MAX_BLOCKS_PER_REQUEST = 20;
const MAX_CHARS_PER_REQUEST = 3500;
// Oversized paragraphs (e.g. a page-long academic block) are split into pieces
// this big so no single response is long enough to get truncated.
const MAX_UNIT_CHARS = 1200;
const MAX_ATTEMPTS = 3;

// 401 (key), 402 (credits), 400 (bad request) are not worth retrying.
const NON_RETRYABLE = new Set([400, 401, 402]);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TranslateError extends Error {
  constructor(message: string, readonly actionable: boolean) {
    super(message);
    this.name = 'TranslateError';
  }
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Split a long paragraph into sentence-bounded pieces no larger than
// MAX_UNIT_CHARS, so each translation response stays short and complete.
function splitText(text: string): string[] {
  const t = text.trim();
  if (t.length <= MAX_UNIT_CHARS) return [t];
  const sentences = t.split(/(?<=[.!?…])\s+/);
  const pieces: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > MAX_UNIT_CHARS) {
      pieces.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
    // A single sentence longer than the cap: hard-split as a last resort.
    while (cur.length > MAX_UNIT_CHARS * 1.6) {
      pieces.push(cur.slice(0, MAX_UNIT_CHARS));
      cur = cur.slice(MAX_UNIT_CHARS);
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

async function requestOnce(
  blocks: SrcBlock[],
  opts: TranslateOpts
): Promise<{ map: Record<string, string>; status: number }> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks,
      language: opts.lang,
      apiKey: opts.apiKey,
      model: opts.model,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    let msg = `Translation failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error) msg = err.error;
    } catch {
      // keep default
    }
    throw new TranslateError(msg, NON_RETRYABLE.has(res.status));
  }
  const data = (await res.json()) as { translations?: Array<{ id: string; text: string }> };
  const map: Record<string, string> = {};
  for (const t of data.translations ?? []) {
    if (t && typeof t.id === 'string' && typeof t.text === 'string') map[t.id] = t.text;
  }
  return { map, status: res.status };
}

// Retries transient failures (parse errors, 5xx, network) a few times so they
// self-heal without surfacing to the UI. Auth/credit errors fail fast.
async function requestChunk(
  blocks: SrcBlock[],
  opts: TranslateOpts
): Promise<Record<string, string>> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { map } = await requestOnce(blocks, opts);
      if (Object.keys(map).length === 0 && blocks.length > 0) {
        throw new TranslateError('Empty translation', false);
      }
      return map;
    } catch (e) {
      last = e;
      if (opts.signal?.aborted) throw e;
      if (e instanceof TranslateError && e.actionable) throw e; // bad key/credits
      if (attempt < MAX_ATTEMPTS) await delay(500 * attempt);
    }
  }
  throw last instanceof Error ? last : new Error('Translation failed');
}

// Translate every block on a page. Returns blockId -> translated text for all
// blocks that have text (cached + freshly translated). Persists new results.
export async function translatePage(
  page: number,
  blocks: SrcBlock[],
  opts: TranslateOpts
): Promise<Record<string, string>> {
  const cached = await getCachedPage(opts.fileHash, opts.model, opts.lang, page);
  const result: Record<string, string> = { ...cached };

  const missing = blocks.filter((b) => b.text.trim() && !(b.id in result));
  if (!missing.length) return result;

  // Expand each block into translation units (splitting oversized paragraphs).
  const unitsByOrig = new Map<string, { idx: number; unitId: string }[]>();
  const units: SrcBlock[] = [];
  for (const b of missing) {
    const pieces = splitText(b.text);
    const list: { idx: number; unitId: string }[] = [];
    pieces.forEach((piece, i) => {
      const unitId = `${b.id}#${i}`;
      units.push({ id: unitId, text: piece });
      list.push({ idx: i, unitId });
    });
    unitsByOrig.set(b.id, list);
  }

  // Dedupe identical unit texts: translate once, fan out to all unit ids.
  const idsByText = new Map<string, string[]>();
  const repUnits: SrcBlock[] = [];
  for (const u of units) {
    const key = norm(u.text);
    if (!idsByText.has(key)) {
      idsByText.set(key, []);
      repUnits.push(u);
    }
    idsByText.get(key)!.push(u.id);
  }

  // Chunk by count and character budget.
  const chunks: SrcBlock[][] = [];
  let chunk: SrcBlock[] = [];
  let chunkChars = 0;
  for (const u of repUnits) {
    if (
      chunk.length >= MAX_BLOCKS_PER_REQUEST ||
      (chunk.length && chunkChars + u.text.length > MAX_CHARS_PER_REQUEST)
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkChars = 0;
    }
    chunk.push(u);
    chunkChars += u.text.length;
  }
  if (chunk.length) chunks.push(chunk);

  const unitMap: Record<string, string> = {};
  for (const c of chunks) {
    const map = await requestChunk(c, opts);
    for (const rep of c) {
      const translated = map[rep.id];
      if (translated === undefined) continue;
      for (const uid of idsByText.get(norm(rep.text)) ?? [rep.id]) unitMap[uid] = translated;
    }
    // Reassemble any blocks whose units are now all translated; cache them.
    const fresh: Record<string, string> = {};
    for (const [origId, list] of unitsByOrig) {
      if (origId in result) continue;
      if (list.every((u) => unitMap[u.unitId] !== undefined)) {
        const joined = [...list]
          .sort((a, b) => a.idx - b.idx)
          .map((u) => unitMap[u.unitId])
          .join(' ');
        result[origId] = joined;
        fresh[origId] = joined;
      }
    }
    if (Object.keys(fresh).length) {
      await putCachedPage(opts.fileHash, opts.model, opts.lang, page, fresh);
    }
  }

  return result;
}

// Minimal promise concurrency limiter for page-level prefetch.
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    queue.shift()!();
  };
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
