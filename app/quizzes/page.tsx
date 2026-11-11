"use client";

import QuestionNavigator from "@/components/QuestionNavigator";
import { cleanMath } from "@/lib/math-clean";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import ExamTimer from "@/components/ExamTimer";
import {
  generateWeeklyQuiz,
  submitQuiz,
  QuizQuestion,
  QuizSubjectScore,
} from "@/lib/api";
import { Trophy, Loader2 } from "lucide-react";

type Step = "intro" | "quiz" | "done";

export default function QuizzesPage() {
  const [step, setStep] = useState<Step>("intro");
  const [examId, setExamId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [weakSubjects, setWeakSubjects] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);
  const [quizCount, setQuizCount] = useState(12);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Résultat renvoyé par le serveur après correction — jamais calculé ici.
  const [result, setResult] = useState<{
    globalPercent: number;
    totalCorrect: number;
    totalQuestions: number;
    bySubject: QuizSubjectScore[];
  } | null>(null);

  async function handleStart() {
    setGenerating(true);
    setError(null);
    try {
      const { examId: id, questions: qs, weakSubjects: weak } =
        await generateWeeklyQuiz(quizCount);
      setExamId(id);
      setQuestions(qs);
      setWeakSubjects(weak);
      setAnswers(new Array(qs.length).fill(-1));
      setCurrent(0);
      setStep("quiz");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setGenerating(false);
    }
  }

  function selectAnswer(index: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = index;
      return next;
    });
  }

  async function handleFinish() {
    if (!examId || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Le serveur regroupe par matière, corrige et enregistre les
      // résultats lui-même — le client ne voit jamais correctIndex.
      const data = await submitQuiz(examId, answers);
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la correction.");
    } finally {
      setSaving(false);
    }
  }

  // --- Étape 1 : introduction ---
  if (step === "intro") {
    return (
      <AppShell active="quizzes" title="Grand Quiz de la semaine">
        <div className="rounded-card border border-mist bg-white p-6">
          <div className="flex items-center gap-3">
            <Trophy className="text-gold" size={22} />
            <p className="font-display text-lg text-ink">
              {Math.max(60, Math.ceil(quizCount * 1.5))} minutes · toutes tes matières
            </p>
          </div>
          <p className="mt-2 text-sm text-slate">
            Ce quiz mélange tes cours de la semaine, tes anciennes erreurs et
            tes matières les plus faibles, à difficulté croissante.
          </p>
          <label htmlFor="quiz-count" className="mt-4 mb-1 block text-xs font-medium text-slate">
            Nombre de questions
          </label>
          <select
            id="quiz-count"
            value={quizCount}
            onChange={(e) => setQuizCount(Number(e.target.value))}
            className="w-full max-w-xs rounded-card border border-mist px-3 py-2 text-sm"
          >
            {[10, 12, 20, 30, 40, 50].map((n) => (
              <option key={n} value={n}>
                {n} questions
              </option>
            ))}
          </select>
          {error && <p className="mt-3 text-sm text-clay">{error}</p>}
          <button
            onClick={handleStart}
            disabled={generating}
            className="mt-6 flex items-center gap-2 rounded-card bg-gold px-5 py-2.5 text-sm font-medium text-ink hover:bg-gold/90 disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Préparation du
                quiz…
              </>
            ) : (
              "Démarrer le Grand Quiz"
            )}
          </button>
        </div>
      </AppShell>
    );
  }

  // --- Étape 3 : score global + par matière + recommandations ---
  if (step === "done" && result) {
    return (
      <AppShell active="quizzes" title="Résultat du Grand Quiz">
        <div className="mb-6 flex items-center gap-6 rounded-card border border-mist bg-white p-6">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-forest/10">
            <span className="font-display text-2xl text-forest">
              {result.globalPercent}%
            </span>
          </div>
          <div>
            <p className="font-display text-xl text-ink">
              {result.totalCorrect} / {result.totalQuestions}
            </p>
            <p className="text-sm text-slate">Score global</p>
          </div>
        </div>

        <p className="mb-3 font-display text-base text-ink">Par matière</p>
        <div className="mb-6 space-y-3">
          {result.bySubject.map(({ subject, correct, total }) => {
            const pct = Math.round((correct / total) * 100);
            return (
              <div
                key={subject}
                className="rounded-card border border-mist bg-white p-4"
              >
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-ink">{subject}</span>
                  <span className="text-slate">
                    {correct}/{total} · {pct}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-mist2">
                  <div
                    className={`h-2 rounded-full ${
                      pct >= 80 ? "bg-forest" : pct >= 60 ? "bg-gold" : "bg-clay"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mb-3 font-display text-base text-ink">
          Recommandations
        </p>
        <div className="space-y-2">
          {weakSubjects.length > 0 ? (
            weakSubjects.map((s) => (
              <p
                key={s}
                className="rounded-card bg-mist2 px-4 py-3 text-sm text-ink"
              >
                💡 Continue à renforcer {s} — c'était déjà une matière plus
                faible avant ce quiz.
              </p>
            ))
          ) : (
            <p className="rounded-card bg-mist2 px-4 py-3 text-sm text-ink">
              💡 Aucune matière particulièrement faible détectée — continue
              sur ce rythme.
            </p>
          )}
        </div>
      </AppShell>
    );
  }

  // --- Étape 2 : passage du quiz ---
  const q = questions[current];
  const isLast = current === questions.length - 1;

  return (
    <AppShell active="quizzes" title="Grand Quiz">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm text-slate">
          Question {current + 1} sur {questions.length} · {q.subject}
        </p>
        <ExamTimer minutes={Math.max(60, Math.ceil(questions.length * 1.5))} onExpire={handleFinish} />
      </div>
      <p className="mb-5 text-right text-xs text-slate/60">
        Le quiz se soumet automatiquement à 00:00.
      </p>
      {error && <p className="mb-4 text-sm text-clay">{error}</p>}

      <QuestionNavigator total={questions.length} current={current} answers={answers} onJump={setCurrent} />
      <div className="rounded-card border border-mist bg-white p-6">
        <p className="font-display text-lg text-ink">{cleanMath(q.question)}</p>
        <div className="mt-5 space-y-3">
          {q.options.map((opt, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-center gap-3 rounded-card border border-mist px-4 py-3 text-sm text-ink hover:border-ink has-[:checked]:border-clay has-[:checked]:bg-clay/5"
            >
              <input
                type="radio"
                name={`q${current}`}
                checked={answers[current] === i}
                onChange={() => selectAnswer(i)}
                className="accent-clay"
              />
              {cleanMath(opt)}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
          className="rounded-card border border-mist px-5 py-2.5 text-sm text-ink hover:border-ink disabled:opacity-40"
        >
          Précédente
        </button>
        {isLast ? (
          <button
            onClick={handleFinish}
            disabled={saving}
            className="rounded-card bg-gold px-5 py-2.5 text-sm font-medium text-ink hover:bg-gold/90 disabled:opacity-60"
          >
            {saving ? "Correction…" : "Terminer le quiz"}
          </button>
        ) : (
          <button
            onClick={() => setCurrent((c) => c + 1)}
            className="rounded-card bg-ink px-5 py-2.5 text-sm text-paper hover:bg-ink/90"
          >
            Question suivante
          </button>
        )}
      </div>
    </AppShell>
  );
}
