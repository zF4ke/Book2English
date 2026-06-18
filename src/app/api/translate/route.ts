import { NextResponse } from 'next/server';
import { DEFAULT_MODEL } from '@/lib/models';

export const runtime = 'edge';

type Block = { id: string; text: string };

function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  const noFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const candidates = [noFences];
  const first = noFences.indexOf('{');
  const last = noFences.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(noFences.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // keep trying
    }
  }
  return null;
}

export async function POST(req: Request) {
  let body: {
    blocks?: Block[];
    language?: string;
    apiKey?: string;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { blocks, language, apiKey, model } = body;

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return NextResponse.json({ error: 'No blocks provided' }, { status: 400 });
  }

  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) {
    return NextResponse.json(
      { error: 'Missing OpenRouter API key. Add yours in Settings.' },
      { status: 401 }
    );
  }

  const targetLang = language === 'pt' ? 'Portuguese' : 'English';
  // BYO key: the user pays with their own key, so any model id they pick is fine.
  const modelId = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL;

  const cleaned = blocks
    .filter((b) => b && typeof b.id === 'string' && typeof b.text === 'string' && b.text.trim())
    .map((b) => ({ id: b.id, text: b.text.trim() }));

  if (!cleaned.length) {
    return NextResponse.json({ error: 'No translatable text in blocks' }, { status: 400 });
  }

  const payload = cleaned.map((b) => ({ id: b.id, text: b.text }));

  const system =
    `You are a professional literary translator. Translate each text segment into ${targetLang}. ` +
    `Preserve meaning, tone, and register. Do NOT add commentary, notes, titles, or quotation marks. ` +
    `Translate every segment, even short ones. If a segment is a proper noun, number, or already in ${targetLang}, return it unchanged. ` +
    `Return ONLY valid JSON of the exact shape {"translations":[{"id":"<id>","text":"<translation>"}]} with one entry per input id.`;

  const user = JSON.stringify({ segments: payload });

  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://book2english.vercel.app',
        'X-Title': 'Book2English',
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.2,
        // Generous ceiling so the JSON response isn't truncated mid-string
        // (truncation is the main cause of unparseable output).
        max_tokens: 8000,
        response_format: { type: 'json_object' },
        // Provider routing: non-Google models otherwise default to cheaper but
        // slower third-party providers. `throughput` picks the fastest provider
        // for the chosen model; `require_parameters` ensures the provider honors
        // response_format/max_tokens (a silent drop produces non-JSON output).
        provider: { sort: 'throughput', require_parameters: true },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach OpenRouter: ${(e as Error)?.message || 'network error'}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || err?.error || '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    return NextResponse.json(
      { error: `OpenRouter error (${res.status})${detail ? `: ${detail}` : ''}` },
      { status: res.status }
    );
  }

  let content = '';
  try {
    const data = await res.json();
    content = data?.choices?.[0]?.message?.content ?? '';
  } catch {
    return NextResponse.json({ error: 'Malformed response from OpenRouter' }, { status: 502 });
  }

  const parsed = parseJsonLoose(content) as { translations?: Array<{ id: string; text: string }> } | null;
  if (parsed && Array.isArray(parsed.translations)) {
    const valid = parsed.translations.filter(
      (t) => t && typeof t.id === 'string' && typeof t.text === 'string'
    );
    return NextResponse.json({ translations: valid });
  }

  // Single-block fallback: model may have returned bare text.
  if (cleaned.length === 1 && content.trim()) {
    return NextResponse.json({ translations: [{ id: cleaned[0].id, text: content.trim() }] });
  }

  return NextResponse.json({ error: 'Could not parse translation output' }, { status: 502 });
}
