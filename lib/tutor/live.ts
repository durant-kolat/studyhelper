// Décision de l'« appel en direct » avec le professeur — logique PURE (testée), sans dépendance.
// Principe : mains libres, mais JAMAIS de boucle d'appels IA incontrôlée. Chaque appel IA part d'une parole
// de l'élève ; le micro ne s'ouvre que lorsque le professeur a fini de parler (anti-écho) et que plus rien n'est en cours.

export type LiveInput = {
  live: boolean;
  phase: "boot" | "resumePrompt" | "teaching" | "finished" | "error";
  hasExplanation: boolean;
  speaking: boolean;
  busy: boolean;
  listening: boolean;
  /** Le dernier retour était « correct » : le cours attend de passer au paragraphe suivant. */
  advancePending: boolean;
  /** Nombre d'écoutes consécutives sans parole détectée. */
  silenceStreak: number;
};

export type LiveStep = "none" | "continue" | "listen" | "hangup";
export const MAX_SILENCE_STREAK = 2;

export function nextLiveStep(i: LiveInput): LiveStep {
  if (!i.live) return "none";
  if (i.phase !== "teaching" || !i.hasExplanation) return "none";
  if (i.silenceStreak >= MAX_SILENCE_STREAK) return "hangup"; // personne ne répond : on raccroche
  if (i.speaking || i.busy || i.listening) return "none"; // jamais deux choses à la fois (pas d'écho, pas de chevauchement)
  if (i.advancePending) return "continue"; // bonne réponse confirmée à voix haute → paragraphe suivant
  return "listen";
}

const QUESTION_STARTS =
  /^(pourquoi|comment|qu['’ ]est|c['’ ]est quoi|quel(le)?s?\b|peux[- ]tu|pouvez[- ]vous|explique|what|why|how|can you|could you|explain|qu[eé] es|por qu[eé]|c[oó]mo|puedes|o que|por que|como|voc[eê] pode|warum|wie|was ist|kannst du|perch[eé]|come|cosa|puoi|waarom|wat is|kun je)/i;

/**
 * En appel en direct, une phrase PARLÉE qui est visiblement une question est envoyée comme question libre
 * (la position dans le cours ne change pas) au lieu d'être jugée comme réponse. Heuristique volontairement
 * prudente : en cas d'erreur, le professeur répond puis invite à reprendre — rien n'est perdu ni compté faux.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().replace(/^[¿¡\s]+/, ""); // « ¿Qué es… » : retire la ponctuation d'ouverture espagnole
  if (!t) return false;
  if (/[?？؟]\s*$/.test(t)) return true;
  return QUESTION_STARTS.test(t);
}
