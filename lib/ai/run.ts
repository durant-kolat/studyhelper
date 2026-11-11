// Exécution d'une demande IA selon la décision du routeur. SERVEUR UNIQUEMENT.
//   gemini  → Gemini n°1 (callGemini, inchangé) ;
//   gemini2 → Gemini n°2 (callGemini2, Gemini 3.5 Flash-Lite ; repli sur Gemini n°1 s'il échoue) ;
//   both    → Gemini n°1 explique, puis Gemini n°2 complète avec la pratique.

import { callGemini } from "../gemini";
import { callGemini2, hasGemini2Key, type AiResult } from "./gemini2";
import type { AiEngine } from "./router";
import type { LangCode } from "../i18n/languages";

export type RunArgs = {
  engine: AiEngine;
  prompt: string;
  systemInstruction: string;
  history: { role: "user" | "assistant"; content: string }[];
  /** Langue sélectionnée dans l'application : transmise explicitement à Gemini n°1 ET à Gemini n°2 à chaque appel. */
  lang: LangCode;
  temperature?: number;
  /** Enregistrement de la consommation (ai_cost_log), un enregistrement par appel Gemini. */
  meter?: { ownerId: string; feature: string };
};

export type RunResult = (AiResult & { engineUsed: "gemini" | "gemini2" | "both" }) ;

export async function runAi(a: RunArgs): Promise<RunResult> {
  const opts = { lang: a.lang, temperature: a.temperature, meter: a.meter };

  if (a.engine === "gemini2" && hasGemini2Key()) {
    const r = await callGemini2(a.prompt, a.systemInstruction, a.history, opts);
    if (r.ok) return { ...r, engineUsed: "gemini2" };
    // Repli : la pratique ne doit pas devenir indisponible parce qu'un moteur est en panne.
    console.error("[ai] Gemini n°2 en échec, repli sur Gemini n°1 :", r.detail);
    const g = await callGemini(a.prompt, a.systemInstruction, false, a.history, opts);
    return { ...g, engineUsed: "gemini" };
  }

  if (a.engine === "both" && hasGemini2Key()) {
    const g = await callGemini(a.prompt, a.systemInstruction, false, a.history, opts);
    if (!g.ok) return { ...g, engineUsed: "gemini" };
    const followUp =
      "Voici l'explication déjà donnée à l'utilisateur :\n\n" +
      g.text.slice(0, 6000) +
      "\n\nMaintenant, propose UNIQUEMENT la partie PRATIQUE : un exercice adapté (sans la correction) qui fait travailler cette notion, puis invite l'utilisateur à répondre. N'explique pas à nouveau la notion.";
    const o = await callGemini2(followUp, a.systemInstruction, [], opts);
    if (!o.ok) {
      console.error("[ai] Gemini n°2 (partie pratique) en échec :", o.detail);
      return { ...g, engineUsed: "gemini" };
    }
    return { ok: true, text: `${g.text.trim()}\n\n---\n\n${o.text.trim()}`, engineUsed: "both" };
  }

  const g = await callGemini(a.prompt, a.systemInstruction, false, a.history, opts);
  return { ...g, engineUsed: "gemini" };
}
