// Grouped model dropdown: Recommended / Cheaper-slower / Others, each row showing
// the model name and its live per-1M-token price (input / output).
'use client';

import { useEffect, useRef, useState } from 'react';
import { allModels, formatPrice, type ModelGroups, type ModelInfo } from '@/lib/models';

type Props = {
  groups: ModelGroups;
  value: string;
  onChange: (id: string) => void;
};

const SECTIONS: { key: keyof ModelGroups; label: string }[] = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'cheaper', label: 'Cheaper / slower' },
  { key: 'other', label: 'Others' },
];

export default function ModelPicker({ groups, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = allModels(groups).find((m) => m.id === value);
  const selectedLabel = selected?.name ?? value;
  const selectedPrice = selected ? formatPrice(selected) : '';

  const row = (m: ModelInfo) => {
    const isSel = m.id === value;
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => {
          onChange(m.id);
          setOpen(false);
        }}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#f6efe3] ${
          isSel ? 'bg-[#f6efe3]' : ''
        }`}
      >
        <span className="truncate text-[#2f251a]">{m.name}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={`tabular-nums text-xs ${m.free ? 'text-[#4f7a52]' : 'text-[#8a7a6b]'}`}>
            {formatPrice(m)}
          </span>
          {isSel && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#a4573f]" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#d8c8b0] bg-white px-3 py-2.5 text-left text-sm outline-none focus:ring-2 focus:ring-[#c8a87f]"
      >
        <span className="truncate font-medium text-[#2f251a]">{selectedLabel}</span>
        <span className="flex shrink-0 items-center gap-2">
          {selectedPrice && <span className="tabular-nums text-xs text-[#8a7a6b]">{selectedPrice}</span>}
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 text-[#8a7a6b] transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute z-10 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-[#e3d5c0] bg-white py-1 shadow-xl">
          {SECTIONS.map(({ key, label }) => {
            const items = groups[key];
            if (!items.length) return null;
            return (
              <div key={key}>
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a3917c]">
                  {label}
                </div>
                {items.map(row)}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-1 text-[11px] text-[#9b8b79]">Price per 1M tokens · input / output</p>
    </div>
  );
}
