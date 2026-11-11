import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { resolveLanguage } from "@/lib/ai/language";
import { VISUAL_SYSTEM_PROMPT, sanitizeSvg } from "@/lib/ai/visual";

export const runtime = "nodejs";
export const maxDuration = 60;

const payload = z.object({
  topic: z.string().trim().min(2).max(500),
  /** Réponse de l'assistant à illustrer (contexte), facultative. */
  context: z.string().max(3000).optional(),
  language: z.string().max(10).optional(),
});

/**
 * Explication visuelle : renvoie un schéma SVG annoté (flèches, numéros, légendes) dans la langue
 * de l'utilisateur. Le moteur est Gemini (fonction d'explication) ; le SVG est vérifié côté serveur
 * (voir lib/ai/visual.ts) et affiché côté navigateur via <img>, jamais injecté dans la page.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!hasGeminiKey()) return NextResponse.json({ error: "Service IA non configuré.", code: "not_configured" }, { status: 500 });

  // Anti-rafale (en plus du quota quotidien).
  const burst = hitRateLimit(`visual:${ownerId}`, 6, 60_000);
  if (!burst.ok) {
    return NextResponse.json({ error: "Trop de demandes. Patiente un instant.", code: "too_many_requests" }, { status: 429, headers: { "Retry-After": String(burst.retryAfterSec) } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide.", code: "invalid_request" }, { status: 400 });

  const usage = await checkAndLogUsage(ownerId, "visual");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (usage.status === "quota") {
    return NextResponse.json({ error: "Limite quotidienne de schémas atteinte.", code: "quota_exceeded", quotaExceeded: true }, { status: 429 });
  }

  try {
    const lang = await resolveLanguage(req, ownerId, parsed.data.language);

    // Le sujet et le contexte sont des DONNÉES : ils restent dans le message utilisateur, jamais dans l'instruction système.
    const prompt =
      `Sujet à illustrer : ${parsed.data.topic}` +
      (parsed.data.context ? `\n\nExplication déjà donnée à l'utilisateur (à illustrer fidèlement) :\n${parsed.data.context}` : "");

    const result = await callGemini(prompt, VISUAL_SYSTEM_PROMPT, false, [], { lang, temperature: 0.4, meter: { ownerId, feature: "visual" } });
    if (!result.ok) {
      console.error("[visual] échec Gemini :", result.detail);
      await releaseUsage(ownerId, usage.usageId);
      return NextResponse.json({ error: "Le schéma n'a pas pu être créé. Réessaie.", code: "ai_unavailable" }, { status: 502 });
    }

    const check = sanitizeSvg(result.text);
    if (!check.ok) {
      console.error("[visual] SVG refusé :", check.reason);
      await releaseUsage(ownerId, usage.usageId);
      return NextResponse.json({ error: "Le schéma n'a pas pu être créé. Réessaie.", code: "invalid_visual" }, { status: 502 });
    }
    return NextResponse.json({ svg: check.svg });
  } catch (err) {
    console.error("[visual] erreur inattendue :", err instanceof Error ? err.message : err);
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json({ error: "Une erreur est survenue.", code: "server_error" }, { status: 500 });
  }
}
