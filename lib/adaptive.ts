// Difficulté adaptative de Study Helper AI — logique pure (aucune
// dépendance), donc utilisable côté navigateur ET côté serveur, et
// testable isolément.
//
// Principe (cahier des charges §14) :
//  - l'élève réussit → on augmente PROGRESSIVEMENT (2 réussites de suite) ;
//  - l'élève échoue → on redescend tout de suite d'un cran, l'IA
//    réexplique la notion, puis on remonte progressivement ;
//  - réponse partiellement juste → on ne bouge pas.

export const DIFFICULTIES = [
  "facile",
  "intermediaire",
  "avance",
  "expert",
  "examen",
] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/** Les 4 crans que l'adaptation peut parcourir ("examen" est fixe). */
export const ADAPTIVE_LEVELS = [
  "facile",
  "intermediaire",
  "avance",
  "expert",
] as const;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  facile: "Facile",
  intermediaire: "Intermédiaire",
  avance: "Avancé",
  expert: "Expert",
  examen: "Type examen",
};

export type Evaluation = "correct" | "partial" | "wrong";

export type AdaptiveState = {
  level: Difficulty;
  /** Réussites consécutives au niveau actuel. */
  streak: number;
};

export type AdaptiveStep = AdaptiveState & {
  /** Sens du changement de niveau produit par cette évaluation. */
  changed: "up" | "down" | null;
};

/** Nombre de réussites de suite nécessaires pour monter d'un cran. */
export const STREAK_TO_LEVEL_UP = 2;

export function nextAdaptiveState(
  state: AdaptiveState,
  evaluation: Evaluation | null
): AdaptiveStep {
  // "Type examen" est un choix explicite de l'utilisateur : on n'y touche pas.
  const index = ADAPTIVE_LEVELS.indexOf(
    state.level as (typeof ADAPTIVE_LEVELS)[number]
  );
  if (index === -1 || evaluation === null) {
    return { ...state, changed: null };
  }

  if (evaluation === "wrong") {
    if (index > 0) {
      return { level: ADAPTIVE_LEVELS[index - 1], streak: 0, changed: "down" };
    }
    return { level: state.level, streak: 0, changed: null };
  }

  if (evaluation === "partial") {
    return { ...state, changed: null };
  }

  // correct
  const streak = state.streak + 1;
  if (streak >= STREAK_TO_LEVEL_UP && index < ADAPTIVE_LEVELS.length - 1) {
    return { level: ADAPTIVE_LEVELS[index + 1], streak: 0, changed: "up" };
  }
  // Déjà au sommet : on plafonne le compteur pour ne pas l'accumuler.
  return {
    level: state.level,
    streak: Math.min(streak, STREAK_TO_LEVEL_UP),
    changed: null,
  };
}
