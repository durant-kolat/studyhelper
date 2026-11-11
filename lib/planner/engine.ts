// Moteur de planification DÉTERMINISTE. Aucune IA ici : les horaires viennent uniquement des
// réponses de l'utilisateur et de calculs vérifiables. Même entrée → même planning.

import { formatHHMM, freeSlots, mergeIntervals, overlaps, parseHHMM, sortIntervals } from "./time";
import type { Interval } from "./time";
import type {
  Activity, Answers, BuildOptions, DayPlan, Mastery, Priority, Problem, Suggestion, SubjectInput, TimeRange,
} from "./types";

export const MIN_STUDY_BLOCK = 20; // minutes : en dessous, une séance n'a pas de sens
const WIND_DOWN = 30; // minutes sans révision avant le coucher

const MASTERY_WEIGHT: Record<Mastery, number> = { very_hard: 5, hard: 4, medium: 3, good: 2, excellent: 1 };
const PRIORITY_WEIGHT: Record<Priority, number> = { high: 2, medium: 1, low: 0 };

export function parseDateISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(iso: string, n: number): string {
  const d = parseDateISO(iso);
  d.setDate(d.getDate() + n);
  return toDateISO(d);
}

export function daysUntil(targetISO: string, fromISO: string): number {
  const a = parseDateISO(fromISO).getTime();
  const b = parseDateISO(targetISO).getTime();
  return Math.round((b - a) / 86400000);
}

function rangesToIntervals(list: TimeRange[], problems: Problem[]): Interval[] {
  const out: Interval[] = [];
  for (const r of list) {
    const s = parseHHMM(r.start);
    const e = parseHHMM(r.end);
    if (s === null || e === null || e <= s) {
      problems.push({ code: "bad_range", vars: { label: r.label || `${r.start}–${r.end}` } });
      continue;
    }
    out.push({ start: s, end: e });
  }
  return out;
}

/** Poids d'une matière pour la date donnée : difficulté + priorité + examen/devoir proche. */
export function subjectWeight(s: SubjectInput, a: Answers, dateISO: string, examSpecial: boolean): number {
  let w = MASTERY_WEIGHT[s.mastery] + PRIORITY_WEIGHT[s.priority];
  const key = s.name.trim().toLowerCase();
  let examSoon = false;
  for (const ex of a.exams) {
    if (ex.subject.trim().toLowerCase() !== key) continue;
    const d = daysUntil(ex.date, dateISO);
    if (d < 0) continue;
    examSoon = examSoon || d <= 30;
    w += d <= 1 ? 6 : d <= 3 ? 4 : d <= 7 ? 2 : d <= 14 ? 1 : 0;
  }
  for (const hw of a.homework) {
    if (hw.subject.trim().toLowerCase() !== key) continue;
    const d = daysUntil(hw.due, dateISO);
    if (d < 0) continue;
    w += d <= 1 ? 3 : d <= 3 ? 1 : 0;
  }
  if (a.prioritySubjects.some((p) => p.trim().toLowerCase() === key)) w += 2;
  if (examSpecial && examSoon) w *= 3;
  return w;
}

function splitList(text: string): string[] {
  return text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
}

function maxBlockFor(a: Answers): { min: number; max: number } {
  if (a.sessionLength === "short") return { min: 20, max: 30 };
  if (a.sessionLength === "long") return { min: 40, max: 60 };
  return { min: 25, max: 45 };
}

function emptyPlan(date: string, requested: number, problems: Problem[], suggestions: Suggestion[]): DayPlan {
  return { date, activities: [], plannedStudyMinutes: 0, requestedStudyMinutes: requested, problems, suggestions };
}

