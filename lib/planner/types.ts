export type Mastery = "very_hard" | "hard" | "medium" | "good" | "excellent";
export type Priority = "high" | "medium" | "low";
export type Goal = "exam" | "week_courses" | "grades" | "gaps" | "contest" | "organize";
export type PlanType = "today" | "tomorrow" | "week" | "exam_special";
export type SessionLength = "short" | "long" | "mixed";
export type TimePreference = "morning" | "afternoon" | "evening" | "none";

/** "HH:MM" partout dans les réponses ; converti en minutes uniquement dans le moteur. */
export type TimeRange = { start: string; end: string; label?: string };

export type SubjectInput = {
  name: string;
  mastery: Mastery;
  chapters: string; // texte libre, peut être vide
  exercises: string; // texte libre, peut être vide
  priority: Priority;
};

export type ExamInput = { subject: string; date: string }; // date = YYYY-MM-DD
export type HomeworkInput = { subject: string; title: string; due: string };

export type Answers = {
  goal: Goal | null;
  level: string;
  className: string;
  /** Jours de cours : 0 = dimanche … 6 = samedi (convention Date.getDay). */
  classDays: number[];
  /** Horaires de cours par jour (clé = numéro du jour). */
  classHours: Record<number, TimeRange[]>;
  wakeTime: string;
  bedTime: string;
  prepMinutes: number;
  departureTime: string; // "" si pas de trajet
  travelMinutes: number;
  returnTime: string; // "" si inconnue
  unavailable: TimeRange[];
  subjects: SubjectInput[];
  exams: ExamInput[];
  homework: HomeworkInput[];
  mealBreaks: TimeRange[];
  prayerTimes: TimeRange[]; // facultatif
  restTimes: TimeRange[];
  otherCommitments: TimeRange[];
  dailyMinutes: number;
  preferredPart: TimePreference;
  sessionLength: SessionLength;
  breakEvery: number; // minutes de travail entre deux pauses
  breakMinutes: number;
  prioritySubjects: string[];
  planType: PlanType | null;
};

export type ActivityKind = "wake" | "prep" | "travel" | "class" | "meal" | "prayer" | "rest" | "commitment" | "study" | "break" | "review" | "sleep";

export type Activity = {
  start: number; // minutes
  end: number;
  kind: ActivityKind;
  subject: string | null;
  title: string;
  objective: string;
  priority: Priority;
  isExam: boolean;
  /** Nature de l'objectif : sert à choisir le libellé traduit quand `objective` est vide. */
  objectiveKind: "chapter" | "exercise" | "exam" | "homework" | "general";
  /** true = bloc de révision modifiable ; false = repère de la journée (cours, trajet...). */
  isStudy: boolean;
};

export type Problem = {
  code: "no_subjects" | "no_time" | "time_short" | "wake_after_bed" | "missing_wake" | "missing_bed" | "bad_range" | "no_daily_minutes" | "sleep_short" | "missing_return" | "conflict" | "wake_late";
  /** Valeurs pour l'interpolation i18n. */
  vars?: Record<string, string | number>;
};

export type Suggestion = {
  code: "reduce_daily" | "free_slot" | "fewer_subjects" | "extend_day" | "use_weekend";
  vars?: Record<string, string | number>;
};

export type BuildOptions = {
  /** Activités déjà terminées ou commencées : conservées telles quelles, jamais déplacées. */
  locked?: Activity[];
};

export type DayPlan = {
  date: string; // YYYY-MM-DD
  activities: Activity[];
  plannedStudyMinutes: number;
  requestedStudyMinutes: number;
  problems: Problem[];
  suggestions: Suggestion[];
  /** Éléments déplacés lors d'une régénération (rempli par l'appelant). */
  moved?: string[];
};
