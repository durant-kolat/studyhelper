// Client OpenAI (Chat Completions) — DEUXIÈME moteur IA de Study Helper, dédié à la PRATIQUE
// (exercices, entraînement, correction, simulation). Gemini reste le moteur des fonctions existantes.
// SERVEUR UNIQUEMENT : OPENAI_API_KEY n'existe que côté serveur (jamais NEXT_PUBLIC_).

import { composeSystemInstruction } from "../study-helper-rules";
import { languageReminder, type LangCode } from "../i18n/languages";

const DEFAULT_TIMEOUT_MS = 55_000;

export const openaiModel = () => process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
export function hasOpenAIKey() {
  return (process.env.OPENAI_API_KEY ?? "").trim().length > 0;
}

export type AiTurn = { role: "user" | "assistant"; content: string };
export type AiResult = { ok: true; text: string } | { ok: false; detail: string };

/** Image envoyée par l'utilisateur (base64, sans préfixe data:). */
export type AiImage = { mimeType: string; data: string };

export async function callOpenAI(
  prompt: string,
  systemInstruction: string | undefined,
  history: AiTurn[],
  options: { lang: LangCode; temperature?: number; timeoutMs?: number; json?: boolean; images?: AiImage[] }
): Promise<AiResult> {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) return { ok: false, detail: "OPENAI_API_KEY absente côté serveur." };

  const userContent: unknown = options.images?.length
    ? [
        { type: "text", text: `${prompt}\n\n${languageReminder(options.lang)}` },
        ...options.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } })),
      ]
    : `${prompt}\n\n${languageReminder(options.lang)}`;

  const messages = [
    // Mêmes règles pédagogiques obligatoires que pour Gemini : injectées ICI à chaque appel.
    { role: "system", content: composeSystemInstruction(systemInstruction, options.lang) },
    ...history.filter((t) => t.content.trim()).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userContent },
  ];

  const body: Record<string, unknown> = { model: openaiModel(), messages };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.json) body.response_format = { type: "json_object" };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, detail: `HTTP ${res.status} — ${detail.slice(0, 300)}` };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return { ok: false, detail: "Réponse vide." };
    return { ok: true, text };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return { ok: false, detail: aborted ? "Délai dépassé en attendant OpenAI." : `Erreur réseau : ${err instanceof Error ? err.message : String(err)}` };
  }
}
