"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Pencil, Play, Undo2 } from "lucide-react";
import { dayPartOf, formatHHMM, overlaps, parseHHMM, type DayPart } from "@/lib/planner/time";
import type { StoredItem } from "@/lib/planner/storage";
import type { PlannerKey } from "@/lib/i18n/planner-strings";
import { durationLabel, usePT } from "./usePT";

const PARTS: DayPart[] = ["morning", "afternoon", "evening"];
const PART_STYLE: Record<DayPart, string> = {
  morning: "border-amber-200 bg-amber-50/60",
  afternoon: "border-sky-200 bg-sky-50/60",
  evening: "border-indigo-200 bg-indigo-50/60",
};
const PRIORITY_DOT: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-emerald-500" };

export function dayStats(items: StoredItem[], nowMin: number | null) {
  const study = items.filter((i) => i.isStudy && i.kind === "study");
  const done = study.filter((i) => i.status === "done");
  const planned = study.reduce((n, i) => n + (i.end - i.start), 0);
  const doneMin = done.reduce((n, i) => n + (i.end - i.start), 0);
  const measured = done.filter((i) => i.actualMinutes !== null);
  const due = nowMin === null ? [] : study.filter((i) => i.end <= nowMin);
  return {
    total: study.length, done: done.length, remaining: study.length - done.length, planned, doneMin,
    actual: measured.length ? measured.reduce((n, i) => n + (i.actualMinutes ?? 0), 0) : null,
    percent: study.length ? Math.round((done.length / study.length) * 100) : 0,
    adherence: due.length ? Math.round((due.filter((i) => i.status === "done").length / due.length) * 100) : null,
  };
}

type Props = {
  items: StoredItem[];
  nowMin: number | null; // null si le jour affiché n'est pas aujourd'hui
  readOnly?: boolean;
  bounds: { wake: number | null; bed: number | null };
  onStart: (i: StoredItem) => void;
  onDone: (i: StoredItem) => void;
  onUndo: (i: StoredItem) => void;
  onEditTimes: (i: StoredItem, start: number, end: number) => Promise<boolean>;
};

