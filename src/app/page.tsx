'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('@/components/PDFViewer'), {
  ssr: false,
  loading: () => <p>Loading PDF Viewer...</p>,
});

export default function Home() {
  const defaultMinChars = Number(process.env.NEXT_PUBLIC_MIN_TRANSLATE_CHARS || 16);
  const defaultMaxBatchPages = Number(process.env.NEXT_PUBLIC_MAX_BATCH_PAGES || 2);
  const defaultCacheEntries = 10;
  const cachePrefixRef = useRef<string>('');
  const cacheReadyRef = useRef<boolean>(false);
  const pendingRequests = useRef<number>(0);
  const debugLog = (...args: unknown[]) => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV === 'production') return;
    console.log('[translate-debug]', ...args);
  };

  const startLoading = () => {
    pendingRequests.current += 1;
    setIsLoading(true);
  };

  const stopLoading = () => {
    pendingRequests.current = Math.max(0, pendingRequests.current - 1);
    if (pendingRequests.current === 0) setIsLoading(false);
  };
  type CachedEntry = { language: 'en' | 'pt'; page: number; text: string };
  const [file, setFile] = useState<File | null>(null);
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageCount, setPageCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showTranslation, setShowTranslation] = useState<boolean>(true);
  const [autoTranslate, setAutoTranslate] = useState<boolean>(true);
  const [batchTranslate, setBatchTranslate] = useState<boolean>(true);
  const [fontSize, setFontSize] = useState<number>(12);
  const [bgColor, setBgColor] = useState<string>('#fdf8f1');
  const [textColor] = useState<string>('#2f251a');
  const [language, setLanguage] = useState<'en' | 'pt'>('en');
  const [showStyleMenu, setShowStyleMenu] = useState<boolean>(false);
  const [showLangMenu, setShowLangMenu] = useState<boolean>(false);
  const [showActionMenu, setShowActionMenu] = useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
  const [minChars, setMinChars] = useState<number>(defaultMinChars);
  const [maxBatchPages, setMaxBatchPages] = useState<number>(defaultMaxBatchPages);
  const [apiKey, setApiKey] = useState<string>('');
  const [cacheTranslationsEnabled, setCacheTranslationsEnabled] = useState<boolean>(true);
  const [maxCachedEntries, setMaxCachedEntries] = useState<number>(defaultCacheEntries);
  const [pageInput, setPageInput] = useState<string>('1');
  const fetchingPages = useRef<Set<number>>(new Set());
  const lastTexts = useRef<{ current: string; next: string }>({ current: '', next: '' });
  const pageTextCache = useRef<Record<number, string>>({});
  const jumpDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [warnings, setWarnings] = useState<Record<number, string>>({});

  // Load persisted settings once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedKey = window.localStorage.getItem('geminiApiKey');
    if (storedKey) setApiKey(storedKey);

    const storedMin = window.localStorage.getItem('minChars');
    if (storedMin && !Number.isNaN(Number(storedMin))) setMinChars(Number(storedMin));

    const storedMax = window.localStorage.getItem('maxBatchPages');
    if (storedMax && !Number.isNaN(Number(storedMax))) setMaxBatchPages(Number(storedMax));

    const storedCacheFlag = window.localStorage.getItem('cacheTranslationsEnabled');
    if (storedCacheFlag === 'false') setCacheTranslationsEnabled(false);

    const storedCacheSize = window.localStorage.getItem('maxCachedEntries');
    if (storedCacheSize && !Number.isNaN(Number(storedCacheSize))) setMaxCachedEntries(Number(storedCacheSize));
  }, []);

  // Persist settings to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (apiKey) {
      window.localStorage.setItem('geminiApiKey', apiKey);
    } else {
      window.localStorage.removeItem('geminiApiKey');
    }
  }, [apiKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('minChars', String(minChars));
  }, [minChars]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('maxBatchPages', String(maxBatchPages));
  }, [maxBatchPages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('cacheTranslationsEnabled', cacheTranslationsEnabled ? 'true' : 'false');
  }, [cacheTranslationsEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('maxCachedEntries', String(maxCachedEntries));
  }, [maxCachedEntries]);

  const loadCachedTranslations = useCallback((lang: 'en' | 'pt') => {
    if (!cachePrefixRef.current) return {} as Record<number, string>;
    if (typeof window === 'undefined') return {} as Record<number, string>;
    try {
      const raw = window.localStorage.getItem(`cachedTranslations:${cachePrefixRef.current}`);
      if (!raw) return {} as Record<number, string>;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return {} as Record<number, string>;
      const subset: Record<number, string> = {};
      parsed.forEach((entry: CachedEntry) => {
        if (entry && entry.language === lang && typeof entry.page === 'number' && typeof entry.text === 'string') {
          subset[entry.page] = entry.text;
        }
      });
      return subset;
    } catch (e) {
      console.warn('Failed to load cached translations', e);
      return {} as Record<number, string>;
    }
  }, []);

  const saveCachedTranslation = useCallback((lang: 'en' | 'pt', page: number, text: string) => {
    if (!cachePrefixRef.current) return;
    if (!cacheTranslationsEnabled) return;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`cachedTranslations:${cachePrefixRef.current}`);
      const parsedList = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsedList) ? parsedList : [];
      const filtered = list.filter((entry: CachedEntry) => !(entry && entry.language === lang && entry.page === page));
      filtered.unshift({ language: lang, page, text });
      const trimmed = filtered.slice(0, Math.max(1, maxCachedEntries));
      window.localStorage.setItem(`cachedTranslations:${cachePrefixRef.current}`, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Failed to save cached translation', e);
    }
  }, [cacheTranslationsEnabled, maxCachedEntries]);

  const getCachedTranslation = useCallback(
    (lang: 'en' | 'pt', page: number) => {
      if (translations[page]) return translations[page];
      if (!cachePrefixRef.current) return undefined;
      if (typeof window === 'undefined') return undefined;
      try {
        const raw = window.localStorage.getItem(`cachedTranslations:${cachePrefixRef.current}`);
        if (!raw) return undefined;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return undefined;
        const hit = list.find((entry: CachedEntry) => entry && entry.language === lang && entry.page === page);
        if (hit && typeof hit.text === 'string') {
          setTranslations((prev) => ({ ...prev, [page]: hit.text }));
          return hit.text;
        }
      } catch (e) {
        console.warn('Failed to read cached translation', e);
      }
      return undefined;
    },
    [translations]
  );

  useEffect(() => {
    if (!cacheReadyRef.current) return;
    const cached = loadCachedTranslations(language);
    if (Object.keys(cached).length) {
      setTranslations((prev) => ({ ...cached, ...prev }));
    }
  }, [language, loadCachedTranslations]);

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { files } = event.target;

    if (files && files[0]) {
      setFile(files[0]);
      setTranslations({});
      setCurrentPage(1);
      setPageCount(0);
      fetchingPages.current.clear();
      cachePrefixRef.current = '';
      cacheReadyRef.current = false;
    }
  }

  const fetchTranslation = useCallback(async (text: string, pageNum: number) => {
    const cached = getCachedTranslation(language, pageNum);
    if (cached) return;
    if (!autoTranslate) return;
    const clean = text.trim();
    if (!clean || clean.length < minChars) {
      const msg = `Page text too short (${clean.length}/${minChars}). Not translating.`;
      setWarnings((prev) => ({ ...prev, [pageNum]: msg }));
      setTranslations((prev) => ({ ...prev, [pageNum]: msg }));
      return; // skip tiny snippets to avoid noisy/expensive calls
    }
    setWarnings((prev) => {
      const next = { ...prev };
      delete next[pageNum];
      return next;
    });
    if (translations[pageNum] || fetchingPages.current.has(pageNum)) return;

    fetchingPages.current.add(pageNum);
    startLoading();

    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language, apiKey }),
      });

      if (!response.ok) {
          let errorBody: unknown = null;
          try {
            errorBody = await response.json();
          } catch {
            // ignore
          }
          const errorData = (errorBody && typeof errorBody === 'object') ? errorBody as { error?: string; details?: unknown } : undefined;
          const statusText = errorData?.error || response.statusText || 'Unexpected error';
          const details = errorData?.details;
          const detailText = Array.isArray(details)
            ? details
                .map((d) => {
                  if (typeof d === 'string') return d;
                  if (d && typeof d === 'object' && 'message' in d && typeof (d as { message?: unknown }).message === 'string') {
                    return (d as { message: string }).message;
                  }
                  return '';
                })
                .filter(Boolean)
                .join('; ')
            : (typeof details === 'string' ? details : '');
          const suffix = detailText ? `: ${detailText}` : '';
          setWarnings((prev) => ({ ...prev, [pageNum]: `Error translating page (${response.status} ${statusText}${suffix})` }));
        return;
      }

      const data = await response.json();
      if (data.translation) {
        setTranslations(prev => ({ ...prev, [pageNum]: data.translation }));
        saveCachedTranslation(language, pageNum, data.translation);
        setWarnings((prev) => {
          const next = { ...prev };
          delete next[pageNum];
          return next;
        });
      }
    } catch (error) {
      console.error(`Error translating page ${pageNum}:`, error);
      setWarnings((prev) => ({ ...prev, [pageNum]: `Error translating page (${(error as Error)?.message || 'Unknown error'})` }));
    } finally {
      fetchingPages.current.delete(pageNum);
      stopLoading();
    }
    }, [translations, minChars, autoTranslate, language, apiKey, saveCachedTranslation, getCachedTranslation]);

    const fetchTranslationBatch = useCallback(async (pages: { page: number; text: string }[]) => {
      if (!autoTranslate) return;
      if (!pages.length) return;

      debugLog('batch:start', { incoming: pages.map((p) => p.page), maxBatchPages });

      const seenPages = new Set<number>();
      const skipped: { page: number; reason: string }[] = [];
      const pending = pages.filter(({ page, text }) => {
        if (seenPages.has(page)) return false;
        seenPages.add(page);
        const cached = getCachedTranslation(language, page);
        if (cached) {
          skipped.push({ page, reason: 'cached' });
          return false;
        }
        const clean = text.trim();
        if (!clean || clean.length < minChars) {
          const msg = `Page text too short (${clean.length}/${minChars}). Not translating.`;
          setWarnings((prev) => ({ ...prev, [page]: msg }));
          setTranslations((prev) => ({ ...prev, [page]: msg }));
          skipped.push({ page, reason: 'too-short' });
          return false;
        }
        if (translations[page] || fetchingPages.current.has(page)) return false;
        return true;
      }).slice(0, maxBatchPages);

      if (pending.length < pages.length) {
        debugLog('batch:skipped', skipped);
      }

      if (pending.length > maxBatchPages) {
        debugLog('batch:trimmed', { pending: pending.map((p) => p.page), maxBatchPages });
      }

      debugLog('batch:pending', pending.map((p) => p.page));

      if (!pending.length) return;

      pending.forEach(({ page }) => fetchingPages.current.add(page));
      if (pending.length) startLoading();

      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language, apiKey, pages: pending.map(({ page, text }) => ({ page, text: text.trim() })) }),
        });
        debugLog('batch:request', pending.map((p) => p.page));

        if (!response.ok) {
          let errorBody: unknown = null;
          try {
            errorBody = await response.json();
          } catch {
            // ignore
          }
          const errorData = (errorBody && typeof errorBody === 'object') ? errorBody as { error?: string; details?: unknown } : undefined;
          const statusText = errorData?.error || response.statusText || 'Unexpected error';
          const details = errorData?.details;
          const detailText = Array.isArray(details)
            ? details
                .map((d) => {
                  if (typeof d === 'string') return d;
                  if (d && typeof d === 'object' && 'message' in d && typeof (d as { message?: unknown }).message === 'string') {
                    return (d as { message: string }).message;
                  }
                  return '';
                })
                .filter(Boolean)
                .join('; ')
            : (typeof details === 'string' ? details : '');
          const suffix = detailText ? `: ${detailText}` : '';
          setWarnings((prev) => {
            const next = { ...prev };
            pending.forEach(({ page }) => {
              next[page] = `Error translating page (${response.status} ${statusText}${suffix})`;
            });
            return next;
          });
        } else {
          const data = await response.json();
          if (data.translations && Array.isArray(data.translations)) {
            setTranslations((prev) => {
              const next = { ...prev };
              for (const item of data.translations) {
                if (item.page && item.text) {
                  next[item.page] = item.text;
                  saveCachedTranslation(language, item.page, item.text);
                }
              }
              return next;
            });
            setWarnings((prev) => {
              const next = { ...prev };
              pending.forEach(({ page }) => delete next[page]);
              return next;
            });
          }
        }
      } catch (error) {
        console.error('Error translating batch:', error);
        setWarnings((prev) => {
          const next = { ...prev };
          pending.forEach(({ page }) => {
            next[page] = `Error translating page (${(error as Error)?.message || 'Unknown error'})`;
          });
          return next;
        });
      } finally {
        pending.forEach(({ page }) => fetchingPages.current.delete(page));
        if (pending.length) stopLoading();
      }
    }, [autoTranslate, maxBatchPages, minChars, translations, language, apiKey, saveCachedTranslation, getCachedTranslation]);

  const ensureCachePrefix = useCallback(async (file: File | null) => {
    if (!file) return;
    if (cacheReadyRef.current && cachePrefixRef.current) return;
    try {
      const reader = new FileReader();
      const head = await new Promise<string>((resolve, reject) => {
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        const blob = file.slice(0, 200_000); // read first ~200KB to hash quickly
        reader.readAsText(blob);
      });
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(head));
      const hashHex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      cachePrefixRef.current = `book:${hashHex}`;
      cacheReadyRef.current = true;
    } catch (e) {
      console.warn('Failed to build cache prefix; falling back to shared cache', e);
      cachePrefixRef.current = 'book:default';
      cacheReadyRef.current = true;
    }
  }, []);

  const handlePageChange = useCallback((pageNumber: number, currentText: string, nextText: string, additionalTexts?: Record<number, string>) => {
    setCurrentPage(pageNumber);
    setPageInput(String(pageNumber));
    lastTexts.current = { current: currentText, next: nextText };
    pageTextCache.current[pageNumber] = currentText;
    if (nextText) pageTextCache.current[pageNumber + 1] = nextText;
    if (additionalTexts) {
      Object.entries(additionalTexts).forEach(([page, text]) => {
        pageTextCache.current[Number(page)] = text;
      });
    }

    const cleanCurrent = currentText.trim();
    if (autoTranslate && cleanCurrent.length < minChars) {
      const existingTranslation = translations[pageNumber];
      if (!existingTranslation) {
        const msg = `Page text too short (${cleanCurrent.length}/${minChars}). Not translating.`;
        setWarnings((prev) => ({ ...prev, [pageNumber]: msg }));
        setTranslations((prev) => ({ ...prev, [pageNumber]: msg }));
      } else {
        // Keep the already-fetched translation visible instead of overwriting with a warning
        setWarnings((prev) => {
          if (!prev[pageNumber]) return prev;
          const next = { ...prev };
          delete next[pageNumber];
          return next;
        });
      }
      // Still allow batching for subsequent pages, but skip this one
      // by returning here; next/other pages can be handled on next page change.
      return;
    }

    if (batchTranslate) {
      const futureTranslatedExists = Object.keys(translations)
        .map(Number)
        .some((p) => p > pageNumber && !!translations[p]);
      if (futureTranslatedExists) {
        debugLog('batch:defer', { reason: 'future-translated', pageNumber });
        return;
      }

      const seen = new Set<number>();
      const candidates: { page: number; text: string }[] = [];
      const push = (page: number, text?: string) => {
        if (!text || seen.has(page)) return;
        if (page < 1 || (pageCount && page > pageCount)) return;
        seen.add(page);
        candidates.push({ page, text });
      };

      // Start with current and next
      push(pageNumber, currentText);
      push(pageNumber + 1, nextText || pageTextCache.current[pageNumber + 1]);

      // Add more consecutive pages to reach maxBatchPages
      for (let offset = 2; offset < maxBatchPages * 2; offset++) {
        const p = pageNumber + offset;
        if (p > pageCount) break;
        const cached = pageTextCache.current[p];
        if (cached) {
          push(p, cached);
        } else {
          // Push placeholder; text will be extracted on-demand by PDFViewer or we skip if not available
          // For now, we'll batch only what we have
        }
        if (candidates.length >= maxBatchPages) break;
      }

      const sliced = candidates.slice(0, maxBatchPages);
      debugLog('batch:candidates', sliced.map((c) => c.page));
      fetchTranslationBatch(sliced);
    } else {
      // Translate current page if needed
      fetchTranslation(currentText, pageNumber);

      // Pre-fetch next page translation
      if (nextText) {
        fetchTranslation(nextText, pageNumber + 1);
      }
    }
  }, [autoTranslate, batchTranslate, fetchTranslation, fetchTranslationBatch, maxBatchPages, minChars, pageCount, translations]);

  useEffect(() => {
    ensureCachePrefix(file);
  }, [file, ensureCachePrefix]);

  const handleToggleAutoTranslate = useCallback(() => {
    setAutoTranslate((prev) => {
      const next = !prev;
      if (next) {
        // Re-issue translations for current and next with last seen text
        const { current, next: nxt } = lastTexts.current;
        if (batchTranslate) {
          const payload = [
            { page: currentPage, text: current },
            { page: currentPage + 1, text: nxt },
          ].filter(p => p.text);
          fetchTranslationBatch(payload);
        } else {
          fetchTranslation(current, currentPage);
          if (nxt) fetchTranslation(nxt, currentPage + 1);
        }
      }
      return next;
    });
  }, [fetchTranslation, fetchTranslationBatch, batchTranslate, currentPage]);

  const handleJump = useCallback((value: number) => {
    if (!pageCount) return;
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(Math.max(1, value), pageCount);
    setCurrentPage(clamped);
    setPageInput(String(clamped));
  }, [pageCount]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const handleRetry = useCallback((pageNum: number) => {
    const cachedText = pageTextCache.current[pageNum];
    if (!cachedText) return;
    fetchTranslation(cachedText, pageNum);
  }, [fetchTranslation]);

  return (
    <main className="relative overflow-hidden min-h-screen px-4 py-10 text-[#2f251a]">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-32 -left-28 h-80 w-80 bg-[#d6b768] blur-[120px]" />
        <div className="absolute top-10 right-[-120px] h-72 w-72 bg-[#b66a50] blur-[120px]" />
      </div>

      <div className="relative max-w-6xl mx-auto space-y-8">
        <header className="card-soft rounded-[28px] p-8 md:p-10 shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-[#2f251a] text-[#fdf4e6] flex items-center justify-center text-2xl shadow-lg">✦</div>
              <div className="space-y-2">
                <p className="uppercase text-xs tracking-[0.18em] text-[#826d5b]">Readers desk</p>
                <h1 className="text-4xl md:text-5xl font-semibold leading-tight">Book to English</h1>
                <p className="text-sm text-[#6e5d4f] max-w-2xl">Read, render, and gently translate your books with a warm, classic workspace aesthetic.</p>
              </div>
            </div>
          </div>
        </header>

        {!file ? (
          <section className="card-soft rounded-3xl p-10 soft-grid border border-[#e6d8c5] shadow-xl">
            <div className="flex flex-col md:flex-row items-stretch gap-8">
              <div className="book-frame rounded-2xl p-6 w-full md:w-1/2 pb-16 h-full flex flex-col justify-center">
                <p className="text-sm uppercase tracking-[0.2em] text-[#7c6857] mb-3">Upload</p>
                <h2 className="text-3xl font-semibold leading-tight mb-2">Choose a PDF to begin</h2>
                <p className="text-sm text-[#6c5a4b] leading-relaxed">We will render the pages and whisper them into English with gentle paragraph breaks. Nothing is stored—just translated on the fly.</p>
              </div>
              <label className="flex-1 w-full border-2 border-dashed border-[#d8c8b0] rounded-2xl bg-white/70 hover:bg-white transition-all cursor-pointer p-8 text-center shadow-inner flex flex-col justify-center">
                <div className="space-y-3">
                  <div className="mx-auto h-14 w-14 rounded-full bg-[#b66a50]/15 text-[#8a4c3c] flex items-center justify-center text-2xl">☁</div>
                  <p className="text-lg font-medium">Drop your PDF here or click to browse</p>
                  <p className="text-sm text-[#7a695c]">Single file, any length. We respect your pagination.</p>
                  <input type='file' className="hidden" onChange={onFileChange} accept=".pdf" />
                </div>
              </label>
            </div>
          </section>
        ) : (
          <section className="grid lg:grid-cols-[4fr_0.7fr] gap-6 items-start max-w-6xl mx-auto">
            <div className="book-frame paper-panel rounded-2xl p-10 shadow-2xl h-fit min-h-[760px]">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[#8a7564]">Translation desk</p>
                  <h2 className="text-3xl font-semibold leading-tight">Page whispers</h2>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {isLoading && (
                    <div className="flex items-center gap-2 text-[#6b594a] text-sm bg-white/70 px-3 py-2 rounded-full border border-[#d8c8b0]" aria-live="polite">
                      <span className="inline-block h-4 w-4 border-2 border-[#d8c8b0] border-t-[#8a4c3c] rounded-full animate-spin" />
                      Translating…
                    </div>
                  )}

                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowLangMenu((v) => !v);
                        setShowStyleMenu(false);
                        setShowActionMenu(false);
                      }}
                      className="px-4 py-2 text-sm font-semibold rounded-full btn-ghost hover:bg-[#b66a50] hover:text-[#fdf4e6] flex items-center gap-2 cursor-pointer"
                    >
                      <span aria-hidden className="inline-flex items-center justify-center h-4 w-4 text-[#3f3228]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20" />
                          <path d="M12 2c2.5 3.5 2.5 14.5 0 20" />
                          <path d="M6 6c1.5 1.5 3 3.5 3 6s-1.5 4.5-3 6" />
                          <path d="M18 6c-1.5 1.5-3 3.5-3 6s1.5 4.5 3 6" />
                        </svg>
                      </span>
                      Language
                    </button>
                    {showLangMenu && (
                      <div className="absolute right-0 mt-2 w-48 rounded-xl border border-[#d8c8b0] bg-white shadow-lg z-10 p-2 space-y-2">
                        <button
                          className={`w-full text-left px-3 py-3 text-sm rounded-lg border cursor-pointer ${language === 'en' ? 'border-[#b66a50] bg-[#f7efe3] text-[#2f251a] font-semibold' : 'border-[#e2d5c1] text-[#4a3c30]' } hover:bg-[#b66a50] hover:text-[#fdf4e6]`}
                          onClick={() => { setLanguage('en'); }}
                        >
                          English
                        </button>
                        <button
                          className={`w-full text-left px-3 py-3 text-sm rounded-lg border cursor-pointer ${language === 'pt' ? 'border-[#b66a50] bg-[#f7efe3] text-[#2f251a] font-semibold' : 'border-[#e2d5c1] text-[#4a3c30]' } hover:bg-[#b66a50] hover:text-[#fdf4e6]`}
                          onClick={() => { setLanguage('pt'); }}
                        >
                          Portuguese
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowStyleMenu((v) => !v);
                        setShowLangMenu(false);
                        setShowActionMenu(false);
                      }}
                      className="px-4 py-2 text-sm font-semibold rounded-full btn-ghost hover:bg-[#b66a50] hover:text-[#fdf4e6] flex items-center gap-2 cursor-pointer"
                    >
                      <span aria-hidden className="inline-flex items-center justify-center h-4 w-4 text-[#3f3228]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M21 14.5a4.5 4.5 0 0 0-4.5-4.5H7a4 4 0 0 1 0-8h8.5a4.5 4.5 0 0 1 0 9H13" />
                          <path d="M12 16v6" />
                          <path d="M9 19h6" />
                        </svg>
                      </span>
                      Styling
                    </button>
                    {showStyleMenu && (
                      <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[#d8c8b0] bg-white shadow-lg z-10 p-3 space-y-3">
                        <label className="block text-sm text-[#4a3c30]">Font size</label>
                        <div className="grid grid-cols-2 gap-2">
                          {[8,12,16,18].map((size) => (
                            <button
                              key={size}
                              onClick={() => { setFontSize(size); }}
                              className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${fontSize === size ? 'border-[#b66a50] bg-[#f7efe3] text-[#2f251a]' : 'border-[#e2d5c1] text-[#4a3c30]'} hover:bg-[#b66a50] hover:text-[#fdf4e6]`}
                            >
                              {size === 8 ? 'Small' : size === 12 ? 'Medium' : size === 16 ? 'Large' : 'X-Large'}
                            </button>
                          ))}
                        </div>
                        <label className="block text-sm text-[#4a3c30] pt-1">Background</label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { v: '#fdf8f1', label: 'Parchment' },
                            { v: '#ffffff', label: 'White' },
                            { v: '#f4efe3', label: 'Ivory' },
                            { v: '#eef2e0', label: 'Sage mist' },
                          ].map((opt) => (
                            <button
                              key={opt.v}
                              onClick={() => { setBgColor(opt.v); }}
                              className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${bgColor === opt.v ? 'border-[#b66a50] bg-[#f7efe3] text-[#2f251a]' : 'border-[#e2d5c1] text-[#4a3c30]'} hover:bg-[#b66a50] hover:text-[#fdf4e6]`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {/* <label className="block text-sm text-[#4a3c30] pt-1">Text color</label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { v: '#2f251a', label: 'Ink' },
                            { v: '#1f2937', label: 'Slate' },
                            { v: '#3b2f23', label: 'Chestnut' },
                            { v: '#0f172a', label: 'Night' },
                          ].map((opt) => (
                            <button
                              key={opt.v}
                              onClick={() => { setTextColor(opt.v); }}
                              className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${textColor === opt.v ? 'border-[#b66a50] bg-[#f7efe3] text-[#2f251a]' : 'border-[#e2d5c1] text-[#4a3c30]'} hover:bg-[#b66a50] hover:text-[#fdf4e6]`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div> */}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowActionMenu((v) => !v);
                        setShowLangMenu(false);
                        setShowStyleMenu(false);
                        setShowSettingsMenu(false);
                      }}
                      className="px-4 py-2 text-sm font-semibold rounded-full btn-ghost hover:bg-[#b66a50] hover:text-[#fdf4e6] flex items-center gap-2 cursor-pointer"
>
                      <span aria-hidden className="inline-flex items-center justify-center h-4 w-4 text-[#3f3228]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </span>
                      Actions
                    </button>
                    {showActionMenu && (
                      <div className="absolute right-0 mt-2 w-56 rounded-xl border border-[#d8c8b0] bg-white shadow-lg z-10 divide-y divide-[#f0e5d6]">
                        <button
                          onClick={() => { setBatchTranslate((v) => !v); }}
                          className="group w-full text-left px-4 py-3 text-sm hover:bg-[#b66a50] hover:text-[#fdf4e6] text-[#3f3228] flex items-center gap-2 cursor-pointer first:rounded-t-xl last:rounded-b-xl"
                        >
                          <span aria-hidden className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${batchTranslate ? 'text-[#b66a50]' : 'text-[#6b594a]'} group-hover:text-[#fdf4e6]`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              <path d="M3 7h18" />
                              <path d="M3 12h18" />
                              <path d="M3 17h18" />
                            </svg>
                          </span>
                          {batchTranslate ? 'Batch on — switch to single' : 'Use batch mode'}
                        </button>
                        <button
                          onClick={() => { handleToggleAutoTranslate(); }}
                          className="group w-full text-left px-4 py-3 text-sm hover:bg-[#b66a50] hover:text-[#fdf4e6] text-[#3f3228] flex items-center gap-2 cursor-pointer first:rounded-t-xl last:rounded-b-xl"
                        >
                          <span aria-hidden className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${autoTranslate ? 'text-[#b66a50]' : 'text-[#6b594a]'} group-hover:text-[#fdf4e6]`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              {autoTranslate ? (
                                <>
                                  <rect x="6" y="4" width="4" height="16" rx="1" />
                                  <rect x="14" y="4" width="4" height="16" rx="1" />
                                </>
                              ) : (
                                <path d="M6 4l12 8-12 8V4z" />
                              )}
                            </svg>
                          </span>
                          {autoTranslate ? 'Pause auto-translate' : 'Resume auto-translate'}
                        </button>
                        <button
                          onClick={() => { setShowTranslation((v) => !v); }}
                          className="group w-full text-left px-4 py-3 text-sm hover:bg-[#b66a50] hover:text-[#fdf4e6] text-[#3f3228] flex items-center gap-2 cursor-pointer first:rounded-t-xl last:rounded-b-xl"
                        >
                          <span aria-hidden className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${showTranslation ? 'text-[#b66a50]' : 'text-[#6b594a]'} group-hover:text-[#fdf4e6]`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              {showTranslation ? (
                                <>
                                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                                  <circle cx="12" cy="12" r="3" />
                                </>
                              ) : (
                                <>
                                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.08-6.04" />
                                  <path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 3-3" />
                                  <path d="M1 1l22 22" />
                                </>
                              )}
                            </svg>
                          </span>
                          {showTranslation ? 'Hide text' : 'Show text'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowSettingsMenu((v) => !v);
                        setShowLangMenu(false);
                        setShowStyleMenu(false);
                        setShowActionMenu(false);
                      }}
                      className="px-4 py-2 text-sm font-semibold rounded-full btn-primary hover:bg-[#3a2d20] hover:text-[#fdf4e6] flex items-center gap-2 cursor-pointer"
                    >
                      <span aria-hidden className="inline-flex items-center justify-center h-4 w-4 text-[#fdf4e6]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M12 1v2" />
                          <path d="M12 21v2" />
                          <path d="m4.93 4.93 1.41 1.41" />
                          <path d="m17.66 17.66 1.41 1.41" />
                          <path d="M1 12h2" />
                          <path d="M21 12h2" />
                          <path d="m4.93 19.07 1.41-1.41" />
                          <path d="m17.66 6.34 1.41-1.41" />
                          <circle cx="12" cy="12" r="5" />
                        </svg>
                      </span>
                      Settings
                    </button>
                    {showSettingsMenu && (
                      <div className="absolute right-0 mt-2 w-72 rounded-xl border border-[#3a2d20] bg-[#2f251a] text-[#fdf4e6] shadow-2xl shadow-black/30 z-20 p-4 space-y-3">
                        <div>
                          <label className="block text-xs uppercase tracking-[0.15em] text-[#e7d8c4] mb-1">Gemini API key</label>
                          <div className="relative">
                            <input
                              type="password"
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              placeholder="Paste your key"
                              className="w-full rounded-lg border border-[#5a4836] px-3 py-2 pr-10 text-sm bg-[#3a2d20] text-[#fdf4e6] placeholder:text-[#cbbca6] focus:outline-none focus:ring-2 focus:ring-[#c8b58f]"
                            />
                            {apiKey.trim().length > 0 && (
                              <span className="absolute inset-y-0 right-2 flex items-center text-[#58c27d]" aria-label="Key saved">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#d7c6b4] mt-1">Stored locally in your browser and sent only with translate requests.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs uppercase tracking-[0.12em] text-[#e7d8c4] mb-1 whitespace-nowrap">Min chars</label>
                            <input
                              type="number"
                              min={1}
                              value={minChars}
                              onChange={(e) => setMinChars(Math.max(1, Number(e.target.value) || defaultMinChars))}
                              className="w-full rounded-lg border border-[#5a4836] px-3 py-2 text-sm bg-[#3a2d20] text-[#fdf4e6] placeholder:text-[#cbbca6] focus:outline-none focus:ring-2 focus:ring-[#c8b58f]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs uppercase tracking-[0.12em] text-[#e7d8c4] mb-1 whitespace-nowrap">Max batch pages</label>
                            <input
                              type="number"
                              min={1}
                              value={maxBatchPages}
                              onChange={(e) => setMaxBatchPages(Math.max(1, Number(e.target.value) || defaultMaxBatchPages))}
                              className="w-full rounded-lg border border-[#5a4836] px-3 py-2 text-sm bg-[#3a2d20] text-[#fdf4e6] placeholder:text-[#cbbca6] focus:outline-none focus:ring-2 focus:ring-[#c8b58f]"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 items-center">
                          <div className="flex items-center gap-3">
                            <label htmlFor="cache-toggle" className="text-sm text-[#e7d8c4]">Cache translations</label>
                            <button
                              id="cache-toggle"
                              type="button"
                              onClick={() => setCacheTranslationsEnabled((v) => !v)}
                              className={`relative inline-flex h-6 w-12 items-center rounded-full border border-[#5a4836] transition-colors duration-200 overflow-hidden shrink-0 ${cacheTranslationsEnabled ? 'bg-[#58c27d]' : 'bg-[#3a2d20]'}`}
                              aria-pressed={cacheTranslationsEnabled}
                              aria-label="Toggle cache translations"
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${cacheTranslationsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                              />
                            </button>
                          </div>
                          <div>
                            <label className="block text-xs uppercase tracking-[0.12em] text-[#e7d8c4] mb-1 whitespace-nowrap">Cached pages</label>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={maxCachedEntries}
                              onChange={(e) => setMaxCachedEntries(Math.max(1, Math.min(50, Number(e.target.value) || defaultCacheEntries)))}
                              className="w-full rounded-lg border border-[#5a4836] px-3 py-2 text-sm bg-[#3a2d20] text-[#fdf4e6] placeholder:text-[#cbbca6] focus:outline-none focus:ring-2 focus:ring-[#c8b58f]"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-[#e7d8c4]">
                          <button
                            onClick={() => {
                              if (!cachePrefixRef.current) return;
                              if (typeof window === 'undefined') return;
                              window.localStorage.removeItem(`cachedTranslations:${cachePrefixRef.current}`);
                              setTranslations({});
                            }}
                            className="text-sm text-[#f1c9a1] hover:underline cursor-pointer"
                          >
                            Clear cache
                          </button>
                          <span className="text-xs text-[#d7c6b4]">Per book</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-[#e7d8c4]">
                          <button
                            onClick={() => {
                              setApiKey('');
                              setMinChars(defaultMinChars);
                              setMaxBatchPages(defaultMaxBatchPages);
                            }}
                            className="text-sm text-[#f1c9a1] hover:underline cursor-pointer"
                          >
                            Reset to defaults
                          </button>
                          <span className="text-xs text-[#d7c6b4]">Autosaved locally</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 mb-6">
                <button
                  onClick={() => handleJump(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="px-4 py-2 rounded-full btn-ghost hover:bg-[#e7d6c2] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <input
                  type="number"
                  min={1}
                  max={pageCount || undefined}
                  value={pageInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setPageInput(raw);
                    if (jumpDebounce.current) clearTimeout(jumpDebounce.current);
                    jumpDebounce.current = setTimeout(() => {
                      const parsed = Number(raw);
                      if (Number.isFinite(parsed)) handleJump(parsed);
                    }, 400);
                  }}
                  onBlur={() => {
                    const parsed = Number(pageInput);
                    if (Number.isFinite(parsed)) handleJump(parsed);
                    else setPageInput(String(currentPage));
                  }}
                  className="w-24 rounded-full border border-[#d1c1aa] px-4 py-2 text-[#2f251a] bg-white shadow-inner focus:outline-none focus:ring-2 focus:ring-[#c8b58f] text-center"
                />
                <button
                  onClick={() => handleJump(currentPage + 1)}
                  disabled={!pageCount || currentPage >= pageCount}
                  className="px-4 py-2 rounded-full btn-primary hover:bg-[#3a2d20] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
                <span className="text-sm text-[#7a695c]">of {pageCount || '--'}</span>
              </div>

              {isLoading && !translations[currentPage] ? (
                <div className="animate-pulse space-y-5">
                  <div className="h-4 bg-[#e4d7c2] rounded w-3/4"></div>
                  <div className="h-4 bg-[#e4d7c2] rounded"></div>
                  <div className="h-4 bg-[#e4d7c2] rounded"></div>
                  <div className="h-4 bg-[#e4d7c2] rounded w-5/6"></div>
                  <div className="h-4 bg-[#e4d7c2] rounded w-2/3"></div>
                </div>
              ) : showTranslation ? (
                <div
                  className="paper-panel rounded-xl p-6 prose prose-lg max-w-none whitespace-pre-wrap font-serif leading-relaxed tracking-wide border border-[#e1d3c0] shadow-inner"
                  style={{
                    fontSize: `${fontSize}pt`,
                    backgroundColor: bgColor,
                    color: textColor,
                    ['--tw-prose-body' as string]: textColor,
                  }}
                >
                  {warnings[currentPage] ? (
                    <div className="flex flex-col gap-3 text-amber-800 font-semibold font-serif text-lg">
                      <span>{warnings[currentPage]}</span>
                      <button
                        onClick={() => handleRetry(currentPage)}
                        className="self-start px-3 py-2 text-sm rounded-full btn-ghost hover:bg-[#e7d6c2]"
                      >
                        Retry
                      </button>
                    </div>
                  ) : translations[currentPage] ? (
                    translations[currentPage]
                  ) : (
                    <span className="italic text-[#8a7a6b]">{autoTranslate ? 'Translation will appear here...' : 'Auto-translate is paused.'}</span>
                  )}
                </div>
              ) : (
                <div className="text-[#7c6b5d] italic">Translation hidden</div>
              )}
            </div>

            <div className="book-frame rounded-2xl p-4 bg-white/80 max-w-60 overflow-hidden">
              <p className="text-xs uppercase tracking-[0.2em] text-[#8a7564] mb-3">Original</p>
              <PDFViewer
                file={file}
                pageNumber={currentPage}
                onPageNumberChange={setCurrentPage}
                onPageChange={handlePageChange}
                onDocumentReady={setPageCount}
                width={100}
                batchSize={maxBatchPages}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