/** Repères fixes de la journée (cours, trajets, repas…) + plages occupées. */
function fixedActivities(a: Answers, dateISO: string, wake: number, bedEnd: number, problems: Problem[]): Activity[] {
  const acts: Activity[] = [];
  const marker = (start: number, end: number, kind: Activity["kind"], title = ""): void => {
    if (end <= start) return;
    acts.push({ start, end, kind, subject: null, title, objective: "", priority: "medium", isExam: false, objectiveKind: "general", isStudy: false });
  };

  if (a.prepMinutes > 0) marker(wake, Math.min(wake + a.prepMinutes, bedEnd), "prep");

  const dow = parseDateISO(dateISO).getDay();
  if (a.classDays.includes(dow)) {
    const classes = rangesToIntervals(a.classHours[dow] ?? [], problems);
    const sorted = sortIntervals(classes);
    const dep = parseHHMM(a.departureTime);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const travel = Math.max(0, a.travelMinutes || 0);
    const leave = dep ?? (first ? first.start - travel : null);
    const back = parseHHMM(a.returnTime) ?? (last ? last.end + travel : null);

    if (sorted.length > 0) {
      if (leave !== null && first.start > leave) marker(leave, first.start, "travel");
      sorted.forEach((c, i) => {
        const entry = (a.classHours[dow] ?? [])[i];
        marker(c.start, c.end, "class", entry?.label ?? "");
      });
      if (back !== null && back > last.end) marker(last.end, back, "travel");
      // Trous entre deux cours : l'élève est à l'école, pas disponible pour réviser.
      for (let i = 0; i < sorted.length - 1; i++) marker(sorted[i].end, sorted[i + 1].start, "class", "");
      if (a.returnTime === "" && last) problems.push({ code: "missing_return" });
    } else if (leave !== null) {
      // Jour de cours sans horaires détaillés : on bloque de la sortie au retour déclaré.
      const end = back ?? bedEnd;
      if (back === null) problems.push({ code: "missing_return" });
      marker(leave, end, "class");
    }
  }

  const add = (list: TimeRange[], kind: Activity["kind"]) => {
    rangesToIntervals(list, problems).forEach((iv, i) => marker(iv.start, iv.end, kind, list.filter((r) => parseHHMM(r.start) !== null)[i]?.label ?? ""));
  };
  add(a.mealBreaks, "meal");
  add(a.prayerTimes, "prayer");
  add(a.restTimes, "rest");
  add(a.otherCommitments, "commitment");
  add(a.unavailable, "commitment");
  // Jamais d'activité avant le réveil ni après le coucher : on tronque et on le signale.
  const clipped: Activity[] = [];
  for (const x of acts) {
    const start = Math.max(x.start, wake);
    const end = Math.min(x.end, bedEnd);
    if (start !== x.start && x.end > wake) problems.push({ code: "wake_late", vars: { label: x.title || x.kind, wake: formatHHMM(wake) } });
    if (end > start) clipped.push({ ...x, start, end });
  }
  return resolveFixedConflicts(clipped, problems);
}

const FIXED_RANK: Record<string, number> = { class: 0, travel: 0, prep: 1, commitment: 2, meal: 3, prayer: 3, rest: 4 };

/** Deux repères fixes ne doivent jamais se chevaucher : le moins prioritaire est écarté ET signalé. */
function resolveFixedConflicts(acts: Activity[], problems: Problem[]): Activity[] {
  const ranked = [...acts].sort((x, y) => (FIXED_RANK[x.kind] ?? 5) - (FIXED_RANK[y.kind] ?? 5) || x.start - y.start);
  const kept: Activity[] = [];
  for (const x of ranked) {
    if (kept.some((k) => overlaps(k, x))) {
      problems.push({ code: "conflict", vars: { label: x.title || x.kind, time: `${formatHHMM(x.start)}–${formatHHMM(x.end)}` } });
    } else kept.push(x);
  }
  return kept;
}

