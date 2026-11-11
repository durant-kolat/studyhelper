"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, RefreshCw, Settings2, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import DayView from "@/components/planner/DayView";
import PlannerWizard from "@/components/planner/PlannerWizard";
import { usePT, weekdayName } from "@/components/planner/usePT";
import { supabase } from "@/lib/supabase";
import { buildDayPlan, addDaysISO, parseDateISO, validateDay } from "@/lib/planner/engine";
import { emptyAnswers } from "@/lib/planner/defaults";
import { parseHHMM } from "@/lib/planner/time";
import type { Answers, Problem, Suggestion } from "@/lib/planner/types";
import {
  loadAnswers, loadDay, loadRange, replacePending, saveAnswers, setStatus, updateTimes,
  type StoredItem,
} from "@/lib/planner/storage";
import { todayLocalISO } from "@/lib/utils";
import type { PlannerKey } from "@/lib/i18n/planner-strings";

type Mode = "loading" | "empty" | "wizard" | "plan";
type Notice = { problems: Problem[]; suggestions: Suggestion[]; moved: string[]; kept: number };

export default function SchedulePage() {
  const { pt, lang } = usePT();
  const [mode, setMode] = useState<Mode>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [date, setDate] = useState(todayLocalISO());
  const [items, setItems] = useState<StoredItem[]>([]);
  const [week, setWeek] = useState<Record<string, StoredItem[]> | null>(null);
  const [view, setView] = useState<"day" | "week">("day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [nowMin, setNowMin] = useState<number>(() => new Date().getHours() * 60 + new Date().getMinutes());
  const today = todayLocalISO();

  // Horloge locale : indicateurs de respect du planning, et changement de jour pris en compte.
  useEffect(() => {
    const t = setInterval(() => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()), 60000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async (uid: string, d: string) => {
    const r = await loadDay(uid, d);
    if (r.error) setError(pt("err.load")); else setError(null);
    setItems(r.items);
    return r.items;
  }, [pt]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { setMode("empty"); return; }
      setUserId(data.user.id);
      const [saved, day] = await Promise.all([loadAnswers(data.user.id), loadDay(data.user.id, todayLocalISO())]);
      setAnswers(saved);
      setItems(day.items);
      if (day.error) setError(pt("err.load"));
      setMode(day.items.length > 0 ? "plan" : "empty");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = useCallback(async (a: Answers, forcedDates?: string[]) => {
    if (!userId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (!(await saveAnswers(userId, a))) { setError(pt("err.save")); return; }
      setAnswers(a);
      const start = today;
      const dates = forcedDates ?? (a.planType === "tomorrow" ? [addDaysISO(start, 1)]
        : a.planType === "week" || a.planType === "exam_special" ? Array.from({ length: 7 }, (_, i) => addDaysISO(start, i)) : [start]);

      const allProblems: Problem[] = []; const allSugg: Suggestion[] = []; const moved: string[] = []; let kept = 0;
      for (const d of dates) {
        const existing = (await loadDay(userId, d)).items;
        const locked = existing.filter((x) => x.status !== "todo");
        const pending = existing.filter((x) => x.status === "todo");
        const plan = buildDayPlan(a, d, { locked });
        const violations = validateDay(plan, a);
        if (violations.length > 0) { console.error("[planning] incohérence", d, violations); setError(pt("err.invalid")); return; }
        const fresh = plan.activities.filter((x) => !locked.includes(x as StoredItem));
        const changed = pending.filter((p) => p.isStudy && !fresh.some((f) => f.start === p.start && f.end === p.end && f.subject === p.subject));
        if (!(await replacePending(userId, d, fresh, pending.map((p) => p.id)))) { setError(pt("err.save")); return; }
        kept += locked.filter((l) => l.isStudy).length;
        if (d === dates[0] || dates.length === 1) { allProblems.push(...plan.problems); allSugg.push(...plan.suggestions); }
        for (const c of changed) moved.push(`${c.subject ?? c.title} ${formatT(c.start)}`);
      }
      setNotice({ problems: allProblems, suggestions: allSugg, moved: moved.slice(0, 8), kept });
      const first = dates[0];
      setDate(first);
      await refresh(userId, first);
      if (dates.length > 1) setWeek(await loadRange(userId, dates[0], dates[dates.length - 1])); else setWeek(null);
      setView("day");
      setMode("plan");
    } finally { setBusy(false); }
  }, [userId, today, pt, refresh]);

  async function openWeek() {
    if (!userId) return;
    setBusy(true);
    setWeek(await loadRange(userId, today, addDaysISO(today, 6)));
    setView("week"); setBusy(false);
  }
  async function pickDay(d: string) {
    if (!userId) return;
    setDate(d); await refresh(userId, d); setView("day");
  }

  async function changeStatus(it: StoredItem, status: "todo" | "in_progress" | "done") {
    if (!userId) return;
    const prev = items;
    setItems(items.map((x) => (x.id === it.id ? { ...x, status, startedAt: status === "in_progress" ? new Date().toISOString() : status === "todo" ? null : x.startedAt } : x)));
    if (!(await setStatus(userId, it, status))) { setItems(prev); setError(pt("err.update")); return; }
    await refresh(userId, date); // relit la vérité enregistrée (durée réelle, etc.)
  }

  const bounds = useMemo(() => ({ wake: parseHHMM(answers?.wakeTime), bed: parseHHMM(answers?.bedTime) }), [answers]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(today, i)), [today]);
  const dayLabel = (d: string) => `${weekdayName(lang, parseDateISO(d).getDay())} ${parseDateISO(d).getDate()}`;

  return (
    <AppShell active="schedule" title={pt("page.title")}>
      {mode === "loading" && (
        <p className="flex items-center gap-2 text-sm text-slate"><Loader2 size={15} className="animate-spin" /> {pt("loading")}</p>
      )}

      {error && <p role="alert" className="mb-4 rounded-card border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {mode === "empty" && (
        <div className="mx-auto max-w-md rounded-card border border-dashed border-mist bg-white p-8 text-center">
          <CalendarDays className="mx-auto mb-3 text-clay" size={36} />
          <p className="font-display text-lg text-ink">{pt("empty.title")}</p>
          <p className="mt-1 text-sm text-slate">{pt("empty.text")}</p>
          <button type="button" onClick={() => setMode("wizard")} className="mt-5 inline-flex items-center gap-2 rounded-card bg-ink px-4 py-2.5 text-sm text-paper">
            <Sparkles size={15} /> {pt("empty.cta")}
          </button>
        </div>
      )}

      {mode === "wizard" && (
        <PlannerWizard initial={answers ?? emptyAnswers()} busy={busy} onGenerate={(a) => generate(a)} onCancel={items.length > 0 ? () => setMode("plan") : answers ? () => setMode("empty") : undefined} />
      )}

      {mode === "plan" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setView("day"); pickDay(today); }} className={`rounded-card px-3 py-1.5 text-sm ${view === "day" ? "bg-ink text-paper" : "border border-mist text-ink"}`}>{pt("actions.day")}</button>
            <button type="button" onClick={openWeek} className={`rounded-card px-3 py-1.5 text-sm ${view === "week" ? "bg-ink text-paper" : "border border-mist text-ink"}`}>{pt("actions.week")}</button>
            <span className="flex-1" />
            {answers && (
              <button type="button" disabled={busy} onClick={() => generate(answers, [date])} className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-sm text-ink disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {pt("actions.regenerate")}</button>
            )}
            <button type="button" onClick={() => setMode("wizard")} className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-sm text-ink"><Settings2 size={14} /> {pt("actions.edit")}</button>
          </div>

          {notice && (notice.problems.length > 0 || notice.moved.length > 0 || notice.kept > 0) && (
            <div className="space-y-2 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
              {notice.problems.map((p, i) => <p key={i}>{pt(`prob.${p.code}` as PlannerKey, p.vars)}</p>)}
              {notice.suggestions.length > 0 && (
                <ul className="list-disc pl-5">{notice.suggestions.map((s, i) => <li key={i}>{pt(`sugg.${s.code}` as PlannerKey, s.vars)}</li>)}</ul>
              )}
              {notice.kept > 0 && <p>{pt("regen.kept", { n: notice.kept })}</p>}
              {notice.moved.length > 0 && <p>{pt("regen.moved", { list: notice.moved.join(", ") })}</p>}
            </div>
          )}

          {view === "day" ? (
            <>
              {date !== today && <p className="text-sm text-slate">{dayLabel(date)} · {date}</p>}
              <DayView items={items} nowMin={date === today ? nowMin : null} bounds={bounds}
                onStart={(i) => changeStatus(i, "in_progress")} onDone={(i) => changeStatus(i, "done")} onUndo={(i) => changeStatus(i, "todo")}
                onEditTimes={async (i, s, e) => { if (!userId) return false; const ok = await updateTimes(userId, i.id, s, e); if (ok) await refresh(userId, date); return ok; }} />
              {items.length === 0 && <p className="text-sm text-slate">{pt("week.noPlan")}</p>}
            </>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <p className="md:col-span-2 text-sm text-slate">{pt("week.title", { date: today })}</p>
              {weekDates.map((d) => {
                const list = (week?.[d] ?? []).filter((x) => x.isStudy && x.kind === "study");
                const done = list.filter((x) => x.status === "done").length;
                return (
                  <button key={d} type="button" onClick={() => pickDay(d)} className="rounded-card border border-mist bg-white p-3 text-left hover:border-slate">
                    <p className="mb-1 text-sm font-medium capitalize text-ink">{dayLabel(d)}</p>
                    {list.length === 0 ? <p className="text-xs text-slate">{pt("week.noPlan")}</p> : (
                      <>
                        <ul className="space-y-0.5 text-xs text-slate">
                          {list.map((x) => <li key={x.id} className={x.status === "done" ? "line-through" : ""}>{formatT(x.start)}–{formatT(x.end)} · {x.subject}</li>)}
                        </ul>
                        <p className="mt-1 text-xs text-clay">{pt("progress.done", { n: done })} / {list.length}</p>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function formatT(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
