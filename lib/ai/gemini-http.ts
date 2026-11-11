// Appel HTTP FIABLE vers l'API Gemini (generateContent). SERVEUR UNIQUEMENT.
// Utilisé par callGemini (n°1), callGemini2 (n°2), la transcription et l'analyse d'images.
//
// Pourquoi : un seul échec passager de Google (429 quota/rafale, 503 surcharge, timeout) faisait
// afficher « L'assistant IA est momentanément indisponible ». Désormais :
//   1. nouvelle tentative automatique (1 fois) sur 429 / 5xx / erreur réseau ;
//   2. puis bascule sur un modèle de secours (GEMINI_FALLBACK_MODELS) si le modèle principal échoue ;
//   3. les paramètres d'échantillonnage dépréciés (temperature, top_p, top_k) ne sont JAMAIS envoyés
//      (Gemini 3.5 Flash-Lite les ignore, et les prochaines générations renvoient une erreur 400).
// Le budget de temps total reste celui demandé par l'appelant (timeoutMs) : la fonction serverless
// (maxDuration = 60 s) n'est jamais dépassée à cause des tentatives.

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Modèle principal puis modèles de secours (réglables sans redéploiement via GEMINI_FALLBACK_MODELS, séparés par des virgules). */
export function modelChain(primary: string): string[] {
  const raw = process.env.GEMINI_FALLBACK_MODELS;
  const fallbacks =
    raw === undefined ? ["gemini-3.6-flash", "gemini-2.5-flash"] : raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

export type GeminiHttpResult =
  | { ok: true; data: any; model: string }
  | { ok: false; status: number; detail: string };

function extractText(data: any): string {
  return (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
}

async function geminiGenerateInner(args: {
  primaryModel: string;
  key: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  /** Préfixe des logs serveur : "gemini", "gemini2", "vision"… */
  label: string;
  /** true (défaut) : une réponse sans texte est un échec → on tente le modèle suivant. */
  requireText?: boolean;
  /** Si fourni : la consommation (tokens, modèle, statut) est enregistrée dans ai_cost_log. */
  meter?: { ownerId: string; feature: string };
}): Promise<GeminiHttpResult> {
  const key = args.key.trim();
  if (!key) return { ok: false, status: 0, detail: "GEMINI_API_KEY absente côté serveur." };

  // Ne jamais envoyer les paramètres dépréciés.
  const body = { ...args.body };
  if (body.generationConfig && typeof body.generationConfig === "object") {
    const { temperature: _t, topP: _p, topK: _k, top_p: _p2, top_k: _k2, ...rest } = body.generationConfig as Record<string, unknown>;
    if (Object.keys(rest).length > 0) body.generationConfig = rest;
    else delete body.generationConfig;
  }

  const requireText = args.requireText !== false;
  const models = modelChain(args.primaryModel);
  const deadline = Date.now() + args.timeoutMs;
  let last: { status: number; detail: string } = { status: 0, detail: "Aucune tentative effectuée." };

  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    const isLastModel = m === models.length - 1;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 2_000) return { ok: false, ...last };
      // Le 1er essai ne monopolise pas tout le budget s'il existe un modèle de secours.
      const perTry = attempt === 0 && !isLastModel ? Math.max(8_000, Math.floor(args.timeoutMs * 0.6)) : remaining;

      let retry = false;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(perTry, remaining)),
        });
        if (res.ok) {
          const data = await res.json();
          if (!requireText || extractText(data).trim()) {
            if (m > 0) console.warn(`[${args.label}] réponse obtenue avec le modèle de secours "${model}".`);
            return { ok: true, data, model };
          }
          const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? "inconnue";
          last = { status: 200, detail: `Réponse vide (raison : ${reason})` };
          console.error(`[${args.label}] réponse vide avec le modèle "${model}" (raison : ${reason}).`);
          break; // modèle suivant
        }
        const text = await res.text().catch(() => "");
        last = { status: res.status, detail: text.slice(0, 500) };
        console.error(`[${args.label}] échec HTTP ${res.status} avec le modèle "${model}" :`, text.slice(0, 1000));
        if (res.status === 401 || res.status === 403) return { ok: false, ...last }; // clé refusée : inutile d'insister
        retry = RETRYABLE.has(res.status);
      } catch (err) {
        const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
        last = { status: 0, detail: aborted ? "Délai dépassé en attendant l'API IA." : `Erreur réseau : ${err instanceof Error ? err.message : String(err)}` };
        console.error(`[${args.label}] ${last.detail} (modèle "${model}")`);
        retry = !aborted; // un timeout ne se réessaie pas sur le même modèle
      }
      if (retry && attempt === 0) {
        await sleep(700);
        continue; // 2e essai, même modèle
      }
      break; // modèle suivant
    }
  }
  return { ok: false, ...last };
}

function usageOf(data: any) {
  const um = data?.usageMetadata;
  if (!um) return undefined;
  const promptTokens = Number(um.promptTokenCount) || 0;
  const outputTokens = Number(um.candidatesTokenCount) || 0;
  return { promptTokens, outputTokens, totalTokens: Number(um.totalTokenCount) || promptTokens + outputTokens };
}

/**
 * Point d'entrée UNIQUE de tous les appels Gemini. Avec `meter`, la consommation réelle est enregistrée ici, une seule fois
 * par appel (y compris les appels échoués, pour mesurer le gaspillage) : plus aucune fonction IA n'échappe au suivi des coûts.
 * L'enregistrement ne bloque ni ne fait jamais échouer la réponse à l'élève.
 */
export async function geminiGenerate(args: Parameters<typeof geminiGenerateInner>[0]): Promise<GeminiHttpResult> {
  const result = await geminiGenerateInner(args);
  if (args.meter) {
    try {
      const { recordAiCost } = await import("../ai-cost"); // import dynamique : évite toute dépendance circulaire
      await recordAiCost(args.meter.ownerId, args.meter.feature, result.ok ? usageOf(result.data) : undefined, result.ok ? "ok" : "error", result.ok ? result.model : undefined);
    } catch (err) {
      console.error("[ai-cost] enregistrement impossible :", err instanceof Error ? err.message : err);
    }
  }
  return result;
}
