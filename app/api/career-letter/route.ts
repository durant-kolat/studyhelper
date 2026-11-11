import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { careerLetterPayloadSchema, parseOrError } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!hasGeminiKey()) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY n'est pas configurée sur le serveur." },
      { status: 500 }
    );
  }

  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }
  // Langue de sortie de l'IA = preferredLanguage de l'utilisateur (jamais choisie par le modèle).
  const lang = await resolveLanguage(req, ownerId);

  const body = await req.json();
  const parsed = parseOrError(careerLetterPayloadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { fullName, targetRole, company, strengths } = parsed.data;

  const usage = await checkAndLogUsage(ownerId, "career-letter");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne de lettres atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite de lettres atteinte (${usage.limit}/jour). Passe à Premium pour en générer davantage.`,
        quotaExceeded: true,
      },
      { status: 429 }
    );
  }

  const prompt = `Rédige une lettre de motivation, rédigée dans la langue cible (TARGET LANGUAGE), pour la candidature suivante.

Nom : ${fullName}
Poste visé : ${targetRole}
Entreprise : ${company || "non précisée"}
Points forts à mettre en avant : ${strengths || "non précisés"}

Ton : professionnel, sincère, pas de formules toutes faites vides de sens. 3 à 4 paragraphes maximum : accroche, pourquoi ce poste/cette entreprise, ce que le candidat apporte, formule de politesse finale. Ne mentionne que les informations données — n'invente rien.`;

  const result = await callGemini(prompt, undefined, false, [], { lang, meter: { ownerId, feature: "career-letter" } });

  if (!result.ok) {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "Échec de l'appel à l'API IA", detail: result.detail },
      { status: 502 }
    );
  }

  return NextResponse.json({ letter: result.text });
}
