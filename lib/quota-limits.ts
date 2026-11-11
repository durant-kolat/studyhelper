// Limites quotidiennes d'utilisation de l'IA — SOURCE UNIQUE, sans dépendance :
// lue par le serveur (qui applique réellement la limite, cf. lib/rate-limit.ts) et
// par le navigateur (simple affichage : il ne peut pas modifier son quota).

export type UsageKind =
  | "assistant"
  | "analyze"
  | "generate-exam"
  | "generate-quiz"
  | "career-cv"
  | "career-letter"
  | "career-interview"
  | "career-orientation"
  | "visual"
  | "vision"
  | "practice"
  | "translate"
  // Professeur IA (v2.9) : 1 « séance » = 1 unité, quel que soit le nombre d'échanges.
  | "tutor"
  | "voice-session"
  | "summary"
  // Correction d'examen (v2.9) : analyse pédagogique IA d'un résultat (1 unité) et chat par question (1 unité par message).
  | "exam-analysis"
  | "exam-chat"
  // Correction IA de la Partie B (questions rédigées / à schéma) : 1 unité par examen corrigé.
  | "exam-grading";

export const FREE_LIMITS: Record<UsageKind, number> = {
  assistant: 5,
  analyze: 5,
  "generate-exam": 3,
  "generate-quiz": 2,
  "career-cv": 2,
  "career-letter": 2,
  "career-interview": 5,
  "career-orientation": 2,
  visual: 3,
  vision: 3,
  practice: 10,
  translate: 5,
  // Essai gratuit des nouvelles fonctions (valeur proposée, à valider).
  tutor: 2,
  "voice-session": 2,
  summary: 2,
  "exam-analysis": 3,
  "exam-chat": 15,
  "exam-grading": 3,
};

export const PREMIUM_LIMITS: Record<UsageKind, number> = {
  assistant: 100,
  analyze: 50,
  "generate-exam": 20,
  "generate-quiz": 10,
  "career-cv": 10,
  "career-letter": 10,
  "career-interview": 30,
  "career-orientation": 10,
  visual: 30,
  vision: 30,
  practice: 100,
  translate: 50,
  tutor: 10,
  "voice-session": 10,
  summary: 10,
  "exam-analysis": 30,
  "exam-chat": 150,
  "exam-grading": 30,
};

/**
 * Libellé d'usage affiché dans l'assistant : « Gratuit - Questions IA : 2 / 5 utilisées - 3 restantes ».
 * Chiffres fournis par le serveur ; ici on ne fait que les mettre en forme (singulier « 1 restante », « 0 restante »).
 */
export function formatUsageLabel(u: { isPremium: boolean; used: number; limit: number; remaining: number }): string {
  const left = `${u.remaining} restante${u.remaining > 1 ? "s" : ""}`;
  return `${u.isPremium ? "Premium" : "Gratuit"} - Questions IA : ${u.used} / ${u.limit} utilisées - ${left}`;
}
