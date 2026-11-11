import { NextRequest, NextResponse } from "next/server";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { hasHandwrittenUi, isLangCode, languageInfo, type LangCode } from "@/lib/i18n/languages";
import { placeholders, uiPart, uiPartCount, uiVersion } from "@/lib/i18n/ui-translation-shared";

export const runtime = "nodejs";
export const maxDuration = 60;

// Traduit l'INTERFACE (textes courts de l'application) dans l'une des langues ajoutées, par morceaux de 50 textes.
// Le résultat est gardé en mémoire du serveur : la première personne qui choisit une langue la « paie »,
// les suivantes la reçoivent instantanément. Ouvert sans connexion (page de connexion), limité par adresse IP.

const cache = new Map<string, Record<string, string>>();
const inFlight = new Map<string, Promise<Record<string, string> | null>>();

async function translatePart(lang: LangCode, part: number): Promise<Record<string, string> | null> {
  const source = uiPart(part);
  const target = languageInfo(lang).englishName;
  const prompt = `Translate the VALUES of this JSON object from English into ${target}. These are short texts of a study application's user interface.
Rules:
- Return ONLY a JSON object with exactly the same keys. Do not translate the keys.
- Keep placeholders such as {n}, {name}, {count} EXACTLY as they are.
- Keep the brand name "Study Helper", emojis, numbers and URLs unchanged.
- Keep each text short and natural for a button or label; same tone (friendly, clear, addressed to a student).
- No comments, no markdown.

${JSON.stringify(source)}`;
  const result = await callGemini(prompt, undefined, true, [], { lang, temperature: 0.1, timeoutMs: 55_000, maxOutputTokens: 8192 });
  if (!result.ok) {
    console.error(`[translate-ui] échec Gemini (${lang}, morceau ${part}) :`, result.detail);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text.replace(/^```(?:json)?|```$/gm, "").trim());
  } catch {
    console.error(`[translate-ui] réponse non JSON (${lang}, morceau ${part})`);
    return null;
  }
  const out: Record<string, string> = {};
  for (const [k, original] of Object.entries(source)) {
    const v = (parsed as Record<string, unknown>)?.[k];
    // Une traduction qui perd ou change une variable est écartée : la clé reste en anglais.
    if (typeof v === "string" && v.trim() && placeholders(v) === placeholders(original)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const burst = hitRateLimit(`translate-ui:${ip}`, 40, 60_000);
  if (!burst.ok) {
    return NextResponse.json({ error: "Trop de demandes.", code: "too_many_requests" }, { status: 429, headers: { "Retry-After": String(burst.retryAfterSec) } });
  }
  const body = (await req.json().catch(() => null)) as { language?: unknown; part?: unknown } | null;
  const language = typeof body?.language === "string" ? body.language.trim().toLowerCase() : "";
  const part = typeof body?.part === "number" ? Math.floor(body.part) : 0;
  const parts = uiPartCount();
  if (!isLangCode(language) || hasHandwrittenUi(language) || part < 0 || part >= parts) {
    return NextResponse.json({ error: "Demande invalide.", code: "invalid_request" }, { status: 400 });
  }
  if (!hasGeminiKey()) return NextResponse.json({ error: "IA non configurée.", code: "not_configured" }, { status: 500 });

  const key = `${uiVersion()}:${language}:${part}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json({ entries: hit, part, parts, version: uiVersion() });

  let job = inFlight.get(key);
  if (!job) {
    job = translatePart(language, part).finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }
  const entries = await job;
  if (!entries) return NextResponse.json({ error: "Traduction indisponible.", code: "server_error" }, { status: 502 });
  cache.set(key, entries);
  return NextResponse.json({ entries, part, parts, version: uiVersion() });
}
