"use client";

import { cleanMath } from "@/lib/math-clean";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import ExamQuestionChat from "@/components/ExamQuestionChat";
import AudioControls from "@/components/AudioControls";
import ExamOpenResults from "@/components/ExamOpenResults";
import { fullCorrectionSpeech, questionSpeech } from "@/lib/exam-speech";
import { supabase } from "@/lib/supabase";
import { analyzeExam, GradedExamQuestion, type ExamAnalysisItem } from "@/lib/api";

type ResultRow = {
  id: string;
  subject: string;
  score_percent: number;
  questions: GradedExamQuestion[] | null;
  answers: number[] | null;
};

function ResultsContent() {
  const params = useSearchParams();
  const id = params.get("id");
  const [result, setResult] = useState<ResultRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<ExamAnalysisItem[] | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!id) {
        setLoading(false);
        return;
      }
      // La note vient du serveur (exam_results) ; RLS : l'élève ne lit que ses propres lignes.
      const { data } = await supabase
        .from("exam_results")
        .select("id, subject, score_percent, questions, answers")
        .eq("id", id)
        .single();
      setResult(data);
      if (data) {
        const { data: row } = await supabase
          .from("exam_analyses")
          .select("status, analysis")
          .eq("result_id", id)
          .maybeSingle();
        if (row?.status === "done" && Array.isArray(row.analysis)) setAnalysis(row.analysis as ExamAnalysisItem[]);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  async function runAnalysis(regenerate: boolean) {
    if (!result || analysing) return;
    setAnalysing(true);
    setAnalysisError(null);
    try {
      const r = await analyzeExam(result.id, regenerate);
      setAnalysis(r.analysis);
    } catch (e) {
      // La note et les corrections restent affichées même si l'IA est indisponible.
      setAnalysisError(e instanceof Error ? e.message : "L'analyse IA a échoué.");
    } finally {
      setAnalysing(false);
    }
  }

  if (loading) return <p className="text-sm text-slate">Chargement…</p>;
  if (!result)
    return (
      <p className="text-sm text-slate">
        Résultat introuvable — passe un examen depuis la page Examens.
      </p>
    );

  const all = (result.questions ?? []).map((q, i) => ({ q, given: result.answers?.[i] ?? -1, index: i }));
  const mistakes = all.filter((m) => m.given !== m.q.correctIndex);
  const successes = all.filter((m) => m.given === m.q.correctIndex);
  const total = result.questions?.length ?? 0;
  const analysisFor = (index: number) => analysis?.find((a) => a.index === index) ?? null;
  const speechOf = (q: GradedExamQuestion, given: number, index: number, withAnalysis: boolean) =>
    questionSpeech({ index, question: cleanMath(q.question), options: q.options.map(cleanMath), given, correctIndex: q.correctIndex, method: cleanMath(q.method) }, withAnalysis ? analysisFor(index) : null);
  const fullSpeech = fullCorrectionSpeech({
    subject: result.subject,
    scorePercent: result.score_percent,
    total,
    mistakes: mistakes.map(({ q, given, index }) => ({
      q: { index, question: cleanMath(q.question), options: q.options.map(cleanMath), given, correctIndex: q.correctIndex, method: cleanMath(q.method) },
      analysis: analysisFor(index),
    })),
  });

  return (
    <>
      <div className="mb-6 flex items-center gap-6 rounded-card border border-mist bg-white p-6">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-forest/10">
          <span className="font-display text-2xl text-forest">{result.score_percent}%</span>
        </div>
        <div>
          <p className="font-display text-xl text-ink">
            {total - mistakes.length} / {total}
          </p>
          <p className="text-xs text-slate">Partie A — QCM</p>
          <p className="text-sm text-slate">{result.subject} — Examen de 30 minutes</p>
          <p className="mt-1 text-xs text-slate">
            Note calculée par le serveur : 1 point par bonne réponse, 0 sinon. L&apos;analyse IA ne la modifie jamais.
          </p>
          <AudioControls text={fullSpeech} />
        </div>
      </div>

      <ExamOpenResults resultId={result.id} qcmCorrect={total - mistakes.length} qcmTotal={total} />

      {mistakes.length === 0 ? (
        <p className="text-sm text-forest">Aucune erreur — excellent travail !</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-base text-ink">Tes erreurs, expliquées</p>
            <button
              type="button"
              disabled={analysing}
              onClick={() => runAnalysis(Boolean(analysis))}
              className="rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:bg-mist2 disabled:opacity-50"
            >
              {analysing ? "Analyse en cours…" : analysis ? "Relancer l'analyse IA" : "Analyse pédagogique IA"}
            </button>
          </div>
          {analysisError && (
            <p role="alert" className="mb-3 rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">
              {analysisError}
            </p>
          )}
          <div className="space-y-4">
            {mistakes.map(({ q, given, index }) => {
              const a = analysisFor(index);
              return (
                <div key={index} className="rounded-card border border-mist bg-white p-5">
                  <p className="text-sm font-medium text-clay">
                    ❌ Question {index + 1} — 0 / 1 point
                  </p>
                  <p className="mt-2 text-sm text-ink">{cleanMath(q.question)}</p>
                  <p className="mt-2 text-sm text-slate">
                    Ta réponse :{" "}
                    <span className="text-ink">{given >= 0 ? cleanMath(q.options[given]) : "aucune réponse"}</span>
                  </p>
                  <p className="mt-1 text-sm text-slate">
                    ✅ Réponse attendue : <span className="text-ink">{cleanMath(q.options[q.correctIndex])}</span>
                  </p>
                  <p className="mt-3 rounded-card bg-mist2 px-3 py-2 text-sm text-ink">💡 {cleanMath(q.method)}</p>
                  <AudioControls text={speechOf(q, given, index, true)} />

                  {a && (
                    <div className="mt-3 space-y-2 rounded-card border border-forest/30 bg-forest/5 px-3 py-3 text-sm text-ink">
                      <p className="text-xs font-medium uppercase tracking-wide text-forest">Analyse pédagogique IA</p>
                      {a.errorExplanation && <p>{a.errorExplanation}</p>}
                      {a.steps.length > 0 && (
                        <ol className="list-decimal space-y-1 pl-5">
                          {a.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      )}
                      {a.example && (
                        <p>
                          <span className="font-medium">Exemple : </span>
                          {a.example}
                        </p>
                      )}
                      {a.similarExercise && (
                        <details>
                          <summary className="cursor-pointer font-medium">Exercice similaire</summary>
                          <p className="mt-1">{a.similarExercise.statement}</p>
                          {a.similarExercise.answer && (
                            <p className="mt-1 text-slate">Réponse : {a.similarExercise.answer}</p>
                          )}
                        </details>
                      )}
                      {a.uncertainty && <p className="text-xs text-clay">⚠️ Incertitude signalée : {a.uncertainty}</p>}
                    </div>
                  )}
                  <ExamQuestionChat resultId={result.id} index={index} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {successes.length > 0 && (
        <details className="mt-6 rounded-card border border-mist bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">Questions réussies ({successes.length})</summary>
          <div className="mt-3 space-y-4">
            {successes.map(({ q, index }) => (
              <div key={index} className="text-sm">
                <p className="font-medium text-forest">✅ Question {index + 1} — 1 / 1 point</p>
                <p className="mt-1 text-ink">{cleanMath(q.question)}</p>
                <p className="mt-1 text-slate">
                  Réponse : <span className="text-ink">{cleanMath(q.options[q.correctIndex])}</span>
                </p>
                <AudioControls text={speechOf(q, q.correctIndex, index, false)} />
                <ExamQuestionChat resultId={result.id} index={index} />
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export default function ResultsPage() {
  return (
    <AppShell active="exams" title="Résultat de l'examen">
      <Suspense fallback={<p className="text-sm text-slate">Chargement…</p>}>
        <ResultsContent />
      </Suspense>
    </AppShell>
  );
}
