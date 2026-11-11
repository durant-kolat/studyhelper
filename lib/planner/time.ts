// Utilitaires horaires PURS pour le planning. Tout est en minutes depuis minuit (0..1439),
// jamais en chaînes comparées au hasard : la comparaison "9:00" > "10:00" était une source de désordre.

export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatHHMM(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export type Interval = { start: number; end: number }; // [start, end[ en minutes

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function sortIntervals<T extends Interval>(list: T[]): T[] {
  return [...list].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Fusionne les intervalles qui se touchent ou se chevauchent. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const i of sortIntervals(list.filter((x) => x.end > x.start))) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Plages libres dans [from, to[ une fois les plages occupées retirées. */
export function freeSlots(from: number, to: number, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = from;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= to) break;
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < to) free.push({ start: cursor, end: to });
  return free.filter((s) => s.end > s.start);
}

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPartOf(startMinutes: number): DayPart {
  if (startMinutes < 12 * 60) return "morning";
  if (startMinutes < 18 * 60) return "afternoon";
  return "evening";
}
