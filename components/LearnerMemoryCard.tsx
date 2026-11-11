"use client";

import { useEffect, useState } from "react";
import { deleteAllConversations, deleteLearnerMemory, loadLearnerMemory, saveLearnerMemory, type LearnerMemoryRow } from "@/lib/conversations";

const EMPTY: LearnerMemoryRow = { personalization_enabled: true, history_enabled: true, display_name: null, study_level: null, subjects: null, goals: null, learning_prefs: null };

/** Fiche « Mémoire pédagogique » : l'élève contrôle tout (consulter, modifier, désactiver, effacer). Rien n'est déduit ni inventé par l'IA. */
export default function LearnerMemoryCard() {
  const [m, setM] = useState<LearnerMemoryRow>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadLearnerMemory().then((row) => {
      if (row) setM(row);
      setLoaded(true);
    });
  }, []);

  const set = <K extends keyof LearnerMemoryRow>(k: K, v: LearnerMemoryRow[K]) => setM((p) => ({ ...p, [k]: v }));
  const field = "w-full rounded-card border border-mist px-3 py-2 text-sm";

  async function save() {
    setBusy(true);
    const ok = await saveLearnerMemory(m);
    setMsg(ok ? { ok: true, text: "Préférences enregistrées." } : { ok: false, text: "Enregistrement impossible. Réessaie." });
    setBusy(false);
  }
  async function wipeMemory() {
    if (!window.confirm("Effacer ta fiche de mémoire pédagogique ?")) return;
    const ok = await deleteLearnerMemory();
    if (ok) setM(EMPTY);
    setMsg(ok ? { ok: true, text: "Mémoire effacée." } : { ok: false, text: "Suppression impossible. Réessaie." });
  }
  async function wipeChats() {
    if (!window.confirm("Supprimer toutes tes conversations avec l'assistant ? Action définitive.")) return;
    const ok = await deleteAllConversations();
    setMsg(ok ? { ok: true, text: "Conversations supprimées." } : { ok: false, text: "Suppression impossible. Réessaie." });
  }

  if (!loaded) return null;
  return (
    <section className="mt-6 rounded-card border border-mist bg-white p-5">
      <h2 className="font-display text-lg text-ink">Mémoire pédagogique</h2>
      <p className="mt-1 text-sm text-slate">
        L&apos;assistant peut utiliser ces informations pour adapter ses réponses. Elles restent privées, tu les contrôles et tu peux tout effacer.
        Tes difficultés récurrentes sont calculées automatiquement à partir de tes vrais résultats d&apos;examens.
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={m.personalization_enabled} onChange={(e) => set("personalization_enabled", e.target.checked)} />
        Personnaliser les réponses de l&apos;assistant
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={m.history_enabled} onChange={(e) => set("history_enabled", e.target.checked)} />
        Enregistrer l&apos;historique de mes conversations
      </label>

      <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${m.personalization_enabled ? "" : "opacity-50"}`}>
        <div>
          <label htmlFor="lm-name" className="mb-1 block text-xs font-medium text-slate">Prénom ou nom d&apos;affichage</label>
          <input id="lm-name" className={field} maxLength={60} value={m.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} disabled={!m.personalization_enabled} />
        </div>
        <div>
          <label htmlFor="lm-level" className="mb-1 block text-xs font-medium text-slate">Niveau d&apos;études</label>
          <input id="lm-level" className={field} maxLength={80} placeholder="ex. Terminale C, Licence 1…" value={m.study_level ?? ""} onChange={(e) => set("study_level", e.target.value)} disabled={!m.personalization_enabled} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="lm-subjects" className="mb-1 block text-xs font-medium text-slate">Matières étudiées</label>
          <input id="lm-subjects" className={field} maxLength={200} value={m.subjects ?? ""} onChange={(e) => set("subjects", e.target.value)} disabled={!m.personalization_enabled} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="lm-goals" className="mb-1 block text-xs font-medium text-slate">Objectifs</label>
          <textarea id="lm-goals" rows={2} className={field} maxLength={300} value={m.goals ?? ""} onChange={(e) => set("goals", e.target.value)} disabled={!m.personalization_enabled} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="lm-prefs" className="mb-1 block text-xs font-medium text-slate">Préférences d&apos;apprentissage</label>
          <textarea id="lm-prefs" rows={2} className={field} maxLength={300} placeholder="ex. explications courtes, beaucoup d'exemples…" value={m.learning_prefs ?? ""} onChange={(e) => set("learning_prefs", e.target.value)} disabled={!m.personalization_enabled} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className="rounded-card bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">Enregistrer</button>
        <button type="button" onClick={wipeMemory} className="rounded-card border border-mist px-4 py-2 text-sm text-ink hover:bg-mist2">Effacer ma mémoire</button>
        <button type="button" onClick={wipeChats} className="rounded-card border border-clay/40 px-4 py-2 text-sm text-clay hover:bg-clay/5">Supprimer mes conversations</button>
      </div>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-forest" : "text-clay"}`}>{msg.text}</p>}
    </section>
  );
}
