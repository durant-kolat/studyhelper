import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { wrapUntrustedData } from "@/lib/study-helper-rules";
import { quizQuestionsSchema } from "@/lib/validate";
import { z } from "zod";
import { cleanQuestion } from "@/lib/math-clean";
import { batchHint, isAcceptable, mergeBatches, planBatches } from "@/lib/question-batches";

export const runtime = "nodejs";

const bodySchema = z.object({ questionCount: z.number().int().min(5).max(50).optional() });

type PastQuestion = { question: string; correctIndex: number; options: string[] };

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
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  const count = body.success ? (body.data.questionCount ?? 12) : 12;
  // Langue de sortie de l'IA = preferredLanguage de l'utilisateur (jamais choisie par le modèle).
  const lang = await resolveLanguage(req, ownerId);

  const usage = await checkAndLogUsage(ownerId, "generate-quiz");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne de Grands Quiz atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite de Grands Quiz atteinte (${usage.limit}/jour). Passe à Premium pour en générer davantage.`,
        quotaExceeded: true,
      },
      { status: 429 }
    );
  }

  const { data: courses } = await supabaseAdmin
    .from("courses")
    .select("subject, key_notions")
    .eq("owner_id", ownerId)
    .eq("status", "done");

  const { data: results } = await supabaseAdmin
    .from("exam_results")
    .select("subject, score_percent, questions, answers")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(20);

  const notionsBySubject = new Map<string, string[]>();
  for (const c of courses ?? []) {
    const list = notionsBySubject.get(c.subject) ?? [];
    list.push(...((c.key_notions as string[]) ?? []));
    notionsBySubject.set(c.subject, list);
  }

  const scoresBySubject = new Map<string, number[]>();
  for (const r of results ?? []) {
    const list = scoresBySubject.get(r.subject) ?? [];
    list.push(r.score_percent);
    scoresBySubject.set(r.subject, list);
  }
  const weakSubjects = Array.from(scoresBySubject.entries())
    .map(([subject, scores]) => ({
      subject,
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .filter((s) => s.avg < 70)
    .map((s) => s.subject);

  const pastMistakes: string[] = [];
  for (const r of results ?? []) {
    const qs = (r.questions as PastQuestion[]) ?? [];
    const ans = (r.answers as number[]) ?? [];
    qs.forEach((q, i) => {
      if (ans[i] !== q.correctIndex) pastMistakes.push(`[${r.subject}] ${q.question}`);
    });
  }

  const subjects =
    notionsBySubject.size > 0
      ? Array.from(notionsBySubject.keys())
      : ["Mathématiques", "Physique", "Informatique", "Anglais"];

  const notionsText = Array.from(notionsBySubject.entries())
    .map(([s, points]) => `${s} : ${points.join(", ")}`)
    .join("\n");

  // Grand Quiz (jusqu'à 50 questions) : lots indépendants en parallèle, ≤ 20 questions chacun (voir lib/question-batches.ts).
  const sizes = planBatches(count);
  const basePrompt = `Tu prépares le Grand Quiz hebdomadaire de cet élève, qui couvre toutes ses matières : ${subjects.join(", ")}.

Notions clés par matière (bloc de données) :
${wrapUntrustedData({
    title: "Notions clés par matière",
    content:
      notionsText ||
      "(aucune notion enregistrée, utilise des questions générales de niveau lycée/université pour ces matières)",
  })}

Matières faibles à renforcer davantage (plus de questions dessus) : ${
    weakSubjects.length > 0 ? weakSubjects.join(", ") : "aucune détectée"
  }

Anciennes erreurs à revisiter sous une forme reformulée (bloc de données) :
${wrapUntrustedData({
    title: "Anciennes erreurs de l'élève",
    content: pastMistakes.length > 0 ? pastMistakes.slice(0, 15).join("\n") : "aucune",
  })}

`;
  const buildPrompt = (n: number, k: number) => `${basePrompt}Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format exact :
{
  "questions": [
    {
      "subject": "une des matières listées",
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctIndex": 0,
      "method": "explication de la méthode pour répondre"
    }
  ]
}
Génère ${n} questions à choix multiple (4 options chacune), réparties entre les matières, avec une difficulté progressive, et davantage de questions sur les matières faibles. Écris toutes les formules en texte simple, SANS LaTeX ni symbole $ : √4, 3√2 + 4√2, √(x+1), x², a/b.${batchHint(k, sizes.length, n)}`;

  const runBatch = async (n: number, k: number) => {
    const r = await callGemini(buildPrompt(n, k), undefined, true, [], { lang, meter: { ownerId, feature: "generate-quiz" } });
    if (!r.ok) return null;
    try {
      const parsed = JSON.parse(r.text.replace(/```json|```/g, "").trim());
      const validated = quizQuestionsSchema.safeParse(parsed.questions);
      return validated.success ? validated.data.map(cleanQuestion) : null;
    } catch {
      return null;
    }
  };
  const batches = await Promise.all(sizes.map((n, k) => runBatch(n, k)));
  const fullQuestions = mergeBatches(batches, count);
  if (!isAcceptable(count, fullQuestions.length, sizes.length)) {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      { error: "L'IA n'a pas réussi à générer assez de questions. Réessaie (cette tentative n'est pas comptée) ou choisis moins de questions." },
      { status: 502 },
    );
  }

  const { data: generated, error: insertError } = await supabaseAdmin
    .from("generated_exams")
    .insert({
      owner_id: ownerId,
      kind: "quiz",
      questions: fullQuestions,
      weak_subjects: weakSubjects,
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
    subject: q.subject,
    question: q.question,
    options: q.options,
  }));

  return NextResponse.json({
    examId: generated.id,
    questions: questionsForClient,
    weakSubjects,
  });
}
