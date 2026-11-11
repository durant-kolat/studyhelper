// Heure et date dans le fuseau de l'UTILISATEUR (jamais un fuseau UTC
// imposé). Tout passe par Intl.DateTimeFormat : aucun calcul manuel de
// décalage, donc les changements d'heure d'été/hiver sont gérés.

export const DEFAULT_TIMEZONE = "Africa/Douala";

export function isValidTimezone(timezone: string | null | undefined): timezone is string {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function browserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/** Fuseau enregistré (s'il est valide) → fuseau du navigateur → Africa/Douala. */
export function resolveTimezone(saved: string | null | undefined): string {
  if (isValidTimezone(saved)) return saved;
  return browserTimezone() ?? DEFAULT_TIMEZONE;
}

export type ClockReading = {
  /** 18:46:32 */
  time: string;
  /** 18:46 */
  shortTime: string;
  /** Vendredi 18 septembre 2026 */
  date: string;
};

export function readClock(now: Date, timezone: string): ClockReading {
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);

  const rawDate = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  return {
    time,
    shortTime: time.slice(0, 5),
    date: rawDate.charAt(0).toUpperCase() + rawDate.slice(1),
  };
}