export function buildDayPlan(a: Answers, dateISO: string, opts: BuildOptions = {}): DayPlan {
  const problems: Problem[] = [];
  const suggestions: Suggestion[] = [];
  const locked = opts.locked ?? [];
  const lockedStudy = locked.filter((l) => l.isStudy && l.kind === "study").reduce((n, l) => n + (l.end - l.start), 0);
  const requested = Math.max(0, a.dailyMinutes - lockedStudy);

  const wake = parseHHMM(a.wakeTime);
  const bed = parseHHMM(a.bedTime);
  if (wake === null) { problems.push({ code: "missing_wake" }); return emptyPlan(dateISO, requested, problems, suggestions); }
  if (bed === null) { problems.push({ code: "missing_bed" }); return emptyPlan(dateISO, requested, problems, suggestions); }
  if (!(a.dailyMinutes > 0)) { problems.push({ code: "no_daily_minutes" }); return emptyPlan(dateISO, requested, problems, suggestions); }
  if (a.subjects.length === 0) { problems.push({ code: "no_subjects" }); return emptyPlan(dateISO, requested, problems, suggestions); }

  // Un coucher "avant" le réveil signifie après minuit : la journée s'arrête à 24:00 au plus.
  const bedEnd = bed > wake ? bed : 24 * 60;
  const sleepMinutes = (wake - bed + 1440) % 1440;
  if (sleepMinutes < 6 * 60) problems.push({ code: "sleep_short", vars: { hours: Math.round((sleepMinutes / 60) * 10) / 10 } });

  const fixedAll = fixedActivities(a, dateISO, wake, bedEnd, problems);
  // Une activité déjà terminée/commencée garde sa place : un repère fixe qui la chevauche est écarté et signalé.
  const fixed = fixedAll.filter((f) => {
    if (!locked.some((l) => overlaps(l, f))) return true;
    problems.push({ code: "conflict", vars: { label: f.title || f.kind, time: `${formatHHMM(f.start)}–${formatHHMM(f.end)}` } });
    return false;
  });
  // Les activités verrouillées (terminées) occupent leur créneau tel quel.
  const busy: Interval[] = [...fixed, ...locked].map((x) => ({ start: x.start, end: x.end }));
  const studyEnd = bedEnd - WIND_DOWN;
  const slots = freeSlots(wake, studyEnd, busy).filter((s) => s.end - s.start >= MIN_STUDY_BLOCK);
  const capacity = slots.reduce((n, s) => n + (s.end - s.start), 0);

  const examSpecial = a.planType === "exam_special";
  const weighted = a.subjects
    .filter((s) => s.name.trim())
    .map((s, idx) => ({ s, idx, w: subjectWeight(s, a, dateISO, examSpecial) }));

  const base: Activity[] = [...fixed, ...locked];

  if (requested === 0) {
    // Objectif du jour déjà atteint par les séances terminées.
    return finalize(dateISO, base, requested, lockedStudy, problems, suggestions, wake, bedEnd, busy);
  }
  if (capacity < MIN_STUDY_BLOCK) {
    problems.push({ code: "no_time" });
    suggestions.push({ code: "free_slot" }, { code: "use_weekend" });
    return finalize(dateISO, base, requested, lockedStudy, problems, suggestions, wake, bedEnd, busy);
  }

  const target = Math.min(requested, capacity);
  if (capacity < requested) {
    const realistic = Math.floor(capacity / 5) * 5;
    problems.push({ code: "time_short", vars: { requested, available: capacity } });
    suggestions.push({ code: "reduce_daily", vars: { minutes: realistic } }, { code: "free_slot" });
    if (a.classDays.includes(parseDateISO(dateISO).getDay())) suggestions.push({ code: "use_weekend" });
  }

  // Nombre de matières servies : chaque matière reçoit au moins MIN_STUDY_BLOCK.
  const maxSubjects = Math.max(1, Math.floor(target / MIN_STUDY_BLOCK));
  const dayIndex = Math.abs(daysUntil(dateISO, "2000-01-01"));
  const ranked = [...weighted].sort((x, y) => y.w - x.w || ((x.idx + dayIndex) % weighted.length) - ((y.idx + dayIndex) % weighted.length));
  const chosen = ranked.slice(0, maxSubjects);
  if (chosen.length < weighted.length) suggestions.push({ code: "fewer_subjects", vars: { served: chosen.length, total: weighted.length } });

  // Répartition proportionnelle aux poids, arrondie à 5 min, plancher MIN_STUDY_BLOCK.
  const totalW = chosen.reduce((n, c) => n + c.w, 0);
  const alloc = new Map<number, number>();
  let used = 0;
  for (const c of chosen) {
    const raw = (target * c.w) / totalW;
    const m = Math.max(MIN_STUDY_BLOCK, Math.floor(raw / 5) * 5);
    alloc.set(c.idx, m);
    used += m;
  }
  // Ajuste pour que la somme == target (multiple de 5 inférieur ou égal).
  const goal = Math.floor(target / 5) * 5;
  const order = [...chosen];
  let guard = 0;
  while (used !== goal && guard++ < 1000) {
    if (used < goal) {
      const c = order[guard % order.length];
      alloc.set(c.idx, alloc.get(c.idx)! + 5); used += 5;
    } else {
      const c = [...order].reverse().find((x) => alloc.get(x.idx)! - 5 >= MIN_STUDY_BLOCK);
      if (!c) break;
      alloc.set(c.idx, alloc.get(c.idx)! - 5); used -= 5;
    }
  }

  // Découpage en séances selon la préférence courte/longue.
  const { min: bMin, max: bMax } = maxBlockFor(a);
  type Block = { idx: number; minutes: number; chunk: number };
  const perSubject = new Map<number, Block[]>();
  for (const c of chosen) {
    let left = alloc.get(c.idx)!;
    const blocks: Block[] = [];
    while (left > 0) {
      let size = Math.min(bMax, left);
      if (left - size > 0 && left - size < bMin) size = left - bMin >= bMin ? left - bMin : left; // pas de petit reste
      blocks.push({ idx: c.idx, minutes: size, chunk: blocks.length });
      left -= size;
    }
    perSubject.set(c.idx, blocks);
  }
  // Alternance des matières (la plus lourde d'abord) pour un équilibre dans la journée.
  const queue: Block[] = [];
  let more = true;
  for (let round = 0; more; round++) {
    more = false;
    for (const c of chosen) {
      const b = perSubject.get(c.idx)![round];
      if (b) { queue.push(b); more = true; }
    }
  }

  // Ordre des plages selon la préférence (matin/après-midi/soir), puis chronologique.
  const partRank = (s: Interval) => {
    const part = s.start < 720 ? "morning" : s.start < 1080 ? "afternoon" : "evening";
    return a.preferredPart === "none" || part === a.preferredPart ? 0 : 1;
  };
  const orderedSlots = [...slots].sort((x, y) => partRank(x) - partRank(y) || x.start - y.start);

  const placed: Activity[] = [];
  const breakEvery = Math.max(15, a.breakEvery || 45);
  const breakLen = Math.max(0, a.breakMinutes ?? 10);
  const taken = new Map<number, number>();
  const leftover: Block[] = [];
  let qi = 0;

  for (const slot of orderedSlots) {
    let cursor = slot.start;
    let workSinceBreak = 0;
    let lastEnd = -1;
    while (qi < queue.length) {
      const blk = queue[qi];
      let size = blk.minutes;
      let startAt = cursor;
      if (lastEnd === cursor && workSinceBreak >= breakEvery && breakLen > 0) startAt = cursor + breakLen;
      if (startAt + size > slot.end) size = Math.floor((slot.end - startAt) / 5) * 5;
      if (size < MIN_STUDY_BLOCK) break; // plage épuisée
      if (startAt > cursor) {
        placed.push({ start: cursor, end: startAt, kind: "break", subject: null, title: "", objective: "", priority: "low", isExam: false, objectiveKind: "general", isStudy: false });
        workSinceBreak = 0;
      }
      const sub = a.subjects[blk.idx];
      placed.push(studyActivity(sub, a, dateISO, startAt, startAt + size, blk.chunk, weighted.find((w) => w.idx === blk.idx)?.w ?? 0));
      taken.set(blk.idx, (taken.get(blk.idx) ?? 0) + size);
      if (size < blk.minutes) {
        // Le reste du bloc retourne en tête de file pour la plage suivante.
        queue[qi] = { ...blk, minutes: blk.minutes - size };
      } else qi++;
      cursor = startAt + size;
      lastEnd = cursor;
      workSinceBreak += size;
    }
  }
  for (; qi < queue.length; qi++) leftover.push(queue[qi]);

  // Bilan de fin de journée : 10 min seulement s'il reste de la place juste après la dernière séance.
  const studyPlaced = placed.filter((p) => p.kind === "study");
  const plannedMin = studyPlaced.reduce((n, p) => n + (p.end - p.start), 0);
  if (studyPlaced.length > 0 && plannedMin >= 60) {
    const lastStudy = sortIntervals(studyPlaced)[studyPlaced.length - 1];
    const start = lastStudy.end;
    const end = start + 10;
    const iv = { start, end };
    if (end <= studyEnd && !busy.concat(placed).some((b) => overlaps(iv, b))) {
      placed.push({ start, end, kind: "review", subject: null, title: "", objective: "", priority: "medium", isExam: false, objectiveKind: "general", isStudy: false });
    }
  }

  if (leftover.length > 0 && !problems.some((p) => p.code === "time_short")) {
    const left = leftover.reduce((n, b) => n + b.minutes, 0);
    problems.push({ code: "time_short", vars: { requested, available: requested - left } });
    suggestions.push({ code: "reduce_daily", vars: { minutes: Math.floor((requested - left) / 5) * 5 } }, { code: "free_slot" });
  }

  return finalize(dateISO, [...base, ...placed], requested, lockedStudy, problems, suggestions, wake, bedEnd, busy);
}

