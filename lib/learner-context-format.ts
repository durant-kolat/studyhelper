// Mise en forme PURE (sans dépendance) du contexte de personnalisation envoyé à l'IA.
// Principes : (1) seulement ce que l'élève a renseigné ou ce qui est CALCULÉ à partir de ses vrais résultats ;
// (2) rien d'inventé ; (3) volume borné ; (4) jamais de personnalisation si l'élève l'a désactivée.

export type LearnerMemory = {
  personalization_enabled?: boolean | null;
  display_name?: string | null;
  study_level?: string | null;
  subjects?: string | null;
  goals?: string | null;
  learning_prefs?: string | null;
};
export type WeakSubject = { subject: string; average: number; count: number };

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Matières dont la moyenne des résultats réels est < seuil (défaut 70 %), les plus faibles d'abord. */
export function computeWeakSubjects(rows: { subject: string | null; score_percent: number | null }[], threshold = 70, maxSubjects = 4): WeakSubject[] {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (!r.subject || typeof r.score_percent !== "number" || !Number.isFinite(r.score_percent)) continue;
    const key = r.subject.trim().slice(0, 60);
    if (!key) continue;
    const a = acc.get(key) ?? { sum: 0, n: 0 };
    a.sum += r.score_percent;
    a.n += 1;
    acc.set(key, a);
  }
  return [...acc.entries()]
    .map(([subject, a]) => ({ subject, average: Math.round(a.sum / a.n), count: a.n }))
    .filter((s) => s.average < threshold)
    .sort((x, y) => x.average - y.average)
    .slice(0, maxSubjects);
}

/** Texte vide si la personnalisation est désactivée ou s'il n'y a rien de fiable à transmettre. */
export function formatLearnerContext(memory: LearnerMemory | null | undefined, weak: WeakSubject[]): string {
  if (memory?.personalization_enabled === false) return "";
  const lines: string[] = [];
  const name = clean(memory?.display_name, 60);
  const level = clean(memory?.study_level, 80);
  const subjects = clean(memory?.subjects, 200);
  const goals = clean(memory?.goals, 300);
  const prefs = clean(memory?.learning_prefs, 300);
  if (name) lines.push(`Prénom / nom d'affichage : ${name}`);
  if (level) lines.push(`Niveau d'études : ${level}`);
  if (subjects) lines.push(`Matières étudiées : ${subjects}`);
  if (goals) lines.push(`Objectifs : ${goals}`);
  if (prefs) lines.push(`Préférences d'apprentissage : ${prefs}`);
  if (weak.length > 0) {
    lines.push(`Difficultés mesurées (moyennes réelles des examens) : ${weak.map((w) => `${clean(w.subject, 60)} ${w.average} % (${w.count} résultat${w.count > 1 ? "s" : ""})`).join(" ; ")}`);
  }
  return lines.join("\n");
}

export const LEARNER_CONTEXT_RULES =
  "Informations de personnalisation (renseignées par l'élève ou calculées sur ses résultats réels). Utilise-les UNIQUEMENT si elles améliorent la réponse (niveau, exemples, matières), sans les réciter ni les répéter inutilement. N'en déduis rien d'autre et n'invente jamais d'information personnelle.";

/** Prénom pour une salutation : première partie du nom, jamais inventé. */
export function greetingName(displayName: string | null | undefined, fullName: string | null | undefined): string {
  const explicit = clean(displayName, 60);
  if (explicit) return explicit;
  return clean(fullName, 60).split(" ")[0] ?? "";
}
