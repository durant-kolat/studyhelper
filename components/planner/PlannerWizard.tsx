"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { missingRequired, type MissingField } from "@/lib/planner/defaults";
import { parseHHMM } from "@/lib/planner/time";
import type { Answers, ExamInput, Goal, HomeworkInput, Mastery, PlanType, Priority, SubjectInput, TimeRange } from "@/lib/planner/types";
import { durationLabel, usePT, weekdayName } from "./usePT";

const GOALS: Goal[] = ["exam", "week_courses", "grades", "gaps", "contest", "organize"];
const MASTERIES: Mastery[] = ["very_hard", "hard", "medium", "good", "excellent"];
const PRIORITIES: Priority[] = ["high", "medium", "low"];
const PLAN_TYPES: PlanType[] = ["today", "tomorrow", "week", "exam_special"];
const DURATIONS = [30, 60, 120, 180, 240];
const STEPS = ["goal", "school", "personal", "subjects", "exams", "activities", "duration", "prefs", "type"] as const;
type StepId = (typeof STEPS)[number];
const OPTIONAL: StepId[] = ["exams", "activities"];

const input = "w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink";
const chip = (on: boolean) =>
  `rounded-card border px-3 py-2 text-left text-sm transition ${on ? "border-ink bg-ink text-paper" : "border-mist bg-white text-ink hover:border-slate"}`;

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-sm text-slate">{children}</label>;
}

