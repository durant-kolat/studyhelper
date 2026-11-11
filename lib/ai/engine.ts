// Moteur IA de la « Pratique » : réglable sans toucher au code. SERVEUR UNIQUEMENT.
//   PRACTICE_ENGINE=gemini  (défaut) → la Pratique utilise Gemini
//   PRACTICE_ENGINE=openai           → la Pratique utilise OpenAI (OPENAI_API_KEY requise)
// Les autres fonctions IA (explications, cours, examens, quiz, carrière…) restent sur Gemini dans les deux cas.

export type PracticeEngine = "gemini" | "openai";

export function practiceEngine(): PracticeEngine {
  const v = (process.env.PRACTICE_ENGINE ?? "").trim().toLowerCase();
  return v === "openai" ? "openai" : "gemini";
}
