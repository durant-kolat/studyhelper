// GEMINI N°2 — moteur IA dédié à la PRATIQUE (exercices, entraînement, correction, simulation, quiz guidés,
// exercices photographiés). Il remplace l'ancien client OpenAI : mêmes prompts, mêmes données, même contexte,
// même historique, même format de réponse, mêmes images.
//
// Il est VOLONTAIREMENT séparé de « Gemini n°1 » (lib/gemini.ts : explications, cours, examens, quiz, carrière…),
// qui garde son rôle, ses prompts, son endpoint et son modèle (GEMINI_MODEL) sans aucune modification.
//   Gemini n°1 → GEMINI_MODEL           (défaut : gemini-3.5-flash-lite, OBJECTIF 3)
//   Gemini n°2 → GEMINI_PRACTICE_MODEL  (défaut : gemini-3.5-flash-lite)
// Les deux utilisent la même clé d'API Google (GEMINI_API_KEY) : aucune clé supplémentaire à configurer.
// SERVEUR UNIQUEMENT : la clé n'existe que côté serveur (jamais NEXT_PUBLIC_).

import { composeSystemInstruction } from "../study-helper-rules";
import { languageReminder, type LangCode } from "../i18n/languages";
import { buildContents } from "../gemini";
import { geminiGenerate } from "./gemini-http";
import { normalizeMathJson, normalizeMathText } from "./math-text";

const DEFAULT_TIMEOUT_MS = 55_000;

/** Identifiant API officiel de Gemini 3.5 Flash-Lite. */
export const GEMINI2_DEFAULT_MODEL = "gemini-3.5-flash-lite";

export const gemini2Model = () => process.env.GEMINI_PRACTICE_MODEL?.trim() || GEMINI2_DEFAULT_MODEL;

export function hasGemini2Key() {
  return (process.env.GEMINI_API_KEY ?? "").trim().length > 0;
}

export type AiTurn = { role: "user" | "assistant"; content: string };
export type AiResult = { ok: true; text: string } | { ok: false; detail: string };

/** Image envoyée par l'utilisateur (base64, sans préfixe data:). */
export type AiImage = { mimeType: string; data: string };

export async function callGemini2(
  prompt: string,
  systemInstruction: string | undefined,
  history: AiTurn[],
  // `lang` (langue sélectionnée dans l'application) est OBLIGATOIRE : le compilateur refuse tout appel qui
  // l'oublierait. Le modèle ne choisit jamais lui-même la langue de sortie.
  options: { lang: LangCode; temperature?: number; timeoutMs?: number; json?: boolean; images?: AiImage[]; meter?: { ownerId: string; feature: string } }
): Promise<AiResult> {
  const key = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!key) return { ok: false, detail: "GEMINI_API_KEY absente côté serveur." };

  // Mêmes règles pédagogiques obligatoires + même directive de langue que Gemini n°1 : injectées ICI à chaque appel.
  const contents: { role: "user" | "model"; parts: Record<string, unknown>[] }[] = buildContents(
    history,
    `${prompt}\n\n${languageReminder(options.lang)}`
  );
  if (options.images?.length) {
    const last = contents[contents.length - 1]; // toujours le tour « user » courant
    for (const img of options.images) last.parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }

  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { parts: [{ text: composeSystemInstruction(systemInstruction, options.lang) }] },
  };
  const generationConfig: Record<string, unknown> = {};
  if (options.json) generationConfig.responseMimeType = "application/json";
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  // Appel fiable : nouvelle tentative + modèle de secours (voir lib/ai/gemini-http.ts).
  const r = await geminiGenerate({
    primaryModel: gemini2Model(),
    key,
    body,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: "gemini2",
    meter: options.meter,
  });
  if (!r.ok) return { ok: false, detail: r.status ? `HTTP ${r.status} — ${r.detail}` : r.detail };
  const text: string =
    r.data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  return { ok: true, text: options.json ? normalizeMathJson(text) : normalizeMathText(text) };
}
