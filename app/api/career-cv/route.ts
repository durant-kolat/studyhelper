import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { careerCvPayloadSchema, cvDataSchema, parseOrError } from "@/lib/validate";

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
  const parsed = parseOrError(careerCvPayloadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { fullName, targetRole, email, phone, location, education, experience, skills } =
    parsed.data;

  const usage = await checkAndLogUsage(ownerId, "career-cv");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne de CV atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite de CV atteinte (${usage.limit}/jour). Passe à Premium pour en générer davantage.`,
        quotaExceeded: true,
      },
      { status: 429 }
    );
  }

  const prompt = `Rédige le contenu d'un CV professionnel, rédigé dans la langue cible (TARGET LANGUAGE), pour la candidature suivante.

Nom complet : ${fullName}
Poste visé : ${targetRole}
Formation : ${education || "non précisée"}
Expérience : ${experience || "non précisée"}
Compétences : ${skills || "non précisées"}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format exact :
{
  "fullName": "${fullName}",
  "targetRole": "${targetRole}",
  "tagline": "accroche courte de 1-2 phrases adaptée au poste visé",
  "education": [{"period": "ex: 2021-2023", "title": "intitulé", "detail": "précision courte ou vide"}],
  "experience": [{"period": "ex: 2023-2024", "title": "intitulé", "detail": "précision courte ou vide"}],
  "skills": ["compétence 1", "compétence 2"]
}
Découpe la formation/expérience données en entrées séparées (une par ligne/étape mentionnée). Si une section n'a pas d'information, renvoie un tableau vide. Ne mentionne que les informations données — n'invente rien.`;

  const result = await callGemini(prompt, undefined, true, [], { lang, meter: { ownerId, feature: "career-cv" } });

  if (!result.ok) {
    console.error("[career-cv] échec Gemini :", result.detail);
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "Échec de l'appel à l'API IA", detail: result.detail },
      { status: 502 }
    );
  }

  try {
    const parsed = JSON.parse(result.text);
    // email/téléphone/ville : données factuelles fournies par l'utilisateur,
    // jamais générées par l'IA — ajoutées après coup, telles quelles.
    const validated = cvDataSchema.safeParse({ ...parsed, email, phone, location });
    if (!validated.success) {
      console.error("[career-cv] JSON mal formé :", validated.error.message);
      await releaseUsage(ownerId, usage.usageId);
      return NextResponse.json(
        { error: "Réponse IA mal formée, réessaie." },
        { status: 502 }
      );
    }
    return NextResponse.json({ cv: validated.data });
  } catch (err) {
    console.error(
      "[career-cv] réponse illisible :",
      err instanceof Error ? err.message : err
    );
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "Réponse IA illisible, réessaie." },
      { status: 502 }
    );
  }
}
