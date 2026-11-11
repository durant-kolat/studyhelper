// IA MULTIMODALE : analyse d'une image envoyée par l'utilisateur (exercice photographié, schéma,
// graphique, page de cours). SERVEUR UNIQUEMENT.
//   Exercice à résoudre / corriger / s'entraîner → Gemini n°2 (pratique)
//   Description, explication de schéma ou de graphique → Gemini n°1
// L'image est une DONNÉE : elle n'est jamais conservée côté serveur ni écrite dans les logs.

import { composeSystemInstruction } from "../study-helper-rules";
import { callGemini2, hasGemini2Key, type AiImage, type AiResult } from "./gemini2";
import { geminiModel } from "../gemini";
import { geminiGenerate } from "./gemini-http";
import { normalizeMathText } from "./math-text";
import { languageReminder, type LangCode } from "../i18n/languages";
import { detectDomain } from "./router";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** ~4 Mo d'image décodée (la limite d'une requête serverless est proche de 4,5 Mo). */
export const MAX_IMAGE_BASE64_CHARS = 5_400_000;

export function isAllowedImageType(t: string): t is (typeof ALLOWED_IMAGE_TYPES)[number] {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(t);
}

async function callGeminiWithImage(prompt: string, system: string, image: AiImage, lang: LangCode, meter?: { ownerId: string; feature: string }): Promise<AiResult> {
  const r = await geminiGenerate({
    primaryModel: geminiModel(),
    key: process.env.GEMINI_API_KEY ?? "",
    body: {
      contents: [{ role: "user", parts: [{ text: `${prompt}\n\n${languageReminder(lang)}` }, { inline_data: { mime_type: image.mimeType, data: image.data } }] }],
      systemInstruction: { parts: [{ text: composeSystemInstruction(system, lang) }] },
    },
    timeoutMs: 55_000,
    label: "vision",
    meter,
  });
  if (!r.ok) return { ok: false, detail: r.status ? `HTTP ${r.status} — ${r.detail}` : r.detail };
  const text: string = r.data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  return { ok: true, text: normalizeMathText(text) };
}

export async function analyzeImage(args: {
  question: string;
  image: AiImage;
  system: string;
  /** Langue sélectionnée dans l'application : la réponse est TOUJOURS dans cette langue, quelle que soit la langue de l'image. */
  lang: LangCode;
  /** Enregistrement de la consommation (ai_cost_log). */
  meter?: { ownerId: string; feature: string };
}): Promise<AiResult & { engineUsed: "gemini" | "gemini2" }> {
  const domain = detectDomain({ mode: "chat", message: args.question });
  if (domain === "practice" && hasGemini2Key()) {
    const r = await callGemini2(args.question, args.system, [], { lang: args.lang, temperature: 0.4, images: [args.image], meter: args.meter });
    if (r.ok) return { ...r, engineUsed: "gemini2" };
    console.error("[vision] Gemini n°2 en échec, repli sur Gemini n°1.");
  }
  const g = await callGeminiWithImage(args.question, args.system, args.image, args.lang, args.meter);
  return { ...g, engineUsed: "gemini" };
}
