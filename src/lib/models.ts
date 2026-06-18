// Model catalogue for the picker. We feature a curated set of cost-efficient
// text models and enrich them with live OpenRouter pricing (via /api/models).

export type ModelInfo = {
  id: string;
  name: string;
  inPrice: number; // USD per 1M input tokens
  outPrice: number; // USD per 1M output tokens
  free: boolean;
};

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

// Curated, cost-efficient models surfaced first (in this order) when present in
// the live catalogue. Unknown ids are simply skipped, so it's safe to list a few
// speculative ones — live data decides what actually shows.
export const FEATURED_IDS: string[] = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash-lite-preview-09-2025',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-flash',
  'openai/gpt-5-nano',
  'openai/gpt-4.1-nano',
  'openai/gpt-4o-mini',
  'openai/gpt-4.1-mini',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-chat-v3.1',
  'meta-llama/llama-3.3-70b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'mistralai/mistral-small-3.2-24b-instruct',
  'minimax/minimax-m2',
];

// Used if the live catalogue can't be fetched. Prices are approximate.
export const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', inPrice: 0.1, outPrice: 0.4, free: false },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', inPrice: 0.1, outPrice: 0.4, free: false },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', inPrice: 0.3, outPrice: 2.5, free: false },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', inPrice: 0.15, outPrice: 0.6, free: false },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', inPrice: 0.25, outPrice: 0.85, free: false },
];

// Build the picker list: featured models that exist (in featured order), then a
// handful of the cheapest remaining paid text models for breadth.
export function buildPickerList(all: ModelInfo[]): ModelInfo[] {
  if (!all.length) return FALLBACK_MODELS;
  const byId = new Map(all.map((m) => [m.id, m]));
  const featured = FEATURED_IDS.map((id) => byId.get(id)).filter(Boolean) as ModelInfo[];
  const featuredSet = new Set(featured.map((m) => m.id));

  const extras = all
    .filter((m) => !featuredSet.has(m.id) && !m.free && m.outPrice > 0)
    .sort((a, b) => a.inPrice + a.outPrice - (b.inPrice + b.outPrice))
    .slice(0, 6);

  const list = [...featured, ...extras];
  return list.length ? list : FALLBACK_MODELS;
}

export async function loadModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetch('/api/models');
    if (!res.ok) return FALLBACK_MODELS;
    const json = (await res.json()) as { models?: ModelInfo[] };
    return buildPickerList(json.models ?? []);
  } catch {
    return FALLBACK_MODELS;
  }
}

export function formatPrice(m: ModelInfo): string {
  if (m.free) return 'free';
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2));
  return `$${fmt(m.inPrice)} / $${fmt(m.outPrice)}`;
}