function studyActivity(sub: SubjectInput, a: Answers, dateISO: string, start: number, end: number, chunk: number, weight: number): Activity {
  const chapters = splitList(sub.chapters);
  const exercises = splitList(sub.exercises);
  const key = sub.name.trim().toLowerCase();
  const exam = a.exams.find((e) => e.subject.trim().toLowerCase() === key && daysUntil(e.date, dateISO) >= 0 && daysUntil(e.date, dateISO) <= 7);
  const hw = a.homework.find((h) => h.subject.trim().toLowerCase() === key && daysUntil(h.due, dateISO) >= 0 && daysUntil(h.due, dateISO) <= 3);
  let objective = "";
  let objectiveKind: Activity["objectiveKind"] = "general";
  if (hw && chunk === 0) { objective = hw.title; objectiveKind = "homework"; }
  else if (chapters.length > 0 && (chunk % 2 === 0 || exercises.length === 0)) { objective = chapters[Math.floor(chunk / 2) % chapters.length]; objectiveKind = "chapter"; }
  else if (exercises.length > 0) { objective = exercises[Math.floor(chunk / 2) % exercises.length]; objectiveKind = "exercise"; }
  else if (exam) objectiveKind = "exam";
  const priority: Priority = weight >= 9 ? "high" : weight >= 5 ? "medium" : "low";
  return { start, end, kind: "study", subject: sub.name.trim(), title: sub.name.trim(), objective, priority, isExam: !!exam, objectiveKind, isStudy: true };
}

