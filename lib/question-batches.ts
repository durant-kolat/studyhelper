// Génération de GRANDS examens / quiz (jusqu'à 50 questions) en plusieurs lots indépendants, lancés en parallèle :
// chaque appel IA reste court (≤ 20 questions), donc fiable et rapide, au lieu d'une seule réponse énorme qui risquerait
// d'être coupée ou de dépasser le délai. Logique PURE (sans dépendance).

export const BATCH_SIZE = 20;
export const MAX_TOTAL_QUESTIONS = 50;

/** Répartition équilibrée : 50 → [17, 17, 16] ; 30 → [15, 15] ; 12 → [12]. */
export function planBatches(total: number, size = BATCH_SIZE): number[] {
  const n = Math.max(1, Math.min(MAX_TOTAL_QUESTIONS, Math.floor(total)));
  const k = Math.ceil(n / size);
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Clé de comparaison : insensible à la casse, aux accents, à la ponctuation et aux espaces. */
export function questionKey(q: string): string {
  return q.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
}

/** Fusionne les lots dans l'ordre, retire les doublons (même énoncé), plafonne au total demandé. Un lot échoué (null) est ignoré. */
export function mergeBatches<T extends { question: string }>(batches: (T[] | null | undefined)[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const b of batches) {
    for (const q of b ?? []) {
      const key = questionKey(q.question);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Seuil d'acceptation : un examen de ≤ 20 questions n'a qu'un lot, qui doit réussir en entier (comportement inchangé).
 * Un grand examen est accepté s'il atteint au moins 70 % des questions demandées (et au moins 10) : on ne fait pas
 * échouer 50 questions à cause d'un lot raté, mais on ne livre pas non plus un examen très incomplet.
 */
export function isAcceptable(requested: number, got: number, batchCount: number): boolean {
  if (batchCount <= 1) return got >= Math.min(requested, 1) && got >= requested * 0.8;
  return got >= Math.max(10, Math.ceil(requested * 0.7));
}

/** Consigne de partage : chaque lot traite une portion différente pour éviter les doublons entre appels parallèles. */
export function batchHint(index: number, total: number, size: number): string {
  if (total <= 1) return "";
  return (
    ` Cet ensemble est généré en ${total} lots indépendants ; tu produis le lot ${index + 1} sur ${total} (${size} questions) : ` +
    `couvre prioritairement la portion ${index + 1}/${total} du contenu, choisis des notions différentes de celles que les autres lots traiteront, ` +
    `et aucune de tes questions ne doit ressembler à une autre.`
  );
}
