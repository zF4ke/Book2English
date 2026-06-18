import { NextResponse } from 'next/server';

export const runtime = 'edge';

// Proxies OpenRouter's public model catalogue so the client gets live pricing
// without CORS issues. Cached at the edge for an hour.
export async function GET() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ models: [] });
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];

    const models = data
      .filter((m: { architecture?: { output_modalities?: string[] } }) => {
        const out = m.architecture?.output_modalities;
        return !out || out.includes('text');
      })
      .map((m: { id: string; name?: string; pricing?: { prompt?: string; completion?: string } }) => {
        const inPrice = Number(m.pricing?.prompt ?? 0) * 1e6;
        const outPrice = Number(m.pricing?.completion ?? 0) * 1e6;
        return {
          id: m.id,
          name: m.name || m.id,
          inPrice,
          outPrice,
          free: inPrice === 0 && outPrice === 0,
        };
      });

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