function RangeList({ list, onChange, addLabel, withLabel = true }: { list: TimeRange[]; onChange: (l: TimeRange[]) => void; addLabel: string; withLabel?: boolean }) {
  const { pt } = usePT();
  const set = (i: number, patch: Partial<TimeRange>) => onChange(list.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {list.map((r, i) => {
        const bad = r.start && r.end && (parseHHMM(r.end) ?? 0) <= (parseHHMM(r.start) ?? 0);
        return (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="w-28"><span className="text-xs text-slate">{pt("wizard.from")}</span>
              <input type="time" className={input} value={r.start} onChange={(e) => set(i, { start: e.target.value })} /></div>
            <div className="w-28"><span className="text-xs text-slate">{pt("wizard.to")}</span>
              <input type="time" className={`${input} ${bad ? "border-red-400" : ""}`} value={r.end} onChange={(e) => set(i, { end: e.target.value })} /></div>
            {withLabel && (
              <div className="min-w-[8rem] flex-1"><span className="text-xs text-slate">{pt("wizard.label")}</span>
                <input className={input} value={r.label ?? ""} onChange={(e) => set(i, { label: e.target.value })} /></div>
            )}
            <button type="button" aria-label={pt("wizard.remove")} onClick={() => onChange(list.filter((_, k) => k !== i))} className="rounded-card p-2 text-slate hover:text-red-600"><Trash2 size={16} /></button>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...list, { start: "", end: "", label: "" }])} className="flex items-center gap-1 text-sm text-clay"><Plus size={15} /> {addLabel}</button>
    </div>
  );
}

export default function PlannerWizard({ initial, onGenerate, onCancel, busy }: { initial: Answers; onGenerate: (a: Answers) => void; onCancel?: () => void; busy: boolean }) {
  const { pt, lang } = usePT();
  const [a, setA] = useState<Answers>(initial);
  const [step, setStep] = useState(0);
  const set = (patch: Partial<Answers>) => setA((p) => ({ ...p, ...patch }));
  const summary = step >= STEPS.length;
  const id: StepId | null = summary ? null : STEPS[step];
  const missing = useMemo(() => missingRequired(a), [a]);
  const subjectNames = a.subjects.map((s) => s.name.trim()).filter(Boolean);

  const updateSubject = (i: number, patch: Partial<SubjectInput>) => set({ subjects: a.subjects.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const toggleDay = (d: number) => {
    const on = a.classDays.includes(d);
    set({ classDays: on ? a.classDays.filter((x) => x !== d) : [...a.classDays, d].sort(), classHours: on ? a.classHours : { ...a.classHours, [d]: a.classHours[d] ?? [{ start: "", end: "" }] } });
  };

  // Étape suivante bloquée tant que l'étape n'a pas ses informations indispensables.
  const stepOk = (s: StepId | null): boolean => {
    if (s === "goal") return !!a.goal;
    if (s === "personal") return !!a.wakeTime && !!a.bedTime && (a.classDays.length === 0 || !!a.returnTime);
    if (s === "subjects") return subjectNames.length > 0;
    if (s === "duration") return a.dailyMinutes > 0;
    if (s === "type") return !!a.planType;
    if (s === "school") return a.classDays.every((d) => (a.classHours[d] ?? []).some((r) => r.start && r.end && (parseHHMM(r.end) ?? 0) > (parseHHMM(r.start) ?? 0)));
    return true;
  };

  const progress = Math.round((Math.min(step, STEPS.length) / STEPS.length) * 100);
  const stepTitle = id ? pt(`step.${id}` as const) : pt("summary.title");

  return (
    <div className="mx-auto max-w-2xl rounded-card border border-mist bg-white p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between text-xs text-slate">
        <span>{summary ? pt("summary.title") : pt("wizard.step", { n: step + 1, total: STEPS.length })}</span>
        {id && OPTIONAL.includes(id) && <span>{pt("wizard.optional")}</span>}
      </div>
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-clay transition-all" style={{ width: `${summary ? 100 : progress}%` }} />
      </div>
      <h2 className="mb-4 font-display text-lg text-ink">{stepTitle}</h2>

      {id === "goal" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {GOALS.map((g) => <button key={g} type="button" className={chip(a.goal === g)} onClick={() => set({ goal: g })}>{pt(`goal.${g}` as const)}</button>)}
        </div>
      )}

      {id === "school" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>{pt("school.level")}</Label><input className={input} value={a.level} onChange={(e) => set({ level: e.target.value })} /></div>
            <div><Label>{pt("school.className")}</Label><input className={input} value={a.className} onChange={(e) => set({ className: e.target.value })} /></div>
          </div>
          <div>
            <Label>{pt("school.classDays")}</Label>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" className={chip(a.classDays.includes(d))} onClick={() => toggleDay(d)}>{weekdayName(lang, d)}</button>
              ))}
            </div>
            {a.classDays.length === 0 && <p className="mt-2 text-xs text-slate">{pt("school.noClassDays")}</p>}
          </div>
          {a.classDays.length > 0 && (
            <div className="space-y-4">
              <Label>{pt("school.classHours")}</Label>
              {a.classDays.map((d) => (
                <div key={d} className="rounded-card border border-mist p-3">
                  <p className="mb-2 text-sm font-medium capitalize text-ink">{weekdayName(lang, d)}</p>
                  <RangeList list={a.classHours[d] ?? []} onChange={(l) => set({ classHours: { ...a.classHours, [d]: l } })} addLabel={pt("school.addClass")} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {id === "personal" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>{pt("personal.wake")}</Label><input type="time" className={input} value={a.wakeTime} onChange={(e) => set({ wakeTime: e.target.value })} /></div>
          <div><Label>{pt("personal.bed")}</Label><input type="time" className={input} value={a.bedTime} onChange={(e) => set({ bedTime: e.target.value })} /></div>
          <div><Label>{pt("personal.prep")}</Label><input type="number" min={0} max={240} className={input} value={a.prepMinutes || ""} onChange={(e) => set({ prepMinutes: Math.max(0, Number(e.target.value) || 0) })} /></div>
          {a.classDays.length > 0 && (<>
            <div><Label>{pt("personal.departure")}</Label><input type="time" className={input} value={a.departureTime} onChange={(e) => set({ departureTime: e.target.value })} /></div>
            <div><Label>{pt("personal.travel")}</Label><input type="number" min={0} max={300} className={input} value={a.travelMinutes || ""} onChange={(e) => set({ travelMinutes: Math.max(0, Number(e.target.value) || 0) })} /></div>
            <div><Label>{pt("personal.return")}</Label><input type="time" className={input} value={a.returnTime} onChange={(e) => set({ returnTime: e.target.value })} /></div>
          </>)}
          <div className="sm:col-span-2"><Label>{pt("personal.unavailable")}</Label>
            <RangeList list={a.unavailable} onChange={(l) => set({ unavailable: l })} addLabel={pt("wizard.addRange")} /></div>
        </div>
      )}

      {id === "subjects" && (
        <div className="space-y-4">
          {a.subjects.map((s, i) => (
            <div key={i} className="space-y-3 rounded-card border border-mist p-3">
              <div className="flex gap-2">
                <input className={input} placeholder={pt("subjects.name")} value={s.name} onChange={(e) => updateSubject(i, { name: e.target.value })} />
                <button type="button" aria-label={pt("wizard.remove")} onClick={() => set({ subjects: a.subjects.filter((_, k) => k !== i), prioritySubjects: a.prioritySubjects.filter((n) => n !== s.name) })} className="p-2 text-slate hover:text-red-600"><Trash2 size={16} /></button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>{pt("subjects.mastery")}</Label>
                  <select className={input} value={s.mastery} onChange={(e) => updateSubject(i, { mastery: e.target.value as Mastery })}>
                    {MASTERIES.map((m) => <option key={m} value={m}>{pt(`mastery.${m}` as const)}</option>)}</select></div>
                <div><Label>{pt("subjects.priority")}</Label>
                  <select className={input} value={s.priority} onChange={(e) => updateSubject(i, { priority: e.target.value as Priority })}>
                    {PRIORITIES.map((m) => <option key={m} value={m}>{pt(`priority.${m}` as const)}</option>)}</select></div>
                <div><Label>{pt("subjects.chapters")}</Label><input className={input} value={s.chapters} onChange={(e) => updateSubject(i, { chapters: e.target.value })} /></div>
                <div><Label>{pt("subjects.exercises")}</Label><input className={input} value={s.exercises} onChange={(e) => updateSubject(i, { exercises: e.target.value })} /></div>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => set({ subjects: [...a.subjects, { name: "", mastery: "medium", chapters: "", exercises: "", priority: "medium" }] })} className="flex items-center gap-1 text-sm text-clay"><Plus size={15} /> {pt("subjects.add")}</button>
        </div>
      )}

      {id === "exams" && (
        <div className="space-y-5">
          <p className="text-sm text-slate">{pt("exams.help")}</p>
          <div className="space-y-2">
            {a.exams.map((ex, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1"><Label>{pt("exams.subject")}</Label>
                  <select className={input} value={ex.subject} onChange={(e) => set({ exams: a.exams.map((x, k) => (k === i ? { ...x, subject: e.target.value } : x)) })}>
                    <option value="">{pt("exams.pickSubject")}</option>{subjectNames.map((n) => <option key={n}>{n}</option>)}</select></div>
                <div><Label>{pt("exams.date")}</Label><input type="date" className={input} value={ex.date} onChange={(e) => set({ exams: a.exams.map((x, k) => (k === i ? { ...x, date: e.target.value } as ExamInput : x)) })} /></div>
                <button type="button" aria-label={pt("wizard.remove")} onClick={() => set({ exams: a.exams.filter((_, k) => k !== i) })} className="p-2 text-slate hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ))}
            <button type="button" onClick={() => set({ exams: [...a.exams, { subject: "", date: "" }] })} className="flex items-center gap-1 text-sm text-clay"><Plus size={15} /> {pt("exams.addExam")}</button>
          </div>
          <div className="space-y-2">
            {a.homework.map((h, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1"><Label>{pt("exams.subject")}</Label>
                  <select className={input} value={h.subject} onChange={(e) => set({ homework: a.homework.map((x, k) => (k === i ? { ...x, subject: e.target.value } : x)) })}>
                    <option value="">{pt("exams.pickSubject")}</option>{subjectNames.map((n) => <option key={n}>{n}</option>)}</select></div>
                <div className="min-w-[8rem] flex-1"><Label>{pt("exams.hwTitle")}</Label><input className={input} value={h.title} onChange={(e) => set({ homework: a.homework.map((x, k) => (k === i ? { ...x, title: e.target.value } as HomeworkInput : x)) })} /></div>
                <div><Label>{pt("exams.due")}</Label><input type="date" className={input} value={h.due} onChange={(e) => set({ homework: a.homework.map((x, k) => (k === i ? { ...x, due: e.target.value } : x)) })} /></div>
                <button type="button" aria-label={pt("wizard.remove")} onClick={() => set({ homework: a.homework.filter((_, k) => k !== i) })} className="p-2 text-slate hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ))}
            <button type="button" onClick={() => set({ homework: [...a.homework, { subject: "", title: "", due: "" }] })} className="flex items-center gap-1 text-sm text-clay"><Plus size={15} /> {pt("exams.addHomework")}</button>
          </div>
        </div>
      )}

      {id === "activities" && (
        <div className="space-y-5">
          <p className="text-sm text-slate">{pt("act.help")}</p>
          <div><Label>{pt("act.meals")}</Label><RangeList list={a.mealBreaks} onChange={(l) => set({ mealBreaks: l })} addLabel={pt("wizard.addRange")} /></div>
          <div><Label>{pt("act.prayer")}</Label><RangeList list={a.prayerTimes} onChange={(l) => set({ prayerTimes: l })} addLabel={pt("wizard.addRange")} /></div>
          <div><Label>{pt("act.rest")}</Label><RangeList list={a.restTimes} onChange={(l) => set({ restTimes: l })} addLabel={pt("wizard.addRange")} /></div>
          <div><Label>{pt("act.commitments")}</Label><RangeList list={a.otherCommitments} onChange={(l) => set({ otherCommitments: l })} addLabel={pt("wizard.addRange")} /></div>
        </div>
      )}

      {id === "duration" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DURATIONS.map((d) => <button key={d} type="button" className={chip(a.dailyMinutes === d)} onClick={() => set({ dailyMinutes: d })}>{durationLabel(d)}</button>)}
          </div>
          <div><Label>{pt("duration.custom")}</Label>
            <input type="number" min={15} max={720} className={input} value={DURATIONS.includes(a.dailyMinutes) ? "" : a.dailyMinutes || ""} onChange={(e) => set({ dailyMinutes: Math.min(720, Math.max(0, Number(e.target.value) || 0)) })} /></div>
        </div>
      )}

      {id === "prefs" && (
        <div className="space-y-4">
          <div><Label>{pt("prefs.part")}</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["morning", "afternoon", "evening", "none"] as const).map((p) => <button key={p} type="button" className={chip(a.preferredPart === p)} onClick={() => set({ preferredPart: p })}>{pt(`part.${p}` as const)}</button>)}
            </div></div>
          <div><Label>{pt("prefs.session")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["short", "mixed", "long"] as const).map((p) => <button key={p} type="button" className={chip(a.sessionLength === p)} onClick={() => set({ sessionLength: p })}>{pt(`session.${p}` as const)}</button>)}
            </div></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>{pt("prefs.breakEvery")}</Label><input type="number" min={15} max={180} className={input} value={a.breakEvery} onChange={(e) => set({ breakEvery: Math.max(15, Number(e.target.value) || 45) })} /></div>
            <div><Label>{pt("prefs.breakMinutes")}</Label><input type="number" min={0} max={60} className={input} value={a.breakMinutes} onChange={(e) => set({ breakMinutes: Math.max(0, Number(e.target.value) || 0) })} /></div>
          </div>
          {subjectNames.length > 0 && (
            <div><Label>{pt("prefs.priority")}</Label>
              <div className="flex flex-wrap gap-2">
                {subjectNames.map((n) => {
                  const on = a.prioritySubjects.includes(n);
                  return <button key={n} type="button" className={chip(on)} onClick={() => set({ prioritySubjects: on ? a.prioritySubjects.filter((x) => x !== n) : [...a.prioritySubjects, n] })}>{n}</button>;
                })}
              </div></div>
          )}
        </div>
      )}

      {id === "type" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {PLAN_TYPES.map((p) => <button key={p} type="button" className={chip(a.planType === p)} onClick={() => set({ planType: p })}>{pt(`type.${p}` as const)}</button>)}
        </div>
      )}

      {summary && (
        <div className="space-y-3 text-sm">
          <dl className="divide-y divide-mist rounded-card border border-mist">
            {[
              [pt("step.goal"), a.goal ? pt(`goal.${a.goal}` as const) : ""],
              [pt("school.level"), [a.level, a.className].filter(Boolean).join(" · ")],
              [pt("school.classDays"), a.classDays.map((d) => `${weekdayName(lang, d)} (${(a.classHours[d] ?? []).filter((r) => r.start && r.end).map((r) => `${r.start}–${r.end}`).join(", ")})`).join(" · ")],
              [pt("personal.wake"), a.wakeTime],
              [pt("personal.bed"), a.bedTime],
              [pt("personal.departure"), a.classDays.length ? a.departureTime : ""],
              [pt("personal.return"), a.classDays.length ? a.returnTime : ""],
              [pt("personal.unavailable"), a.unavailable.filter((r) => r.start && r.end).map((r) => `${r.start}–${r.end}`).join(", ")],
              [pt("step.subjects"), a.subjects.filter((s) => s.name.trim()).map((s) => `${s.name} (${pt(`mastery.${s.mastery}` as const)})`).join(", ")],
              [pt("step.exams"), [...a.exams.filter((e) => e.subject && e.date).map((e) => `${e.subject} ${e.date}`), ...a.homework.filter((h) => h.title && h.due).map((h) => `${h.title} ${h.due}`)].join(", ")],
              [pt("step.activities"), [...a.mealBreaks, ...a.prayerTimes, ...a.restTimes, ...a.otherCommitments].filter((r) => r.start && r.end).map((r) => `${r.label || ""} ${r.start}–${r.end}`.trim()).join(", ")],
              [pt("summary.studyPerDay"), a.dailyMinutes ? durationLabel(a.dailyMinutes) : ""],
              [pt("prefs.part"), pt(`part.${a.preferredPart}` as const)],
              [pt("step.type"), a.planType ? pt(`type.${a.planType}` as const) : ""],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
                <dt className="w-44 shrink-0 text-slate">{k}</dt>
                <dd className="text-ink">{v || <span className="text-slate/60">{pt("summary.notSet")}</span>}</dd>
              </div>
            ))}
          </dl>
          {missing.length > 0 && (
            <div role="alert" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <p className="mb-1 font-medium">{pt("summary.missing")}</p>
              <ul className="list-disc pl-5">{missing.map((m: MissingField) => <li key={m}>{pt(`missing.${m}` as const)}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <button type="button" disabled={step === 0 && !onCancel} onClick={() => (step === 0 ? onCancel?.() : setStep(step - 1))}
          className="flex items-center gap-1 rounded-card border border-mist px-3 py-2 text-sm text-slate disabled:opacity-40">
          <ChevronLeft size={15} /> {pt("wizard.back")}
        </button>
        <div className="flex gap-2">
          {id && OPTIONAL.includes(id) && (
            <button type="button" onClick={() => setStep(step + 1)} className="rounded-card px-3 py-2 text-sm text-slate underline">{pt("wizard.skip")}</button>
          )}
          {summary ? (
            <>
              <button type="button" onClick={() => setStep(0)} className="rounded-card border border-mist px-3 py-2 text-sm text-ink">{pt("summary.edit")}</button>
              <button type="button" disabled={missing.length > 0 || busy} onClick={() => onGenerate(a)} className="rounded-card bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">
                {busy ? pt("state.generating") : pt("summary.generate")}</button>
            </>
          ) : (
            <button type="button" disabled={!stepOk(id)} onClick={() => setStep(step + 1)} className="flex items-center gap-1 rounded-card bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">
              {pt("wizard.next")} <ChevronRight size={15} /></button>
          )}
        </div>
      </div>
    </div>
  );
}
