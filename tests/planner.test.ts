// Tests du moteur de planning (logique PURE). Exécution : npx tsx tests/planner.test.ts
// Ils ne prouvent PAS : l'interface, Supabase réel, les RLS (voir README, section Planning).
import assert from "node:assert/strict";
import { buildDayPlan, validateDay, addDaysISO } from "../lib/planner/engine";
import { parseHHMM, formatHHMM, freeSlots } from "../lib/planner/time";
import type { Answers, SubjectInput } from "../lib/planner/types";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
}

const sub = (name: string, mastery: SubjectInput["mastery"] = "medium", priority: SubjectInput["priority"] = "medium"): SubjectInput =>
  ({ name, mastery, priority, chapters: "", exercises: "" });

function base(over: Partial<Answers> = {}): Answers {
  return {
    goal: "week_courses", level: "Lycée", className: "1ère C",
    classDays: [1, 2, 3, 4, 5],
    classHours: { 1: [{ start: "08:00", end: "12:00" }], 2: [{ start: "08:00", end: "12:00" }], 3: [{ start: "08:00", end: "12:00" }], 4: [{ start: "08:00", end: "12:00" }], 5: [{ start: "08:00", end: "12:00" }] },
    wakeTime: "06:00", bedTime: "22:00", prepMinutes: 45, departureTime: "07:15", travelMinutes: 30, returnTime: "13:00",
    unavailable: [], subjects: [sub("Maths", "very_hard"), sub("Physique", "hard"), sub("Anglais", "good")],
    exams: [], homework: [], mealBreaks: [{ start: "13:00", end: "13:45", label: "Déjeuner" }, { start: "19:30", end: "20:15", label: "Dîner" }],
    prayerTimes: [], restTimes: [], otherCommitments: [], dailyMinutes: 120, preferredPart: "none", sessionLength: "mixed",
    breakEvery: 45, breakMinutes: 10, prioritySubjects: [], planType: "today", ...over,
  };
}
const MON = "2026-10-12"; // lundi
const SAT = "2026-10-17"; // samedi

function check(a: Answers, date: string) {
  const plan = buildDayPlan(a, date);
  assert.deepEqual(validateDay(plan, a), [], "aucune violation");
  for (const x of plan.activities) assert.ok(x.end > x.start, "durée positive");
  return plan;
}
const study = (p: ReturnType<typeof buildDayPlan>) => p.activities.filter((x) => x.kind === "study");

console.log("Utilitaires");
test("parse/format HH:MM", () => { assert.equal(parseHHMM("06:05"), 365); assert.equal(formatHHMM(365), "06:05"); assert.equal(parseHHMM("25:00"), null); });
test("freeSlots retire les plages occupées", () => assert.deepEqual(freeSlots(0, 100, [{ start: 10, end: 20 }, { start: 15, end: 30 }]), [{ start: 0, end: 10 }, { start: 30, end: 100 }]));

