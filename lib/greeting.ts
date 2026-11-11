// Salutation du tableau de bord. Fonctions PURES : l'heure est celle de l'appareil de l'utilisateur
// (Date locale du navigateur), jamais l'heure UTC du serveur.
export type GreetingPeriod = "morning" | "afternoon" | "evening";

/** 05:00–11:59 matin · 12:00–17:59 après-midi · 18:00–04:59 soir. */
export function greetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/** Prénom affichable : premier mot du nom du profil, ou null (vide, « null », e-mail, identifiant technique). */
export function displayFirstName(fullName: unknown): string | null {
  if (typeof fullName !== "string") return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  if (!first || first.length > 40) return null;
  if (/^(null|undefined|nan)$/i.test(first)) return null;
  if (first.includes("@")) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(first) || /^\d+$/.test(first)) return null;
  return first;
}
