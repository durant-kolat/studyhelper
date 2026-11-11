// Statistiques du tableau de bord : calculées UNIQUEMENT à partir des résultats réels de l'élève (aucune donnée inventée).
// Logique PURE (sans dépendance) : testable, partagée par l'interface.

export type ResultRow = { subject: string; score_percent: number; taken_at: string };
export type SubjectStat = { subject: string; average: number; count: number; lastAt: string };
export type Trend = "up" | "down" | "stable";
export type Insights = {
  total: number;
  average: number | null;
  best: SubjectStat | null;
  bySubject: SubjectStat[];
  weak: SubjectStat[];
  recent: ResultRow[];
  trend: Trend | null;
  daysSinceLast: number | null;
};
export type Recommendation = { text: string; href: string };

export const WEAK_THRESHOLD = 70;
const avg = (n: number[]) => n.reduce((a, b) => a + b, 0) / n.length;

export function computeInsights(rows: ResultRow[], now: Date = new Date()): Insights {
  const valid = rows
    .filter((r) => r && typeof r.subject === "string" && r.subject.trim() && Number.isFinite(r.score_percent) && !Number.isNaN(Date.parse(r.taken_at)))
    .sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at)); // plus récents d'abord
  if (valid.length === 0) return { total: 0, average: null, best: null, bySubject: [], weak: [], recent: [], trend: null, daysSinceLast: null };

  const groups = new Map<string, ResultRow[]>();
  for (const r of valid) {
    const key = r.subject.trim();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const bySubject: SubjectStat[] = [...groups.entries()]
    .map(([subject, list]) => ({ subject, average: Math.round(avg(list.map((r) => r.score_percent))), count: list.length, lastAt: list[0].taken_at }))
    .sort((a, b) => a.average - b.average);

  // Tendance : 3 derniers résultats comparés aux 3 précédents ; au moins 4 résultats, sinon rien n'est affirmé.
  let trend: Trend | null = null;
  if (valid.length >= 4) {
    const latest = avg(valid.slice(0, 3).map((r) => r.score_percent));
    const before = avg(valid.slice(3, 6).map((r) => r.score_percent));
    trend = latest - before >= 5 ? "up" : before - latest >= 5 ? "down" : "stable";
  }
  const days = Math.floor((now.getTime() - Date.parse(valid[0].taken_at)) / 86_400_000);

  return {
    total: valid.length,
    average: Math.round(avg(valid.map((r) => r.score_percent))),
    best: [...bySubject].sort((a, b) => b.average - a.average)[0],
    bySubject,
    weak: bySubject.filter((s) => s.average < WEAK_THRESHOLD).slice(0, 4),
    recent: valid.slice(0, 5),
    trend,
    daysSinceLast: Math.max(0, days),
  };
}

/** Recommandations de révision : toutes fondées sur un fait mesuré (moyenne, nombre de résultats, date du dernier examen). */
export function recommendations(i: Insights): Recommendation[] {
  const out: Recommendation[] = [];
  if (i.total === 0) return [{ text: "Passe ton premier examen pour mesurer ton niveau et obtenir des recommandations.", href: "/exams" }];
  for (const w of i.weak.slice(0, 3)) {
    out.push({ text: `Revoir ${w.subject} : ta moyenne est de ${w.average} % sur ${w.count} résultat${w.count > 1 ? "s" : ""}.`, href: "/exams" });
  }
  if (i.daysSinceLast !== null && i.daysSinceLast >= 7) {
    out.push({ text: `Ton dernier examen date de ${i.daysSinceLast} jours : un entraînement régulier t'aide à progresser.`, href: "/exams" });
  }
  if (out.length === 0) out.push({ text: "Tes moyennes sont solides : tente un examen plus long ou plus difficile pour continuer à progresser.", href: "/exams" });
  return out.slice(0, 4);
}
