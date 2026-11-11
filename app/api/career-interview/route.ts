import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { careerInterviewPayloadSchema, parseOrError } from "@/lib/validate";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `Tu es un recruteur qui fait passer un entretien d'embauche simulé (dans la langue cible indiquée).
Règles :
- Pose une question à la fois, jamais plusieurs d'un coup.
- Adapte tes questions au poste visé indiqué.
- Après chaque réponse du candidat, donne un retour bref (1-2 phrases : point fort + point à améliorer) avant de poser la question suivante.
- Reste bienveillant mais exigeant, comme un vrai entretien.`;

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
  const parsed = parseOrError(careerInterviewPayloadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { targetRole, message, history } = parsed.data;

  const usage = await checkAndLogUsage(ownerId, "career-interview");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne d'entretiens atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite d'entretiens atteinte (${usage.limit}/jour). Passe à Premium pour en faire davantage.`,
        quotaExceeded: true,
      },
      { status: 429 }
    );
  }

  const historyText = (history ?? [])
    .slice(-10)
    .map((m) => `${m.role === "user" ? "Candidat" : "Recruteur"} : ${m.content}`)
    .join("\n");

  const prompt = `${historyText ? historyText + "\n" : ""}Candidat : ${message}\nRecruteur :`;

  const result = await callGemini(
    prompt,
    `${SYSTEM_PROMPT}\n\nPoste visé par le candidat : ${targetRole}`,
    false,
    [],
    { lang, meter: { ownerId, feature: "career-interview" } }
  );

  if (!result.ok) {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "Échec de l'appel à l'API IA", detail: result.detail },
      { status: 502 }
    );
  }

  return NextResponse.json({
    reply: result.text || "Désolé, je n'ai pas pu générer de réponse.",
  });
}
