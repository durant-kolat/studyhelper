export function formatMinutes(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m}`;
}

export function scoreColor(percent: number) {
  if (percent >= 80) return "text-forest";
  if (percent >= 60) return "text-gold";
  return "text-clay";
}

export function relativeDate(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "la semaine dernière";
  return `il y a ${weeks} semaines`;
}

/**
 * Date du jour au format YYYY-MM-DD, dans le fuseau LOCAL du navigateur
 * — pas `new Date().toISOString().slice(0,10)`, qui donne la date UTC
 * et peut être décalée d'un jour selon le fuseau (ex : 23h locale un
 * lundi peut déjà être mardi en UTC). Le planning est généré et affiché
 * en heure locale, donc "aujourd'hui" doit l'être aussi.
 */
export function todayLocalISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