function finalize(
  date: string, acts: Activity[], requested: number, lockedStudy: number,
  problems: Problem[], suggestions: Suggestion[], wake: number, bedEnd: number, _busy: Interval[],
): DayPlan {
  const activities = sortIntervals(acts);
  const planned = activities.filter((x) => x.kind === "study").reduce((n, x) => n + (x.end - x.start), 0);
  void wake; void bedEnd;
  const dedupProblems = problems.filter((p, i) => problems.findIndex((q) => q.code === p.code && JSON.stringify(q.vars) === JSON.stringify(p.vars)) === i);
  return { date, activities, plannedStudyMinutes: planned, requestedStudyMinutes: requested + lockedStudy, problems: dedupProblems, suggestions };
}

// ---------------------------------------------------------------------------------------------
// Validation indépendante : appliquée aux plannings générés ET avant chaque enregistrement.
// ---------------------------------------------------------------------------------------------
export type Violation = { rule: "order" | "overlap" | "duration" | "before_wake" | "after_bed" | "study_during_busy"; at: string };

export function validateDay(plan: { activities: Activity[] }, a: Answers): Violation[] {
  const v: Violation[] = [];
  const wake = parseHHMM(a.wakeTime);
  const bed = parseHHMM(a.bedTime);
  const bedEnd = wake !== null && bed !== null ? (bed > wake ? bed : 1440) : 1440;
  const acts = plan.activities;
  for (let i = 0; i < acts.length; i++) {
    const x = acts[i];
    const tag = `${formatHHMM(x.start)}-${formatHHMM(x.end)}`;
    if (!(x.end > x.start) || !Number.isFinite(x.start) || !Number.isFinite(x.end)) v.push({ rule: "duration", at: tag });
    if (wake !== null && x.start < wake) v.push({ rule: "before_wake", at: tag });
    if (x.end > bedEnd) v.push({ rule: "after_bed", at: tag });
    if (i > 0 && x.start < acts[i - 1].start) v.push({ rule: "order", at: tag });
    for (let j = i + 1; j < acts.length; j++) {
      if (overlaps(acts[i], acts[j])) v.push({ rule: "overlap", at: `${tag} / ${formatHHMM(acts[j].start)}-${formatHHMM(acts[j].end)}` });
    }
  }
  return v;
}

export { mergeIntervals };