console.log("Scénarios obligatoires");
test("cours le matin : aucune révision pendant les cours ni le trajet", () => {
  const p = check(base(), MON);
  for (const s of study(p)) assert.ok(s.end <= 7 * 60 + 15 || s.start >= 13 * 60, `révision ${formatHHMM(s.start)} hors école`);
  assert.equal(p.plannedStudyMinutes, 120);
});
test("cours l'après-midi : révisions le matin et le soir", () => {
  const a = base({ classHours: { 1: [{ start: "13:00", end: "17:00" }] }, classDays: [1], departureTime: "12:15", returnTime: "17:45", mealBreaks: [] });
  const p = check(a, MON);
  for (const s of study(p)) assert.ok(s.end <= 12 * 60 + 15 || s.start >= 17 * 60 + 45);
});
test("cours toute la journée : seulement avant le départ et le soir", () => {
  const a = base({ classHours: { 1: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "17:00" }] }, classDays: [1], returnTime: "18:00", mealBreaks: [] });
  const p = check(a, MON);
  for (const s of study(p)) assert.ok(s.end <= 7 * 60 + 15 || s.start >= 18 * 60);
});
test("week-end sans cours : plus de plages, objectif atteint", () => {
  const p = check(base({ dailyMinutes: 240 }), SAT);
  assert.equal(p.plannedStudyMinutes, 240);
  assert.equal(p.problems.length, 0);
});
test("examen proche : la matière concernée reçoit le plus de temps", () => {
  const a = base({ subjects: [sub("Maths", "good"), sub("Chimie", "good")], exams: [{ subject: "Chimie", date: addDaysISO(SAT, 1) }], dailyMinutes: 180 });
  const p = check(a, SAT);
  const min = (n: string) => study(p).filter((s) => s.subject === n).reduce((t, s) => t + s.end - s.start, 0);
  assert.ok(min("Chimie") > min("Maths"), `${min("Chimie")} vs ${min("Maths")}`);
  assert.ok(min("Maths") >= 20, "l'autre matière n'est pas abandonnée");
});
test("plusieurs matières difficiles : toutes servies, ordre de priorité", () => {
  const a = base({ subjects: [sub("A", "very_hard"), sub("B", "very_hard"), sub("C", "hard"), sub("D", "excellent")], dailyMinutes: 240 });
  const p = check(a, SAT);
  const names = new Set(study(p).map((s) => s.subject));
  for (const n of ["A", "B", "C"]) assert.ok(names.has(n));
});
test("30 minutes seulement : une séance de 30 min", () => {
  const p = check(base({ dailyMinutes: 30 }), SAT);
  assert.equal(p.plannedStudyMinutes, 30);
  assert.equal(study(p).length, 1);
});
test("changement d'heure de réveil : rien avant le nouveau réveil", () => {
  const p = check(base({ wakeTime: "09:30", prepMinutes: 30, classDays: [] }), SAT);
  assert.ok(p.activities.every((x) => x.start >= 9 * 60 + 30));
  const p2 = check(base({ wakeTime: "05:00", classDays: [] }), SAT);
  assert.ok(Math.min(...p2.activities.map((x) => x.start)) >= 5 * 60);
});
test("indisponibilités respectées", () => {
  const a = base({ classDays: [], unavailable: [{ start: "09:00", end: "12:00", label: "Sport" }], dailyMinutes: 180 });
  const p = check(a, SAT);
  for (const s of study(p)) assert.ok(s.end <= 540 || s.start >= 720);
});
test("contraintes incompatibles : pas de planning impossible, problème + solutions", () => {
  const a = base({ classDays: [], unavailable: [{ start: "06:30", end: "21:30" }], dailyMinutes: 180, prepMinutes: 0 });
  const p = check(a, SAT);
  assert.equal(p.plannedStudyMinutes < 180, true);
  assert.ok(p.problems.some((x) => x.code === "time_short" || x.code === "no_time"));
  assert.ok(p.suggestions.length > 0);
});
test("temps demandé trop grand : signalé avec durée réaliste", () => {
  const p = check(base({ dailyMinutes: 600 }), MON);
  const prob = p.problems.find((x) => x.code === "time_short");
  assert.ok(prob);
  assert.ok(p.suggestions.some((x) => x.code === "reduce_daily"));
  assert.ok(p.plannedStudyMinutes <= (prob!.vars!.available as number));
});
test("régénérations répétées : résultat identique (déterministe, pas de doublons)", () => {
  const a = base();
  const p1 = JSON.stringify(buildDayPlan(a, MON).activities);
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(buildDayPlan(a, MON).activities), p1);
});
test("régénération : les séances terminées sont conservées et comptées", () => {
  const a = base({ classDays: [], dailyMinutes: 120 });
  const first = buildDayPlan(a, SAT);
  const done = study(first)[0];
  const again = buildDayPlan(a, SAT, { locked: [done] });
  assert.deepEqual(validateDay(again, a), []);
  assert.ok(again.activities.some((x) => x.start === done.start && x.end === done.end && x.subject === done.subject));
  assert.equal(again.plannedStudyMinutes, 120);
});
test("conflit entre deux repères : écarté et signalé, plan valide", () => {
  const a = base({ classDays: [], mealBreaks: [{ start: "10:00", end: "11:00" }], restTimes: [{ start: "10:30", end: "11:30" }] });
  const p = check(a, SAT);
  assert.ok(p.problems.some((x) => x.code === "conflict"));
});
test("réponses manquantes : aucun planning inventé", () => {
  assert.equal(buildDayPlan(base({ wakeTime: "" }), SAT).activities.length, 0);
  assert.equal(buildDayPlan(base({ subjects: [] }), SAT).activities.length, 0);
  assert.equal(buildDayPlan(base({ dailyMinutes: 0 }), SAT).activities.length, 0);
});
test("sommeil court signalé", () => {
  const p = buildDayPlan(base({ wakeTime: "05:00", bedTime: "00:30" }), SAT);
  assert.ok(p.problems.some((x) => x.code === "sleep_short"));
});
test("balayage : 7 jours × plusieurs profils → aucune violation", () => {
  for (const wake of ["04:30", "06:00", "08:15"]) for (const daily of [30, 60, 120, 240]) for (let d = 0; d < 7; d++) {
    const a = base({ wakeTime: wake, dailyMinutes: daily });
    const p = buildDayPlan(a, addDaysISO(MON, d));
    assert.deepEqual(validateDay(p, a), [], `${wake}/${daily}/J${d}`);
    assert.ok(p.plannedStudyMinutes <= daily);
  }
});

console.log(`\n${passed} tests réussis${process.exitCode ? " — ÉCHECS ci-dessus" : ""}`);
