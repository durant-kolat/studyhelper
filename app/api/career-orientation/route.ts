import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { careerOrientationPayloadSchema, orientationPathsSchema, parseOrError } from "@/lib/validate";

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
  const parsed = parseOrError(careerOrientationPayloadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { favoriteSubjects, interests, skills, constraints } = parsed.data;

  const usage = await checkAndLogUsage(ownerId, "career-orientation");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne d'orientations atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite d'orientations atteinte (${usage.limit}/jour). Passe à Premium pour en refaire.`,
        quotaExceeded: true,
      },
      { status: 429 }
    );
  }

  const prompt = `Un élève/étudiant cherche une orientation professionnelle. Voici ce qu'il donne :
- Matières préférées : ${favoriteSubjects}
- Centres d'intérêt : ${interests || "non précisés"}
- Compétences : ${skills || "non précisées"}
- Contraintes (budget, lieu, durée d'études...) : ${constraints || "non précisées"}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format exact :
{
  "paths": [
    {
      "title": "nom du métier ou de la filière",
      "why": "pourquoi ça correspond à ce profil, 1-2 phrases",
      "next_steps": "concrètement, quoi étudier ou faire ensuite"
    }
  ]
}
Propose entre 3 et 5 pistes réalistes et variées, adaptées au contexte camerounais/africain quand c'est pertinent (filières, débouchés locaux).`;

  const result = await callGemini(prompt, undefined, true, [], { lang, meter: { ownerId, feature: "career-orientation" } });

  if (!result.ok) {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "Échec de l'appel à l'API IA", detail: result.detail },
      { status: 502 }
    );
  }

  try {
    const parsed = JSON.parse(result.text);
    const validated = orientationPathsSchema.safeParse(parsed);
    if (!validated.success) {
      await releaseUsage(ownerId, usage.usageId);
      return NextResponse.json(
        { error: "Réponse IA mal formée, réessaie." },
        { status: 502 }
      );
    }
    return NextResponse.json(validated.data);
  } catch {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "Réponse IA illisible, réessaie." },
      { status: 502 }
    );
  }
}
