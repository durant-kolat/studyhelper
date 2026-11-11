import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { submitAnswersPayloadSchema, parseOrError } from "@/lib/validate";

export const runtime = "nodejs";

type FullQuizQuestion = {
  subject: string;
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
  const { examId, answers } = parsed.data;

  // Réclamation atomique — même principe que pour l'examen classique :
  // le marquage used=true se fait dans la même requête que la
  // condition "pas encore utilisé", donc une seule requête concurrente
  // peut réussir.
  const { data: generated, error: claimError } = await supabaseAdmin
    .from("generated_exams")
    .update({ used: true })
    .eq("id", examId)
    .eq("owner_id", ownerId)
    .eq("kind", "quiz")
    .eq("used", false)
    .select("id, owner_id, questions, weak_subjects")
    .single();

  if (claimError || !generated) {
    return NextResponse.json(
      { error: "Quiz introuvable, déjà soumis, ou accès refusé." },
      { status: 409 }
    );
  }

  const questions = generated.questions as FullQuizQuestion[];
  const safeAnswers = questions.map((_, i) =>
    Number.isInteger(answers[i]) ? answers[i] : -1
  );

  // Regroupe par matière et enregistre un résultat par matière — comme
  // un examen classique, pour alimenter la même progression.
  const bySubject = new Map<string, { qs: FullQuizQuestion[]; idx: number[] }>();
  questions.forEach((q, i) => {
    const entry = bySubject.get(q.subject) ?? { qs: [], idx: [] };
    entry.qs.push(q);
    entry.idx.push(i);
    bySubject.set(q.subject, entry);
  });

  const scoreSummary: { subject: string; correct: number; total: number }[] = [];
  const insertErrors: string[] = [];

  for (const [subject, { qs, idx }] of bySubject) {
    const subjectAnswers = idx.map((i) => safeAnswers[i]);
    const correct = qs.filter((q, j) => subjectAnswers[j] === q.correctIndex).length;
    const scorePercent = Math.round((correct / qs.length) * 100);

    const { error: insertError } = await supabaseAdmin.from("exam_results").insert({
      owner_id: ownerId,
      exam_id: generated.id,
      subject,
      kind: "quiz",
      score: correct,
      total: qs.length,
      score_percent: scorePercent,
      questions: qs,
      answers: subjectAnswers,
    });

    if (insertError) {
      insertErrors.push(`${subject}: ${insertError.message}`);
      continue;
    }
    scoreSummary.push({ subject, correct, total: qs.length });
  }

  if (scoreSummary.length === 0) {
    // Aucune matière n'a pu être enregistrée — on libère le quiz pour
    // permettre une nouvelle tentative plutôt que de le laisser
    // consommé sans aucun résultat.
    await supabaseAdmin
      .from("generated_exams")
      .update({ used: false })
      .eq("id", examId);
    return NextResponse.json(
      { error: `Échec de l'enregistrement : ${insertErrors.join("; ")}` },
      { status: 500 }
    );
  }

  const totalCorrect = scoreSummary.reduce((a, s) => a + s.correct, 0);
  const totalQuestions = scoreSummary.reduce((a, s) => a + s.total, 0);
  const globalPercent = Math.round((totalCorrect / totalQuestions) * 100);

  return NextResponse.json({
    globalPercent,
    totalCorrect,
    totalQuestions,
    bySubject: scoreSummary,
    weakSubjects: generated.weak_subjects ?? [],
    // Si une matière a échoué à s'enregistrer, on le signale quand même
    // dans la réponse (le quiz reste globalement un succès partiel).
    partialErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });
}
