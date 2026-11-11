import type { Answers } from "./types";

/** Valeurs de départ NEUTRES : aucune heure inventée (réveil, coucher, trajet restent vides). */
export function emptyAnswers(): Answers {
  return {
    goal: null, level: "", className: "", classDays: [], classHours: {},
    wakeTime: "", bedTime: "", prepMinutes: 0, departureTime: "", travelMinutes: 0, returnTime: "",
    unavailable: [], subjects: [], exams: [], homework: [],
    mealBreaks: [], prayerTimes: [], restTimes: [], otherCommitments: [],
    dailyMinutes: 0, preferredPart: "none", sessionLength: "mixed", breakEvery: 45, breakMinutes: 10,
    prioritySubjects: [], planType: null,
  };
}

/** Fusionne des réponses enregistrées (possiblement anciennes/partielles) avec les valeurs neutres. */
export function normalizeAnswers(raw: unknown): Answers {
  const base = emptyAnswers();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Answers>;
  return { ...base, ...r, classHours: { ...(r.classHours ?? {}) }, subjects: r.subjects ?? [], exams: r.exams ?? [], homework: r.homework ?? [] };
}

export type MissingField = "goal" | "wake" | "bed" | "subjects" | "daily" | "plan_type" | "return_time" | "class_hours";

/** Informations indispensables avant génération. */
export function missingRequired(a: Answers): MissingField[] {
  const m: MissingField[] = [];
  if (!a.goal) m.push("goal");
  if (!a.wakeTime) m.push("wake");
  if (!a.bedTime) m.push("bed");
  if (a.subjects.filter((s) => s.name.trim()).length === 0) m.push("subjects");
  if (!(a.dailyMinutes > 0)) m.push("daily");
  if (!a.planType) m.push("plan_type");
  if (a.classDays.length > 0) {
    if (a.classDays.some((d) => (a.classHours[d] ?? []).length === 0)) m.push("class_hours");
    if (!a.returnTime) m.push("return_time");
  }
  return m;
}