export default function DayView({ items, nowMin, readOnly, bounds, onStart, onDone, onUndo, onEditTimes }: Props) {
  const { pt } = usePT();
  const [editing, setEditing] = useState<string | null>(null);
  const [s, setS] = useState("");
  const [e, setE] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const stats = dayStats(items, nowMin);

  function openEdit(i: StoredItem) { setEditing(i.id); setS(formatHHMM(i.start)); setE(formatHHMM(i.end)); setErr(null); }
  async function saveEdit(i: StoredItem) {
    const start = parseHHMM(s); const end = parseHHMM(e);
    if (start === null || end === null || end <= start) return setErr(pt("edit.endAfterStart"));
    if ((bounds.wake !== null && start < bounds.wake) || (bounds.bed !== null && bounds.bed > (bounds.wake ?? 0) && end > bounds.bed)) return setErr(pt("edit.outside"));
    if (items.some((o) => o.id !== i.id && overlaps(o, { start, end }))) return setErr(pt("edit.overlap"));
    if (await onEditTimes(i, start, end)) setEditing(null); else setErr(pt("err.update"));
  }

  const label = (i: StoredItem) => (i.kind === "study" ? i.subject ?? i.title : i.title || pt(`kind.${i.kind}` as PlannerKey));
  const objective = (i: StoredItem) => {
    if (i.kind !== "study") return "";
    if (i.objectiveKind === "chapter" && i.objective) return pt("obj.chapter", { text: i.objective });
    if (i.objectiveKind === "exercise" && i.objective) return pt("obj.exercise", { text: i.objective });
    if (i.objectiveKind === "homework" && i.objective) return pt("obj.homework", { text: i.objective });
    return pt(i.objectiveKind === "exam" ? "obj.exam" : "obj.general");
  };

  return (
    <div className="space-y-5">
      {stats.total > 0 && (
        <div className="rounded-card border border-mist bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="font-display text-base text-ink">{pt("progress.title")}</p>
            <p className="font-display text-lg text-clay">{stats.percent} %</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={stats.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-clay transition-all" style={{ width: `${stats.percent}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate">
            <span>{pt("progress.done", { n: stats.done })}</span>
            <span>{pt("progress.remaining", { n: stats.remaining })}</span>
            <span>{pt("progress.planned", { t: durationLabel(stats.planned) })}</span>
            {stats.actual !== null && <span>{pt("progress.actual", { t: durationLabel(stats.actual) })}</span>}
            {stats.adherence !== null && <span>{pt("progress.adherence", { p: stats.adherence })}</span>}
          </div>
          {stats.done === stats.total ? (
            <p className="mt-3 rounded-card bg-emerald-50 p-2 text-sm text-emerald-800"><strong>{pt("report.title")} — </strong>{pt("report.great")}</p>
          ) : nowMin !== null && nowMin >= (bounds.bed && bounds.wake !== null && bounds.bed > bounds.wake ? bounds.bed - 60 : 22 * 60) ? (
            <p className="mt-3 rounded-card bg-mist/60 p-2 text-sm text-ink"><strong>{pt("report.title")} — </strong>
              {stats.done === 0 ? pt("report.none") : pt("report.partial", { done: stats.done, total: stats.total })}</p>
          ) : null}
        </div>
      )}

      {PARTS.map((part) => {
        const list = items.filter((i) => dayPartOf(i.start) === part);
        if (list.length === 0) return null;
        return (
          <section key={part} className={`rounded-card border p-3 sm:p-4 ${PART_STYLE[part]}`}>
            <h3 className="mb-3 font-display text-base text-ink">{pt(`section.${part}` as const)}</h3>
            <ul className="space-y-2">
              {list.map((i) => {
                const study = i.isStudy && i.kind === "study";
                const done = i.status === "done";
                const dur = i.end - i.start;
                return (
                  <li key={i.id} className={`rounded-card border bg-white p-3 ${done ? "border-emerald-200 opacity-80" : i.status === "in_progress" ? "border-clay" : "border-mist"}`}>
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <div className="w-28 shrink-0 font-display text-sm text-clay">
                        {formatHHMM(i.start)} – {formatHHMM(i.end)}
                        <div className="text-xs text-slate">{durationLabel(dur)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`flex items-center gap-2 text-sm ${study ? "font-medium text-ink" : "text-slate"} ${done ? "line-through" : ""}`}>
                          {study && <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[i.priority]}`} title={pt(`priority.${i.priority}` as const)} />}
                          <span className="truncate">{label(i)}</span>
                          {i.isExam && study && <span className="rounded bg-red-100 px-1.5 text-[10px] text-red-700">{pt("card.exam")}</span>}
                        </p>
                        {study && <p className="mt-0.5 text-xs text-slate">{objective(i)} · {pt(`priority.${i.priority}` as const)}</p>}
                      </div>
                      {done && <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={14} /> {pt("card.finished")}</span>}
                      {i.status === "in_progress" && <span className="text-xs text-clay">{pt("card.inProgress")}</span>}
                    </div>

                    {study && !readOnly && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {i.status === "todo" && (
                          <button type="button" onClick={() => onStart(i)} className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-slate"><Play size={13} /> {pt("card.start")}</button>
                        )}
                        {!done ? (
                          <button type="button" onClick={() => onDone(i)} className="flex items-center gap-1 rounded-card bg-ink px-3 py-1.5 text-xs text-paper"><Circle size={13} /> {pt("card.done")}</button>
                        ) : (
                          <button type="button" onClick={() => onUndo(i)} className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-slate"><Undo2 size={13} /> {pt("card.undo")}</button>
                        )}
                        {!done && editing !== i.id && (
                          <button type="button" onClick={() => openEdit(i)} className="flex items-center gap-1 rounded-card px-2 py-1.5 text-xs text-slate"><Pencil size={13} /> {pt("card.edit")}</button>
                        )}
                      </div>
                    )}

                    {editing === i.id && (
                      <div className="mt-3 rounded-card border border-mist bg-paper p-3">
                        <p className="mb-2 text-xs font-medium text-ink">{pt("edit.title")}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input type="time" value={s} onChange={(ev) => setS(ev.target.value)} className="rounded-card border border-mist px-2 py-1 text-sm" />
                          <span className="text-slate">–</span>
                          <input type="time" value={e} onChange={(ev) => setE(ev.target.value)} className="rounded-card border border-mist px-2 py-1 text-sm" />
                          <button type="button" onClick={() => saveEdit(i)} className="rounded-card bg-ink px-3 py-1 text-xs text-paper">{pt("edit.save")}</button>
                          <button type="button" onClick={() => setEditing(null)} className="px-2 py-1 text-xs text-slate">{pt("edit.cancel")}</button>
                        </div>
                        {err && <p role="alert" className="mt-2 text-xs text-red-600">{err}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
