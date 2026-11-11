import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { submitAnswersPayloadSchema, parseOrError } from "@/lib/validate";
import { parseOpenQuestions, sanitizeOpenAnswers } from "@/lib/exam-open";

export const runtime = "nodejs";

type FullQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  method: string;
};

export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const body = await req.json();
  const parsed = parseOrError(submitAnswersPayloadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { examId, answers, openAnswers } = parsed.data;

  // Réclamation atomique : on marque used=true dans la MÊME requête que
  // la condition "pas encore utilisé". Si deux requêtes arrivent en
  // même temps pour le même examen, une seule peut réussir cet UPDATE
  // (la ligne est verrouillée le temps de la mise à jour) — l'autre
  // reçoit 0 ligne en retour et est rejetée. Élimine la fenêtre de
  // course d'un ancien lire-puis-écrire en deux étapes séparées.
  const { data: generated, error: claimError } = await supabaseAdmin
    .from("generated_exams")
    .update({ used: true })
    .eq("id", examId)
    .eq("owner_id", ownerId)
    .eq("kind", "exam")
    .eq("used", false)
    .select("id, owner_id, subject, questions, open_questions")
    .single();

  if (claimError || !generated) {
    return NextResponse.json(
      { error: "Examen introuvable, déjà soumis, ou accès refusé." },
      { status: 409 }
    );
  }

  const questions = generated.questions as FullQuestion[];
  const safeAnswers = questions.map((_, i) =>
    Number.isInteger(answers[i]) ? answers[i] : -1
  );

  const correctCount = questions.filter(
    (q, i) => safeAnswers[i] === q.correctIndex
  ).length;
  const scorePercent = Math.round((correctCount / questions.length) * 100);

  // Score calculé ici, côté serveur, à partir des vraies bonnes réponses
  // — le client n'a jamais pu voir correctIndex avant ce moment.
  const { data: result, error: insertError } = await supabaseAdmin
    .from("exam_results")
    .insert({
      owner_id: ownerId,
      exam_id: generated.id,
      subject: generated.subject,
      kind: "exam",
      score: correctCount,
      total: questions.length,
      score_percent: scorePercent,
      questions,
      answers: safeAnswers,
    })
    .select("id")
    .single();

  if (insertError || !result) {
    // On a déjà réclamé l'examen (used=true) — s'il n'a pas pu être
    // enregistré, on le libère pour que l'utilisateur puisse réessayer
    // plutôt que de le laisser bloqué sans résultat.
    await supabaseAdmin
      .from("generated_exams")
      .update({ used: false })
      .eq("id", examId);
    return NextResponse.json(
      { error: insertError?.message ?? "Échec de l'enregistrement." },
      { status: 500 }
    );
  }

  // Partie B : on enregistre les réponses de l'élève (texte / chemins de photos revalidés) avec le barème et le corrigé de référence.
  // La correction par l'IA se fait à part (/api/exams/grade-open) : le résultat QCM s'affiche même si l'IA est indisponible.
  const openQs = parseOpenQuestions(generated.open_questions);
  if (openQs.length > 0) {
    const clean = sanitizeOpenAnswers(openAnswers, openQs.length, ownerId, generated.id);
    const { error: openError } = await supabaseAdmin.from("exam_open_answers").insert(
      openQs.map((q, i) => ({
        result_id: result.id,
        owner_id: ownerId,
        question_index: i,
        kind: q.type,
        question: q.question,
        expected_answer: q.expectedAnswer,
        rubric: q.rubric,
        max_points: q.maxPoints,
        answer_text: clean[i].text || null,
        image_paths: clean[i].imagePaths,
        status: "pending",
      })),
    );
    if (openError) console.error("[exams/submit] Partie B non enregistrée :", openError.message);
  }

  return NextResponse.json({ resultId: result.id, scorePercent, openQuestions: openQs.length });
}
