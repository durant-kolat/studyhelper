// Accès Supabase du planning. Respecte la RLS : chaque requête est filtrée par owner_id (auth.uid()).
// Colonnes utilisées = celles de supabase/migration-v2.7-smart-planning.sql.
import { supabase } from "@/lib/supabase";
import { formatHHMM, parseHHMM } from "./time";
import { normalizeAnswers } from "./defaults";
import type { Activity, ActivityKind, Answers, Priority } from "./types";

export type ItemStatus = "todo" | "in_progress" | "done";

export type StoredItem = Activity & {
  id: string;
  status: ItemStatus;
  startedAt: string | null;
  completedAt: string | null;
  actualMinutes: number | null;
};

const COLUMNS =
  "id, item_date, start_time, end_time, title, subject, is_exam, kind, priority, objective, objective_kind, is_study, status, started_at, completed_at, actual_minutes, completed";

type Row = {
  id: string; start_time: string | null; end_time: string | null; title: string | null; subject: string | null;
  is_exam: boolean | null; kind: string | null; priority: string | null; objective: string | null; objective_kind: string | null;
  is_study: boolean | null; status: string | null; started_at: string | null; completed_at: string | null;
  actual_minutes: number | null; completed: boolean | null;
};

function rowToItem(r: Row): StoredItem | null {
  const start = parseHHMM(r.start_time);
  const end = parseHHMM(r.end_time);
  if (start === null || end === null || end <= start) return null; // ancienne ligne « repère » sans durée : ignorée à l'affichage
  // `completed` est la source de vérité partagée avec le tableau de bord (qui ne connaît pas `status`).
  const status: ItemStatus = r.completed ? "done" : r.status === "in_progress" ? "in_progress" : "todo";
  return {
    id: r.id, start, end,
    kind: (r.kind as ActivityKind) ?? (r.subject ? "study" : "rest"),
    subject: r.subject, title: r.title ?? r.subject ?? "", objective: r.objective ?? "",
    objectiveKind: (r.objective_kind as Activity["objectiveKind"]) ?? "general",
    priority: (r.priority as Priority) ?? "medium", isExam: !!r.is_exam,
    isStudy: r.is_study ?? !!r.subject,
    status, startedAt: r.started_at, completedAt: r.completed_at, actualMinutes: r.actual_minutes,
  };
}

export async function loadDay(userId: string, dateISO: string): Promise<{ items: StoredItem[]; error: boolean }> {
  const { data, error } = await supabase
    .from("schedule_items").select(COLUMNS)
    .eq("owner_id", userId).eq("item_date", dateISO).order("start_time", { ascending: true });
  if (error) { console.error("[planning] loadDay", error.message); return { items: [], error: true }; }
  const items = ((data ?? []) as Row[]).map(rowToItem).filter((x): x is StoredItem => x !== null);
  items.sort((a, b) => a.start - b.start || a.end - b.end); // tri numérique, jamais sur des chaînes
  return { items, error: false };
}

export async function loadRange(userId: string, fromISO: string, toISO: string): Promise<Record<string, StoredItem[]>> {
  const { data, error } = await supabase
    .from("schedule_items").select(`${COLUMNS}`)
    .eq("owner_id", userId).gte("item_date", fromISO).lte("item_date", toISO);
  const out: Record<string, StoredItem[]> = {};
  if (error) { console.error("[planning] loadRange", error.message); return out; }
  for (const r of (data ?? []) as (Row & { item_date: string })[]) {
    const it = rowToItem(r);
    if (!it) continue;
    (out[r.item_date] ??= []).push(it);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Remplace les activités NON terminées d'un jour par le nouveau calcul, sans doublon :
 * 1) on insère d'abord les nouvelles lignes (si cela échoue, rien n'est perdu),
 * 2) puis on supprime uniquement les anciennes lignes non terminées.
 * Les activités terminées/commencées ne sont jamais touchées.
 */
export async function replacePending(userId: string, dateISO: string, fresh: Activity[], previousPendingIds: string[]): Promise<boolean> {
  const batch = crypto.randomUUID();
  if (fresh.length > 0) {
    const { error } = await supabase.from("schedule_items").insert(
      fresh.map((a) => ({
        owner_id: userId, item_date: dateISO,
        start_time: formatHHMM(a.start), end_time: formatHHMM(a.end),
        title: a.title || a.subject || "", subject: a.subject, is_exam: a.isExam,
        kind: a.kind, priority: a.priority, objective: a.objective, objective_kind: a.objectiveKind,
        is_study: a.isStudy, status: "todo", completed: false, batch_id: batch,
      }))
    );
    if (error) { console.error("[planning] insert", error.message); return false; }
  }
  if (previousPendingIds.length > 0) {
    const { error } = await supabase.from("schedule_items").delete().eq("owner_id", userId).in("id", previousPendingIds);
    if (error) { console.error("[planning] cleanup", error.message); return false; }
  }
  return true;
}

export async function setStatus(userId: string, item: StoredItem, status: ItemStatus): Promise<boolean> {
  const now = new Date();
  const patch: Record<string, unknown> = { status, completed: status === "done" };
  if (status === "in_progress") { patch.started_at = now.toISOString(); patch.completed_at = null; patch.actual_minutes = null; }
  if (status === "done") {
    patch.completed_at = now.toISOString();
    // Durée réellement effectuée : mesurable seulement si l'activité a été « commencée ».
    if (item.startedAt) patch.actual_minutes = Math.max(1, Math.round((now.getTime() - new Date(item.startedAt).getTime()) / 60000));
  }
  if (status === "todo") { patch.started_at = null; patch.completed_at = null; patch.actual_minutes = null; }
  const { error } = await supabase.from("schedule_items").update(patch).eq("id", item.id).eq("owner_id", userId);
  if (error) console.error("[planning] setStatus", error.message);
  return !error;
}

export async function updateTimes(userId: string, id: string, start: number, end: number): Promise<boolean> {
  const { error } = await supabase.from("schedule_items")
    .update({ start_time: formatHHMM(start), end_time: formatHHMM(end) }).eq("id", id).eq("owner_id", userId);
  if (error) console.error("[planning] updateTimes", error.message);
  return !error;
}

export async function loadAnswers(userId: string): Promise<Answers | null> {
  const { data, error } = await supabase.from("schedule_profiles").select("answers").eq("owner_id", userId).maybeSingle();
  if (error) { console.error("[planning] loadAnswers", error.message); return null; }
  return data?.answers ? normalizeAnswers(data.answers) : null;
}

export async function saveAnswers(userId: string, answers: Answers): Promise<boolean> {
  const { error } = await supabase.from("schedule_profiles")
    .upsert({ owner_id: userId, answers, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
  if (error) console.error("[planning] saveAnswers", error.message);
  return !error;
}
