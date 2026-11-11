import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { generateExamPayloadSchema, examQuestionsSchema, parseOrError } from "@/lib/validate";
import { z } from "zod";
import { cleanQuestion } from "@/lib/math-clean";
import { sanitizeLabel } from "@/lib/assistant-prompt";
import { wrapUntrustedData } from "@/lib/study-helper-rules";
import { DIFFICULTY_LABELS } from "@/lib/adaptive";
import { COURSE_EXAM_RULES, courseMaterial } from "@/lib/exam-source";
import { GENERATION_OPEN_RULES, parseOpenQuestions, toClientOpenQuestions } from "@/lib/exam-open";
import { batchHint, isAcceptable, mergeBatches, planBatches } from "@/lib/question-batches";

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
  const parsed = parseOrError(generateExamPayloadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { subject: requestedSubject, chapter, level, difficulty, questionCount, durationMinutes, courseId, openCount: requestedOpen } =
    parsed.data;
  const openCount = requestedOpen ?? 2; // Partie B par défaut : 2 questions rédigées / à schéma
  let subject = requestedSubject;
  const count = questionCount ?? 8;
  const duration = durationMinutes ?? 30;

  // Examen fondé sur UN cours : relu en base (filtre owner_id), AVANT tout débit — un cours illisible ne coûte rien.
  let material: ReturnType<typeof courseMaterial> | null = null;
  let courseTitle = "";
  if (courseId) {
    const { data: course } = await supabaseAdmin
      .from("courses")
      .select("title, subject, content_text, key_notions")
      .eq("id", courseId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (!course) return NextResponse.json({ error: "Cours introuvable." }, { status: 404 });
    material = courseMaterial(course);
    if (!material.usable) {
      return NextResponse.json(
        { error: "L'IA n'a pas pu lire assez de texte dans ce cours (photo floue, document vide ou scanné). Réimporte un fichier plus lisible ou filme les pages de plus près." },
        { status: 422 },
      );
    }
    courseTitle = sanitizeLabel(course.title ?? "", 120);
    subject = course.subject || requestedSubject;
  }

  const usage = await checkAndLogUsage(ownerId, "generate-exam");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne d'examens atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite d'examens atteinte (${usage.limit}/jour). Passe à Premium pour en générer davantage.`,
        quotaExceeded: true,
      },
      { status: 429 }
    );
  }

  const { data: courses } = material
    ? { data: null }
    : await supabaseAdmin
        .from("courses")
        .select("title, key_notions")
        .eq("owner_id", ownerId)
        .eq("subject", subject)
        .eq("status", "done");

  const notions = (courses ?? []).flatMap((c) => c.key_notions ?? []);

  // Les champs libres (matière, chapitre) sont nettoyés avant d'entrer
  // dans la consigne : ce sont des données, jamais des instructions.
  const safeSubject = sanitizeLabel(subject, 100);
  const safeChapter = sanitizeLabel(chapter, 120);
  const levelLabels: Record<string, string> = {
    primaire: "primaire",
    college: "collège",
    lycee: "lycée",
    universite: "université",
    formation_pro: "formation professionnelle",
  };
  const levelText = level ? ` de niveau ${levelLabels[level]}` : "";
  const chapterText = safeChapter ? ` (chapitre / thème : « ${safeChapter} »)` : "";
  const difficultyText = difficulty
    ? `Difficulté : ${DIFFICULTY_LABELS[difficulty].toLowerCase()}, sur toute l'épreuve.`
    : "Difficulté progressive, des plus simples aux plus difficiles.";

  const basePrompt = material
    ? `Voici, dans un bloc de données, le cours « ${courseTitle || safeSubject} » (${safeSubject}) fourni par l'élève :\n${wrapUntrustedData({
        title: `Cours : ${courseTitle || safeSubject}`,
        content: material.text,
      })}\n\nGénère un examen${levelText} basé sur ce cours${chapterText}. ${COURSE_EXAM_RULES}${material.truncated ? " Seul le début du cours (environ 14 000 caractères) est fourni : ne prétends pas couvrir la suite." : ""}`
    : notions.length > 0
      ? `Voici, dans un bloc de données, les notions clés issues des cours de ${safeSubject} de cet élève :\n${wrapUntrustedData({
          title: `Notions clés des cours de ${safeSubject}`,
          content: notions.map((n) => `- ${n}`).join("\n"),
        })}\n\nGénère un examen${levelText} de ${safeSubject}${chapterText} basé sur ces notions.`
      : `Génère un examen${levelText || " de niveau lycée/université"} sur la matière : ${safeSubject}${chapterText}.`;

  // Grand examen (jusqu'à 50 QCM) : plusieurs lots indépendants en parallèle, ≤ 20 questions chacun (voir lib/question-batches.ts).
  const sizes = planBatches(count);
  const buildPrompt = (n: number, k: number) => `${basePrompt}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format exact :
{
  "questions": [
    {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctIndex": 0,
      "method": "explication de la méthode pour répondre à ce type de question"
    }
  ]${k === 0 && openCount > 0 ? ',\n  "openQuestions": [ ... ]' : ""}
}
Génère exactement ${n} questions à choix multiple (4 options chacune). ${difficultyText} Répartis les bonnes réponses sur les 4 positions (pas toujours la même). Écris toutes les formules en texte simple, SANS LaTeX ni symbole $ : √4, 3√2 + 4√2, √(x+1), x², a/b.${batchHint(k, sizes.length, n)}${k === 0 && openCount > 0 ? ` ${GENERATION_OPEN_RULES(openCount)}` : ""}`;

  const runBatch = async (n: number, k: number) => {
    const r = await callGemini(buildPrompt(n, k), undefined, true, [], { lang, meter: { ownerId, feature: "generate-exam" } });
    if (!r.ok) return null;
    try {
      const parsed = JSON.parse(r.text.replace(/```json|```/g, "").trim());
      const validated = examQuestionsSchema.safeParse(parsed.questions);
      if (!validated.success) return null;
      return { questions: validated.data.map(cleanQuestion), open: k === 0 && openCount > 0 ? parseOpenQuestions(parsed.openQuestions, openCount) : [] };
    } catch {
      return null;
    }
  };
  const batches = await Promise.all(sizes.map((n, k) => runBatch(n, k)));

  const fullQuestions = mergeBatches(batches.map((b) => b?.questions ?? null), count);
  const openQuestions = batches[0]?.open ?? [];
  if (!isAcceptable(count, fullQuestions.length, sizes.length)) {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "L'IA n'a pas réussi à générer assez de questions. Réessaie (cette tentative n'est pas comptée) ou choisis moins de questions." },
      { status: 502 },
    );
  }

  // Les bonnes réponses restent en base, côté serveur — jamais envoyées
  // au client avant la correction (voir /api/exams/submit).
  const { data: generated, error: insertError } = await supabaseAdmin
    .from("generated_exams")
    .insert({
      owner_id: ownerId,
      kind: "exam",
      subject,
      questions: fullQuestions,
      // Partie B : barème et corrigé de référence restent côté serveur jusqu'à la soumission.
      ...(openQuestions.length > 0 ? { open_questions: openQuestions } : {}),
    })
    .select("id")
    .single();

  if (insertError || !generated) {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: insertError?.message ?? "Échec de la génération." },
      { status: 500 }
    );
  }

  const questionsForClient = fullQuestions.map((q) => ({
    question: q.question,
    options: q.options,
  }));

  return NextResponse.json({
    examId: generated.id,
    subject,
    durationMinutes: duration,
    questions: questionsForClient,
    requestedQuestions: count,
    // Partie B : énoncé, type et nombre de points seulement (ni corrigé ni barème détaillé).
    openQuestions: toClientOpenQuestions(openQuestions),
  });
}
