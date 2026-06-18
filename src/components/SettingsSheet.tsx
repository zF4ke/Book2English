// Single calm settings panel: OpenRouter key, model, reading size, show-original,
// and cache controls. Replaces the old four-dropdown toolbar.
'use client';

import { useEffect } from 'react';
import type { ModelGroups } from '@/lib/models';
import ModelPicker from './ModelPicker';

type Props = {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  models: ModelGroups;
  fontScale: number;
  setFontScale: (v: number) => void;
  showOriginal: boolean;
  setShowOriginal: (v: boolean) => void;
  prefetchAhead: number;
  setPrefetchAhead: (v: number) => void;
  onClearCache: () => void;
};

export default function SettingsSheet(props: Props) {
  const {
    open,
    onClose,
    apiKey,
    setApiKey,
    model,
    setModel,
    models,
    fontScale,
    setFontScale,
    showOriginal,
    setShowOriginal,
    prefetchAhead,
    setPrefetchAhead,
    onClearCache,
  } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative h-full w-full max-w-sm overflow-y-auto bg-[#fbf5ec] shadow-2xl border-l border-[#e3d5c0]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#ece0cd]">
          <h2 className="text-xl font-semibold text-[#2f251a]">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-[#6e5d4f] hover:bg-[#efe4d3]"
            aria-label="Close settings"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="space-y-7 px-6 py-6">
          <section className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[#8a7564]">
              OpenRouter API key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              className="w-full rounded-xl border border-[#d8c8b0] bg-white px-3 py-2.5 text-sm text-[#2f251a] outline-none focus:ring-2 focus:ring-[#c8a87f]"
            />
            <p className="text-xs text-[#8a7a6b]">
              Stored only in your browser; sent solely with translation requests. Get one at{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[#a4573f] underline"
              >
                openrouter.ai/keys
              </a>
              .
            </p>
          </section>

          <section className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[#8a7564]">
              Model
            </label>
            <ModelPicker groups={models} value={model} onChange={setModel} />
          </section>

          <section className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[#8a7564]">
              Reading size
            </label>
            <input
              type="range"
              min={0.8}
              max={1.6}
              step={0.05}
              value={fontScale}
              onChange={(e) => setFontScale(Number(e.target.value))}
              className="w-full accent-[#a4573f]"
            />
            <div className="text-xs text-[#8a7a6b]">{Math.round(fontScale * 100)}%</div>
          </section>

          <section className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-[#8a7564]">
              Pages translated ahead
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={prefetchAhead}
              onChange={(e) =>
                setPrefetchAhead(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
              }
              className="w-full rounded-xl border border-[#d8c8b0] bg-white px-3 py-2.5 text-sm text-[#2f251a] outline-none focus:ring-2 focus:ring-[#c8a87f]"
            />
            <p className="text-xs text-[#8a7a6b]">
              How many upcoming pages to translate in the background. Higher = smoother
              scrolling, but more tokens used up front.
            </p>
          </section>

          <section className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#2f251a]">Show original</p>
              <p className="text-xs text-[#8a7a6b]">Peek at the untranslated page.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowOriginal(!showOriginal)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                showOriginal ? 'bg-[#a4573f]' : 'bg-[#d8c8b0]'
              }`}
              aria-pressed={showOriginal}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  showOriginal ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </section>

          <section className="border-t border-[#ece0cd] pt-5">
            <button
              onClick={onClearCache}
              className="text-sm font-medium text-[#a4573f] hover:underline"
            >
              Clear cached translations for this book
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}
