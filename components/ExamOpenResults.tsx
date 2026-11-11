"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { gradeOpenAnswers, type OpenAnswerRow } from "@/lib/api";
import { combinedPercent } from "@/lib/exam-open";
import { cleanMath } from "@/lib/math-clean";
import AudioControls from "@/components/AudioControls";
import ExamQuestionChat from "@/components/ExamQuestionChat";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function speechOf(r: OpenAnswerRow): string {
  const parts = [`Question B${r.question_index + 1}.`, cleanMath(r.question)];
  if (r.status === "graded" && r.points !== null) parts.push(`Tu as obtenu ${fmt(r.points)} sur ${fmt(r.max_points)}.`);
  if (r.feedback?.summary) parts.push(r.feedback.summary);
  if (r.expected_answer) parts.push(`Réponse de référence : ${cleanMath(r.expected_answer)}.`);
  if (r.feedback?.uncertainty) parts.push(`Attention, incertitude signalée : ${r.feedback.uncertainty}.`);
  return parts.join(" ");
}

/**
 * Résultats de la Partie B : ta réponse, la note par critère du barème, le bilan et la réponse de référence.
 * La note QCM reste calculée séparément par le serveur ; celle-ci est évaluée par l'IA (indicative). La correction se lance
 * toute seule à l'ouverture, une seule fois : les réponses déjà corrigées ne sont jamais recorrigées ni débitées de nouveau.
 */
export default function ExamOpenResults({ resultId, qcmCorrect, qcmTotal }: { resultId: string; qcmCorrect: number; qcmTotal: number }) {
  const [rows, setRows] = useState<OpenAnswerRow[] | null>(null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const triedAuto = useRef(false);
  const polls = useRef(0);

  const load = useCallback(async () => {
    const { data } = await supabase.from("exam_open_answers").select("*").eq("result_id", resultId).order("question_index");
    const list = (data as OpenAnswerRow[] | null) ?? [];
    setRows(list);
    return list;
  }, [resultId]);

  const grade = useCallback(async () => {
    setGrading(true);
    setError(null);
    try {
      const r = await gradeOpenAnswers(resultId);
      setRows(r.items);
      setWarning(r.warning ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "La correction a échoué.");
    } finally {
      setGrading(false);
    }
  }, [resultId]);

  useEffect(() => {
    load().then((list) => {
      if (list.some((r) => r.status === "pending") && !triedAuto.current) {
        triedAuto.current = true;
        void grade();
      }
    });
  }, [load, grade]);

  // Une autre fenêtre est en train de corriger : on revérifie quelques fois.
  useEffect(() => {
    if (!rows?.some((r) => r.status === "grading") || polls.current >= 6) return;
    const t = setTimeout(() => {
      polls.current += 1;
      void load();
    }, 6000);
    return () => clearTimeout(t);
  }, [rows, load]);

  // Aperçu des photos envoyées (adresses temporaires du bucket privé).
  useEffect(() => {
    if (!rows) return;
    (async () => {
      const next: Record<string, string[]> = {};
      for (const r of rows) {
        const urls: string[] = [];
        for (const p of r.image_paths ?? []) {
          const { data } = await supabase.storage.from("documents").createSignedUrl(p, 3600);
          if (data?.signedUrl) urls.push(data.signedUrl);
        }
        if (urls.length) next[r.id] = urls;
      }
      setPhotos(next);
    })().catch(() => undefined);
  }, [rows]);

  if (!rows || rows.length === 0) return null;
  const allGraded = rows.every((r) => r.status === "graded");
  const maxTotal = rows.reduce((s, r) => s + Number(r.max_points), 0);
  const gotTotal = rows.reduce((s, r) => s + (r.status === "graded" ? Number(r.points ?? 0) : 0), 0);
  const needsGrading = rows.some((r) => r.status === "pending" || r.status === "failed");

  return (
    <section className="mb-6 rounded-card border border-mist bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg text-ink">Partie B — questions rédigées</p>
        {needsGrading && (
          <button type="button" disabled={grading} onClick={() => void grade()} className="rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:bg-mist2 disabled:opacity-50">
            {grading ? "Correction en cours…" : "Corriger la Partie B"}
          </button>
        )}
      </div>

      {allGraded ? (
        <p className="mt-2 text-sm text-ink">
          Partie B : <strong>{fmt(gotTotal)} / {fmt(maxTotal)}</strong> points · Total indicatif (QCM + Partie B) :{" "}
          <strong>{combinedPercent(qcmCorrect, qcmTotal, gotTotal, maxTotal)} %</strong>
        </p>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate">
          {grading && <Loader2 size={14} className="animate-spin" />}
          {grading ? "L'IA corrige tes réponses selon le barème…" : "La correction de la Partie B n'est pas encore terminée."}
        </p>
      )}
      <p className="mt-1 text-xs text-slate">
        Évaluée par l&apos;IA d&apos;après un barème : note indicative qui peut comporter des erreurs. Ta note QCM est calculée séparément par le serveur.
      </p>
      {error && <p role="alert" className="mt-3 rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>}
      {warning && <p role="status" className="mt-3 rounded-card bg-gold/10 px-3 py-2 text-sm text-ink">{warning}</p>}

      <div className="mt-4 space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="rounded-card border border-mist p-4">
            <p className="text-sm font-medium text-ink">
              Question B{r.question_index + 1} —{" "}
              {r.status === "graded" && r.points !== null ? `${fmt(Number(r.points))} / ${fmt(Number(r.max_points))} point${Number(r.max_points) > 1 ? "s" : ""}` : `${fmt(Number(r.max_points))} points · ${r.status === "grading" ? "correction en cours" : "pas encore corrigée"}`}
            </p>
            <p className="mt-1 text-sm text-ink">{cleanMath(r.question)}</p>

            <div className="mt-2 text-sm">
              <p className="text-xs font-medium text-slate">Ta réponse</p>
              {r.answer_text ? <p className="whitespace-pre-wrap text-ink">{r.answer_text}</p> : r.image_paths.length === 0 ? <p className="text-slate">Aucune réponse fournie.</p> : null}
              {photos[r.id]?.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt={`Photo ${i + 1} de ta solution`} className="mt-2 max-h-56 rounded-card border border-mist" />
              ))}
            </div>

            {r.status === "graded" && r.feedback && (
              <div className="mt-3 space-y-2 rounded-card border border-forest/30 bg-forest/5 px-3 py-3 text-sm text-ink">
                <p className="text-xs font-medium uppercase tracking-wide text-forest">Correction selon le barème</p>
                <ul className="space-y-1">
                  {(r.feedback.criteria ?? []).map((c, i) => (
                    <li key={i}>
                      <span className={c.awarded >= c.max ? "text-forest" : c.awarded > 0 ? "text-ink" : "text-clay"}>
                        {fmt(c.awarded)} / {fmt(c.max)}
                      </span>{" "}
                      — {c.criterion}
                      {c.comment ? <span className="text-slate"> · {c.comment}</span> : null}
                    </li>
                  ))}
                </ul>
                {r.feedback.summary && <p>{r.feedback.summary}</p>}
                {r.feedback.uncertainty && <p className="text-xs text-clay">⚠️ Correction incertaine : {r.feedback.uncertainty} Vérifie avec ton professeur.</p>}
              </div>
            )}
            {r.expected_answer && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-ink">Réponse de référence</summary>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate">{cleanMath(r.expected_answer)}</p>
              </details>
            )}
            <AudioControls text={speechOf(r)} />
            <ExamQuestionChat resultId={resultId} index={r.question_index} part="B" />
          </div>
        ))}
      </div>
    </section>
  );
}
