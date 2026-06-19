// The reader shell: upload, continuous-scroll in-place translated pages with
// virtualization (only pages near the viewport stay mounted), zoom/fit, prefetch,
// and settings. Owns all state and translation orchestration.
'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { loadDocument } from '@/lib/pdf/loadPdf';
import { extractLayout } from '@/lib/pdf/extract';
import { translatePage, createLimiter, TranslateError, type Lang } from '@/lib/translate/client';
import { clearBook } from '@/lib/cache/translationDB';
import { DEFAULT_MODEL, FALLBACK_GROUPS, loadModels, type ModelGroups } from '@/lib/models';
import TranslatedPage from './TranslatedPage';
import SettingsSheet from './SettingsSheet';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
const PAGE_GAP = 20; // px between pages
const MOUNT_MARGIN = '150% 0px'; // pages within ~1.5 viewports stay mounted

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi);
}

async function hashFile(buf: ArrayBuffer): Promise<string> {
  const head = buf.slice(0, 200_000);
  const digest = await crypto.subtle.digest('SHA-256', head);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export default function PdfReader() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileHash, setFileHash] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [pageAspect, setPageAspect] = useState(1.414); // height / width
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Settings (persisted).
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [lang, setLang] = useState<Lang>('en');
  const [fontScale, setFontScale] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);
  const [prefetchAhead, setPrefetchAhead] = useState(4);
  const [zoom, setZoom] = useState(1);
  const [models, setModels] = useState<ModelGroups>(FALLBACK_GROUPS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Translation + view state.
  const [translations, setTranslations] = useState<Record<number, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [transError, setTransError] = useState('');
  const [containerWidth, setContainerWidth] = useState(900);
  const [visible, setVisible] = useState<Set<number>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const slotEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const inflight = useRef<Set<string>>(new Set());
  const limiter = useRef(createLimiter(2));
  // Shared across in-flight translation requests so we can cancel them all.
  const abortRef = useRef<AbortController>(new AbortController());
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollThrottle = useRef(0);
  // Remembers the content point under the viewport center across a zoom change.
  const pendingAnchor = useRef<{ page: number; f: number } | null>(null);

  const pageWidth = useMemo(
    () => clamp(Math.round((containerWidth - 32) * zoom), 240, 6000),
    [containerWidth, zoom]
  );
  const reservedHeight = Math.round(pageWidth * pageAspect);
  const visibleKey = useMemo(() => [...visible].sort((a, b) => a - b).join(','), [visible]);

  // Load persisted settings once.
  useEffect(() => {
    const k = localStorage.getItem('or_apiKey');
    if (k) setApiKey(k);
    const m = localStorage.getItem('or_model');
    if (m) setModel(m);
    const l = localStorage.getItem('lang');
    if (l === 'en' || l === 'pt') setLang(l);
    const fs = Number(localStorage.getItem('fontScale'));
    if (fs >= 0.8 && fs <= 1.6) setFontScale(fs);
    const pa = Number(localStorage.getItem('prefetchAhead'));
    if (pa >= 1 && pa <= 20) setPrefetchAhead(pa);
    const z = Number(localStorage.getItem('zoom'));
    if (z >= MIN_ZOOM && z <= MAX_ZOOM) setZoom(z);
    if (localStorage.getItem('showOriginal') === 'true') setShowOriginal(true);
  }, []);

  // Ask the browser to never evict our settings (localStorage) or translation
  // cache (IndexedDB) under storage pressure — keep them around indefinitely.
  useEffect(() => {
    navigator.storage?.persisted?.().then((granted) => {
      if (!granted) navigator.storage?.persist?.();
    });
  }, []);

  // Fetch the live model catalogue + pricing once.
  useEffect(() => {
    loadModels().then(setModels);
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem('or_apiKey', apiKey);
    else localStorage.removeItem('or_apiKey');
  }, [apiKey]);
  useEffect(() => void localStorage.setItem('or_model', model), [model]);
  useEffect(() => void localStorage.setItem('lang', lang), [lang]);
  useEffect(() => void localStorage.setItem('fontScale', String(fontScale)), [fontScale]);
  useEffect(() => void localStorage.setItem('prefetchAhead', String(prefetchAhead)), [prefetchAhead]);
  useEffect(() => void localStorage.setItem('zoom', String(zoom)), [zoom]);
  useEffect(() => void localStorage.setItem('showOriginal', String(showOriginal)), [showOriginal]);

  // Responsive container width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pdfDoc]);

  // New translation context invalidates the in-memory map (DB still holds it).
  useEffect(() => {
    setTranslations({});
    inflight.current.clear();
    setTransError('');
  }, [lang, model, fileHash]);

  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  const onFile = useCallback(async (file: File) => {
    setLoadingDoc(true);
    setLoadError('');
    try {
      const buf = await file.arrayBuffer();
      const [doc, hash] = await Promise.all([loadDocument(buf), hashFile(buf)]);
      const p1 = await doc.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      setPageAspect(vp.height / vp.width);
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setFileName(file.name);
      setFileHash(hash);
      setCurrentPage(1);
      setVisible(new Set([1]));
      setTranslations({});
      inflight.current.clear();
    } catch (e) {
      setLoadError((e as Error)?.message || 'Could not open this PDF.');
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  // Ensure a page is translated (cache-aware). Cheap scale-1 layout for blocks.
  const ensurePage = useCallback(
    async (p: number) => {
      if (!pdfDoc || !fileHash || !apiKey) return;
      if (p < 1 || p > numPages) return;
      const key = `${p}:${lang}:${model}`;
      if (inflight.current.has(key)) return;
      if (translations[p] && Object.keys(translations[p]).length) return;
      inflight.current.add(key);
      try {
        const pageObj = await pdfDoc.getPage(p);
        const layout = await extractLayout(pageObj, p, 1);
        const blocks = layout.blocks
          .filter((b) => b.sourceText.trim())
          .map((b) => ({ id: b.id, text: b.sourceText }));
        if (!blocks.length) {
          setTranslations((prev) => ({ ...prev, [p]: {} }));
          return;
        }
        setBusy(true);
        const signal = abortRef.current.signal;
        const map = await limiter.current(() =>
          translatePage(p, blocks, { fileHash, model, lang, apiKey, signal })
        );
        setTranslations((prev) => ({ ...prev, [p]: map }));
        setTransError('');
      } catch (e) {
        // Only surface actionable errors (bad key, no credits). Transient ones
        // (parse/5xx/network) already retried internally and will retry again
        // when the page is re-visited — no need to spam the banner.
        if (e instanceof TranslateError && e.actionable) {
          setTransError(e.message);
        }
      } finally {
        inflight.current.delete(key);
        if (inflight.current.size === 0) setBusy(false);
      }
    },
    [pdfDoc, fileHash, apiKey, numPages, lang, model, translations]
  );

  // Translate visible pages + prefetch ahead whenever the viewport or context changes.
  useEffect(() => {
    if (!pdfDoc) return;
    const vis = [...visible].sort((a, b) => a - b);
    for (const p of vis) ensurePage(p);
    const maxV = vis.length ? vis[vis.length - 1] : currentPage;
    for (let i = 1; i <= prefetchAhead; i++) ensurePage(maxV + i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, visibleKey, prefetchAhead, lang, model, apiKey, fileHash, ensurePage]);

  // Virtualization: mount only pages near the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !numPages) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(p);
            else next.delete(p);
          }
          return next;
        });
      },
      { root, rootMargin: MOUNT_MARGIN, threshold: 0 }
    );
    const slots = root.querySelectorAll('[data-page]');
    slots.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [numPages]);

  // Track the page currently under the viewport for the toolbar/jump field.
  const onScroll = useCallback(() => {
    const now = performance.now();
    if (now - scrollThrottle.current < 100) return;
    scrollThrottle.current = now;
    const root = scrollRef.current;
    if (!root) return;
    const probe = root.getBoundingClientRect().top + root.clientHeight * 0.35;
    for (const [p, el] of slotEls.current) {
      const r = el.getBoundingClientRect();
      if (r.top <= probe && probe < r.bottom) {
        setCurrentPage(p);
        break;
      }
    }
  }, []);

  const go = useCallback(
    (target: number) => {
      if (!numPages) return;
      const p = clamp(target, 1, numPages);
      setCurrentPage(p);
      setPageInput(String(p));
      slotEls.current.get(p)?.scrollIntoView({ block: 'start' });
    },
    [numPages]
  );

  // Abort every in-flight translation and restart from what's on screen.
  // Cached pages still serve instantly; only un-done pages re-request.
  const cancelAndRestart = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
    inflight.current.clear();
    setBusy(false);
    setTransError('');
    // Clearing the in-memory map re-runs the translate effect for the visible
    // pages + prefetch ahead (the "from this page" restart).
    setTranslations({});
  }, []);

  // Record the content point at the viewport's vertical center so we can keep it
  // anchored after the layout reflows at the new zoom.
  const captureAnchor = useCallback(() => {
    const root = scrollRef.current;
    if (!root) {
      pendingAnchor.current = null;
      return;
    }
    const centerY = root.getBoundingClientRect().top + root.clientHeight / 2;
    for (const [p, el] of slotEls.current) {
      const r = el.getBoundingClientRect();
      if (r.top <= centerY && centerY < r.bottom) {
        pendingAnchor.current = { page: p, f: (centerY - r.top) / Math.max(1, r.height) };
        return;
      }
    }
    pendingAnchor.current = null;
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      captureAnchor();
      setZoom((z) => clamp(Math.round(z * factor * 100) / 100, MIN_ZOOM, MAX_ZOOM));
    },
    [captureAnchor]
  );

  const fitWidth = useCallback(() => {
    captureAnchor();
    setZoom(1);
  }, [captureAnchor]);
  const fitPage = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const availH = root.clientHeight - 48;
    const baseW = root.clientWidth - 32;
    if (baseW <= 0) return;
    captureAnchor();
    setZoom(clamp(availH / pageAspect / baseW, MIN_ZOOM, MAX_ZOOM));
  }, [pageAspect, captureAnchor]);

  // After a zoom reflow, restore the anchored point to the viewport center and
  // re-center horizontally.
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    if (!a) return;
    pendingAnchor.current = null;
    const root = scrollRef.current;
    const el = slotEls.current.get(a.page);
    if (!root || !el) return;
    const rel = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
    const target = root.scrollTop + rel + a.f * el.getBoundingClientRect().height - root.clientHeight / 2;
    root.scrollTop = Math.max(0, target);
    root.scrollLeft = Math.max(0, (root.scrollWidth - root.clientWidth) / 2);
  }, [pageWidth]);

  const onClearCache = useCallback(async () => {
    if (fileHash) await clearBook(fileHash);
    setTranslations({});
    inflight.current.clear();
    setSettingsOpen(false);
  }, [fileHash]);

  const settingsSheet = (
    <SettingsSheet
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      apiKey={apiKey}
      setApiKey={setApiKey}
      model={model}
      setModel={setModel}
      models={models}
      fontScale={fontScale}
      setFontScale={setFontScale}
      showOriginal={showOriginal}
      setShowOriginal={setShowOriginal}
      prefetchAhead={prefetchAhead}
      setPrefetchAhead={setPrefetchAhead}
      onClearCache={onClearCache}
    />
  );

  // ---- Upload screen ----
  if (!pdfDoc) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6">
        <div className="mb-10 text-center">
          <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#9b8773]">Reader&apos;s desk</p>
          <h1 className="font-serif text-5xl font-semibold leading-tight text-[#2f251a]">Book to English</h1>
          <p className="mt-4 max-w-md text-[#6e5d4f]">
            Drop in a PDF and read it as if it were always in your language — same pages, same
            layout, magically translated.
          </p>
        </div>

        <label className="group w-full cursor-pointer rounded-3xl border-2 border-dashed border-[#d8c8b0] bg-white/60 p-12 text-center shadow-sm transition-all hover:border-[#b88a5e] hover:bg-white">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#a4573f]/12 text-3xl text-[#a4573f]">
            ↑
          </div>
          <p className="text-lg font-medium text-[#2f251a]">
            {loadingDoc ? 'Opening…' : 'Drop your PDF here or click to browse'}
          </p>
          <p className="mt-1 text-sm text-[#8a7a6b]">Stays in your browser. Nothing is uploaded.</p>
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>

        {loadError && <p className="mt-4 text-sm text-red-700">{loadError}</p>}

        <button
          onClick={() => setSettingsOpen(true)}
          className="mt-8 text-sm text-[#8a7a6b] underline hover:text-[#a4573f]"
        >
          {apiKey ? 'API key set · Settings' : 'Add your OpenRouter key to begin'}
        </button>

        {settingsSheet}
      </div>
    );
  }

  // ---- Reading screen ----
  return (
    <div className="flex h-screen flex-col">
      {/* Toolbar */}
      <header className="z-30 shrink-0 border-b border-[#e6d8c4] bg-[#fbf5ec]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => {
              setPdfDoc(null);
              setFileHash('');
              setNumPages(0);
              setVisible(new Set());
              slotEls.current.clear();
            }}
            className="flex items-center gap-2 text-sm font-medium text-[#6e5d4f] hover:text-[#a4573f]"
            title="Open another book"
          >
            <span className="text-lg">✦</span>
            <span className="hidden max-w-[160px] truncate sm:inline">{fileName}</span>
          </button>

          <div className="mx-auto flex items-center gap-1.5">
            <button
              onClick={() => go(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded-full px-2.5 py-1.5 text-sm text-[#4a3c30] hover:bg-[#efe4d3] disabled:opacity-40"
            >
              ‹
            </button>
            <input
              value={pageInput}
              onChange={(e) => {
                setPageInput(e.target.value);
                if (jumpTimer.current) clearTimeout(jumpTimer.current);
                jumpTimer.current = setTimeout(() => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) go(n);
                }, 400);
              }}
              onBlur={() => {
                const n = Number(pageInput);
                if (Number.isFinite(n)) go(n);
                else setPageInput(String(currentPage));
              }}
              className="w-12 rounded-lg border border-[#d8c8b0] bg-white px-2 py-1 text-center text-sm text-[#2f251a] outline-none focus:ring-2 focus:ring-[#c8a87f]"
            />
            <span className="text-sm text-[#8a7a6b]">/ {numPages}</span>
            <button
              onClick={() => go(currentPage + 1)}
              disabled={currentPage >= numPages}
              className="rounded-full px-2.5 py-1.5 text-sm text-[#4a3c30] hover:bg-[#efe4d3] disabled:opacity-40"
            >
              ›
            </button>
          </div>

          {/* Zoom / fit */}
          <div className="flex items-center gap-1 rounded-full border border-[#d8c8b0] bg-white px-1 py-0.5 text-[#4a3c30]">
            <button
              onClick={() => zoomBy(0.87)}
              className="rounded-full px-2 py-0.5 text-base leading-none hover:bg-[#efe4d3]"
              title="Zoom out"
            >
              −
            </button>
            <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => zoomBy(1.15)}
              className="rounded-full px-2 py-0.5 text-base leading-none hover:bg-[#efe4d3]"
              title="Zoom in"
            >
              +
            </button>
          </div>
          <div className="hidden items-center gap-1 sm:flex">
            <button onClick={fitWidth} className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[#4a3c30] hover:bg-[#efe4d3]" title="Fit width">
              Fit W
            </button>
            <button onClick={fitPage} className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[#4a3c30] hover:bg-[#efe4d3]" title="Fit page">
              Fit H
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-full border border-[#d8c8b0] text-xs font-semibold">
              {(['en', 'pt'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-3 py-1.5 ${
                    lang === l ? 'bg-[#a4573f] text-[#fdf4e6]' : 'bg-white text-[#6e5d4f]'
                  }`}
                >
                  {l === 'en' ? 'EN' : 'PT'}
                </button>
              ))}
            </div>
            <button
              onClick={cancelAndRestart}
              className="rounded-full p-2 text-[#6e5d4f] hover:bg-[#efe4d3]"
              aria-label="Cancel translations and restart from this page"
              title="Cancel translations & restart from here"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 13a9 9 0 1 0 3-7.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-full p-2 text-[#6e5d4f] hover:bg-[#efe4d3]"
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
        {!apiKey && (
          <div className="bg-[#a4573f] px-4 py-2 text-center text-sm text-[#fdf4e6]">
            Add your OpenRouter API key in{' '}
            <button onClick={() => setSettingsOpen(true)} className="underline">
              Settings
            </button>{' '}
            to start translating.
          </div>
        )}
        {transError && apiKey && (
          <div className="bg-red-800 px-4 py-2 text-center text-sm text-white">{transError}</div>
        )}
      </header>

      {/* Scrolling page stage (both axes so zoomed-in pages stay centered & pannable) */}
      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-auto">
        <div
          className="flex flex-col items-center px-4 py-6"
          style={{ minWidth: '100%', width: 'max-content', marginInline: 'auto' }}
        >
          {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
            <div
              key={p}
              data-page={p}
              ref={(el) => {
                if (el) slotEls.current.set(p, el);
                else slotEls.current.delete(p);
              }}
              // Explicit width so the stage's scroll dimensions are correct
              // synchronously on zoom (before the canvas re-renders), which keeps
              // horizontal centering accurate.
              style={{ width: pageWidth, minHeight: reservedHeight, marginBottom: PAGE_GAP }}
            >
              {visible.has(p) ? (
                <div className="overflow-hidden rounded-[6px] shadow-[0_24px_60px_-40px_rgba(32,24,18,0.55)] ring-1 ring-[#e6d8c4]">
                  <TranslatedPage
                    pdfDoc={pdfDoc}
                    pageNum={p}
                    width={pageWidth}
                    translations={translations[p]}
                    showOriginal={showOriginal}
                    fontScale={fontScale}
                    placeholderHeight={reservedHeight}
                  />
                </div>
              ) : (
                <div
                  className="flex items-center justify-center rounded-[6px] bg-[#f3ead9]/40 text-sm"
                  style={{ height: reservedHeight }}
                >
                  <span className="text-[#bcae99]">{p}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Non-intrusive translating indicator (absolute; never shifts layout) */}
      {busy && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[#2f251a]/90 px-3.5 py-2 text-xs text-[#fdf4e6] shadow-lg">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#fdf4e6]/40 border-t-[#fdf4e6]" />
          Translating…
        </div>
      )}

      {settingsSheet}
    </div>
  );
}
