// ROUTEUR IA — décide quel moteur traite une demande. Module PUR (aucune dépendance).
//
//   PRATIQUE (exercices, entraînement, correction, simulation, quiz…)  → Gemini n°2 (Gemini 3.5 Flash-Lite)
//   Fonctions existantes (cours, explications, révision, chat, analyse…) → Gemini n°1 (inchangé)
//   Demande qui a réellement besoin des deux (expliquer PUIS s'entraîner) → both :
//     Gemini n°1 explique, Gemini n°2 propose la pratique — utilisation complémentaire, jamais en double.
//
// La même question n'est JAMAIS envoyée aux deux moteurs « pour voir ».

export type AiEngine = "gemini" | "gemini2" | "both";
export type AiDomain = "practice" | "explain" | "app_help" | "visual" | "other";

export type RouteInput = {
  /** Mode guidé de l'assistant (chat | question | exercise | series | quiz | revise). */
  mode?: string;
  /** Message libre de l'utilisateur. */
  message?: string;
};

const PRACTICE_MODES = new Set(["question", "exercise", "series", "quiz"]);

// Mots-clés (fr / en / es / pt / de / it) qui signalent une demande de PRATIQUE dans un message libre.
const PRACTICE_RE =
  /\b(exercices?|entra[iî]n\w*|pratiqu\w*|corrig\w*|corrige[rz]?|simulation|simule\w*|mise en situation|mock|practice|exercise|quiz|drill|train me|correct my|check my (answer|work)|ejercicios?|practicar|corrige|pr[aá]tica|exerc[ií]cios?|[uü]bung\w*|[uü]ben|esercizi\w*|allen\w*)\b/i;
// Demande d'explication / de cours dans un message libre.
const EXPLAIN_RE =
  /\b(explique\w*|expliquer|c'est quoi|qu'est-ce que|comprendre|cours|d[ée]finition|explain|what is|how does|explica\w*|erkl[aä]r\w*|spiega\w*)\b/i;
// Question sur l'application elle-même.
const APP_HELP_RE =
  /\b(study helper|l'application|l'appli|cette app|premium|abonnement|paiement|payer|biblioth[eè]que|param[eè]tres?|langue de l'app|changer la langue|mon compte|mon profil|how (do i|to) (pay|change|use|open)|subscription|library|settings)\b/i;
// Demande d'explication visuelle.
const VISUAL_RE =
  /\b(montre[- ]moi|fais(-moi)? un sch[eé]ma|sch[eé]ma|diagramme|explique avec une image|avec une image|illustre\w*|d[ée]montre\w* le ph[eé]nom[eè]ne|show me|diagram|draw|illustrat\w*|mu[eé]strame|zeige mir|mostrami|mostra-me)\b/i;

export function detectDomain(input: RouteInput): AiDomain {
  const mode = input.mode ?? "chat";
  const msg = (input.message ?? "").trim();
  if (PRACTICE_MODES.has(mode)) return "practice";
  if (mode === "revise") return "explain";
  if (!msg) return "other";
  if (VISUAL_RE.test(msg)) return "visual";
  if (APP_HELP_RE.test(msg)) return "app_help";
  if (PRACTICE_RE.test(msg)) return "practice";
  if (EXPLAIN_RE.test(msg)) return "explain";
  return "other";
}

export type RouteDecision = { engine: AiEngine; domain: AiDomain };

/**
 * Choisit le moteur. `gemini2Available` : si Gemini n°2 n'est pas utilisable, la pratique retombe sur
 * Gemini n°1 (l'application reste utilisable ; rien n'est supprimé ni cassé).
 */
export function routeAi(input: RouteInput, gemini2Available = true): RouteDecision {
  const domain = detectDomain(input);
  const msg = input.message ?? "";
  let engine: AiEngine = "gemini";

  if (domain === "practice") {
    // Message qui demande EXPLICITEMENT d'expliquer ET de s'entraîner : usage complémentaire.
    const both = (input.mode ?? "chat") === "chat" && EXPLAIN_RE.test(msg) && PRACTICE_RE.test(msg);
    engine = both ? "both" : "gemini2";
  }
  if (!gemini2Available && engine !== "gemini") engine = "gemini";
  return { engine, domain };
}
