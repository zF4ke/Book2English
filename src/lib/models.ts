// Model catalogue for the picker, organised into groups and enriched with live
// OpenRouter pricing (via /api/models). Unknown ids are skipped, so live data
// decides what actually shows.

export type ModelInfo = {
  id: string;
  name: string;
  inPrice: number; // USD per 1M input tokens
  outPrice: number; // USD per 1M output tokens
  free: boolean;
};

export type ModelGroups = {
  recommended: ModelInfo[];
  cheaper: ModelInfo[];
  other: ModelInfo[];
};

export const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

// Current-gen models with the best quality / speed / price balance.
const RECOMMENDED_IDS = [
  'google/gemini-2.5-flash-lite',
  'deepseek/deepseek-v4-flash',
  'qwen/qwen3.6-flash',
  'deepseek/deepseek-v4-pro',
  'openai/gpt-5-nano',
];

// Free or ultra-cheap; may be slower or a bit lower quality.
const CHEAPER_IDS = [
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-30b-a3b',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'mistralai/mistral-small-3.2-24b-instruct',
];

// Older / legacy models — usually similar price but weaker than the above.
const OTHER_IDS = [
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-flash-lite-preview-09-2025',
  'openai/gpt-4o-mini',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'meta-llama/llama-3.3-70b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'deepseek/deepseek-chat',
];

// Used only if the live catalogue can't be fetched. Prices are approximate.
export const FALLBACK_GROUPS: ModelGroups = {
  recommended: [
    { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', inPrice: 0.1, outPrice: 0.4, free: false },
    { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', inPrice: 0.09, outPrice: 0.18, free: false },
  ],
  cheaper: [
    { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron 3 Nano 30B A3B (free)', inPrice: 0, outPrice: 0, free: true },
  ],
  other: [
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', inPrice: 0.15, outPrice: 0.6, free: false },
  ],
};

export function buildGroups(all: ModelInfo[]): ModelGroups {
  if (!all.length) return FALLBACK_GROUPS;
  const byId = new Map(all.map((m) => [m.id, m]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean) as ModelInfo[];

  const recommended = pick(RECOMMENDED_IDS);
  const cheaper = pick(CHEAPER_IDS);
  const used = new Set([...recommended, ...cheaper].map((m) => m.id));

  const otherCurated = pick(OTHER_IDS).filter((m) => !used.has(m.id));
  otherCurated.forEach((m) => used.add(m.id));

  // A few cheapest remaining paid models for breadth, at the bottom.
  const extras = all
    .filter((m) => !used.has(m.id) && !m.free && m.outPrice > 0)
    .sort((a, b) => a.inPrice + a.outPrice - (b.inPrice + b.outPrice))
    .slice(0, 6);

  const other = [...otherCurated, ...extras];
  if (!recommended.length && !cheaper.length && !other.length) return FALLBACK_GROUPS;
  return { recommended, cheaper, other };
}

export function allModels(g: ModelGroups): ModelInfo[] {
  return [...g.recommended, ...g.cheaper, ...g.other];
}

export async function loadModels(): Promise<ModelGroups> {
  try {
    const res = await fetch('/api/models');
    if (!res.ok) return FALLBACK_GROUPS;
    const json = (await res.json()) as { models?: ModelInfo[] };
    return buildGroups(json.models ?? []);
  } catch {
    return FALLBACK_GROUPS;
  }
}

export function formatPrice(m: ModelInfo): string {
  if (m.free) return 'free';
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2));
  return `$${fmt(m.inPrice)} / $${fmt(m.outPrice)}`;
}
