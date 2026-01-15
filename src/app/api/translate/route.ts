import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, pages, language, apiKey: userApiKey, model: requestedModel } = body;

    const allowedModels = new Set<string>([
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash-preview-09-2025',
      'gemini-2.5-flash-lite-preview-09-2025',
    ]);

    const parseJsonLoose = (raw: string) => {
      const trimmed = raw.trim();
      const withoutFences = trimmed
        .replace(/^```json\s*/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();
      const candidates = [withoutFences];
      const firstBrace = withoutFences.indexOf("{");
      const lastBrace = withoutFences.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        candidates.push(withoutFences.slice(firstBrace, lastBrace + 1));
      }
      for (const candidate of candidates) {
        try {
          return JSON.parse(candidate);
        } catch (e) {
          // continue trying
        }
      }
      return null;
    };

    if (!text && !Array.isArray(pages)) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const targetLang = language === "pt" ? "Portuguese" : "English";

    const apiKey = (typeof userApiKey === "string" && userApiKey.trim()) || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not set" }, { status: 500 });
    }

    // Allow overriding the model from the client (settings dropdown), but only for a known-safe allowlist.
    // Fallback order: request -> env -> default.
    const requestedModelId = typeof requestedModel === 'string' ? requestedModel.trim() : '';
    const modelId = (requestedModelId && allowedModels.has(requestedModelId))
      ? requestedModelId
      : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');

    // GoogleGenerativeAI currently defaults to v1; if the SDK adds apiVersion later,
    // remove this comment and pass the option. Keeping single-arg to satisfy typings.
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelId });

    // Batch mode: translate multiple pages in one prompt
    if (Array.isArray(pages)) {
      const cleaned = pages
        .filter((p: any) => p && p.page && typeof p.page === "number" && p.text)
        .map((p: any) => ({ page: p.page, text: String(p.text) }));

      if (!cleaned.length) {
        return NextResponse.json({ error: "No valid pages provided" }, { status: 400 });
      }

      const pageText = cleaned
        .sort((a, b) => a.page - b.page)
        .map(({ page, text }) => `Page ${page}:\n${text}`)
        .join("\n\n---\n\n");

      const prompt = `You are translating multiple consecutive book pages into ${targetLang}. For each page, preserve the original flow and paragraph breaks so it matches the source layout. Do not add headings, numbering, or commentary beyond the page markers. Return plain text only, with each page clearly separated and labeled as provided.\n\n${pageText}\n\nReturn JSON with an array under the key "translations", each item shaped like {"page": <number>, "text": "<translated page text>"}.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const raw = response.text();

      const parsed = parseJsonLoose(raw);
      if (parsed && Array.isArray((parsed as any).translations)) {
        return NextResponse.json({ translations: (parsed as any).translations });
      }

      // Fallback: if the model didn't return usable JSON, return raw text per page
      const fallbackTranslations = cleaned.map(({ page }) => ({ page, text: raw }));
      return NextResponse.json({ translations: fallbackTranslations });
    }

    // Single page mode
    const prompt = `You are translating a book page into ${targetLang}. Preserve the original flow and add clean paragraph breaks so it reads like the source layout. Do not add headings, numbering, or commentary. Output plain text only.\n\nOriginal page text:\n${text}\n\nReturn only the translated text with intentional line breaks between paragraphs.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const translatedText = response.text();

    return NextResponse.json({ translation: translatedText });
  } catch (error) {
    console.error("Error translating text:", error);
    const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
    const statusText = (error as any)?.statusText || (error as any)?.message || "Failed to translate text";
    const details = (error as any)?.errorDetails || (error as any)?.details;
    return NextResponse.json({ error: statusText, details }, { status });
  }
}
