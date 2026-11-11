// Anniversaires et fêtes : logique PURE (sans dépendance), partagée par le serveur (notifications push) et le navigateur (bandeau).
// Règles : (1) tout est FACULTATIF et désactivé par défaut ; (2) aucune date inventée : seulement le jour choisi par l'élève
// et des fêtes à DATE FIXE reconnues ; les fêtes mobiles (Pâques, Aïd…) dépendent d'un calendrier religieux/astronomique : non incluses ;
// (3) la date réelle est évaluée dans le fuseau de l'élève ; (4) une clé par célébration permet l'anti-doublon.

export type CelebrationPrefs = {
  celebrations_enabled?: boolean | null;
  birthday_enabled?: boolean | null;
  birth_month?: number | null;
  birth_day?: number | null;
  feast_enabled?: boolean | null;
  feast_label?: string | null;
  feast_month?: number | null;
  feast_day?: number | null;
  holidays?: string[] | null;
};

export type Holiday = { key: string; label: string; month: number; day: number; message: string };

/** Fêtes à date FIXE (jours fériés du Cameroun et fêtes universelles). Aucune fête mobile. */
export const HOLIDAYS: Holiday[] = [
  { key: "new-year", label: "Nouvel An (1er janvier)", month: 1, day: 1, message: "Bonne année ! Que cette nouvelle année t'apporte réussite, santé et belles découvertes. Continue d'apprendre et de progresser !" },
  { key: "youth-day", label: "Fête de la Jeunesse (11 février)", month: 2, day: 11, message: "Bonne fête de la Jeunesse ! Ton énergie et ta curiosité construisent l'avenir. Continue de te former !" },
  { key: "labour-day", label: "Fête du Travail (1er mai)", month: 5, day: 1, message: "Bonne fête du Travail ! Merci pour tes efforts : chaque révision te rapproche de tes objectifs." },
  { key: "national-day", label: "Fête nationale du Cameroun (20 mai)", month: 5, day: 20, message: "Bonne fête nationale ! Nous te souhaitons une excellente journée et beaucoup de réussite dans tes projets." },
  { key: "assumption", label: "Assomption (15 août)", month: 8, day: 15, message: "Bonne fête de l'Assomption ! Profite bien de cette journée." },
  { key: "christmas", label: "Noël (25 décembre)", month: 12, day: 25, message: "Joyeux Noël ! Que cette journée soit remplie de joie et de paix pour toi et tes proches." },
];

export type DueCelebration = { key: string; kind: "birthday" | "feast" | "holiday"; title: string; body: string };
export type LocalParts = { year: number; month: number; day: number; hour: number };

export const DEFAULT_TIMEZONE = "Africa/Douala";
/** Fenêtre d'envoi : jamais la nuit. Un envoi tardif (cron en retard) reste possible jusqu'à 21 h locale. */
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 21;

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MAX_DAY: Record<number, number> = { 1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
export const isValidMonthDay = (m: unknown, d: unknown): m is number =>
  typeof m === "number" && typeof d === "number" && Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= MAX_DAY[m];

/** Date et heure RÉELLES dans le fuseau IANA de l'élève ; fuseau invalide → fuseau par défaut (jamais d'exception). */
export function localDateParts(now: Date, timeZone: string | null | undefined): LocalParts {
  const make = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = make(timeZone || DEFAULT_TIMEZONE);
  } catch {
    parts = make(DEFAULT_TIMEZONE);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24 };
}

export const isSendWindow = (p: LocalParts) => p.hour >= SEND_FROM_HOUR && p.hour < SEND_UNTIL_HOUR;

/** Un anniversaire/une fête personnelle du 29 février est célébré(e) le 28 février les années non bissextiles. */
function matchesDay(month: number, day: number, p: LocalParts): boolean {
  if (p.month === month && p.day === day) return true;
  return month === 2 && day === 29 && !isLeapYear(p.year) && p.month === 2 && p.day === 28;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Célébrations dues AUJOURD'HUI (date locale `p`). `name` vide → formule neutre : jamais de prénom inventé. */
export function dueCelebrations(prefs: CelebrationPrefs | null | undefined, name: string | null | undefined, p: LocalParts): DueCelebration[] {
  if (!prefs?.celebrations_enabled) return [];
  const who = clean(name, 60);
  const out: DueCelebration[] = [];

  if (prefs.birthday_enabled && isValidMonthDay(prefs.birth_month, prefs.birth_day) && matchesDay(prefs.birth_month, prefs.birth_day as number, p)) {
    out.push({
      key: "birthday",
      kind: "birthday",
      title: who ? `🎂 Joyeux anniversaire, ${who} !` : "🎂 Joyeux anniversaire !",
      body: `Study Helper te souhaite une magnifique journée, pleine de bonheur, de réussite et de nouvelles découvertes. Continue d'apprendre et de progresser !`,
    });
  }
  if (prefs.feast_enabled && isValidMonthDay(prefs.feast_month, prefs.feast_day) && matchesDay(prefs.feast_month, prefs.feast_day as number, p)) {
    out.push({
      key: "feast",
      kind: "feast",
      title: who ? `🎉 Bonne fête, ${who} !` : "🎉 Bonne fête !",
      body: "Nous te souhaitons une excellente journée et beaucoup de réussite dans tes projets.",
    });
  }
  const chosen = new Set(Array.isArray(prefs.holidays) ? prefs.holidays : []);
  for (const h of HOLIDAYS) {
    if (chosen.has(h.key) && h.month === p.month && h.day === p.day) {
      out.push({ key: `holiday:${h.key}`, kind: "holiday", title: `🎉 ${h.label.replace(/\s*\(.*\)$/, "")}`, body: h.message });
    }
  }
  return out;
}
