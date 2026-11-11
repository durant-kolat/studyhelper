// Texte LU À VOIX HAUTE pour la correction d'un examen. Logique PURE (sans dépendance).
// La conversion « √2 » → « racine carrée de 2 », les puissances et le découpage en morceaux sont faits ensuite par speak() (lib/voice).
// On ne lit jamais la solution d'un « exercice similaire » : il est fait pour que l'élève essaie d'abord.

export type SpeechQuestion = { index: number; question: string; options: string[]; given: number; correctIndex: number; method: string };
export type SpeechAnalysis = {
  errorExplanation?: string;
  steps?: string[];
  example?: string;
  similarExercise?: { statement: string; answer?: string } | null;
  uncertainty?: string | null;
} | null;

export const MAX_SPEECH_CHARS = 12_000;

const sentence = (s: unknown): string => {
  const t = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return t ? (/[.!?…:]$/.test(t) ? t : `${t}.`) : "";
};

export function questionSpeech(q: SpeechQuestion, analysis: SpeechAnalysis = null): string {
  const hasAnswer = Number.isInteger(q.given) && q.given >= 0 && q.given < q.options.length;
  const correct = hasAnswer && q.given === q.correctIndex;
  const parts = [`Question ${q.index + 1}.`, sentence(q.question)];
  parts.push(hasAnswer ? sentence(`Ta réponse : ${q.options[q.given]}`) : "Tu n'as pas répondu à cette question.");
  parts.push(correct ? "C'est la bonne réponse." : sentence(`Réponse attendue : ${q.options[q.correctIndex] ?? ""}`));
  if (q.method) parts.push(sentence(`Méthode : ${q.method}`));
  if (analysis) {
    parts.push(sentence(analysis.errorExplanation));
    (analysis.steps ?? []).forEach((s, i) => parts.push(sentence(`Étape ${i + 1} : ${s}`)));
    if (analysis.example) parts.push(sentence(`Exemple : ${analysis.example}`));
    if (analysis.similarExercise?.statement) parts.push(sentence(`Exercice similaire à essayer : ${analysis.similarExercise.statement}`));
    if (analysis.uncertainty) parts.push(sentence(`Attention, incertitude signalée : ${analysis.uncertainty}`));
  }
  return parts.filter(Boolean).join(" ");
}

export function fullCorrectionSpeech(args: {
  subject: string;
  scorePercent: number;
  total: number;
  mistakes: { q: SpeechQuestion; analysis: SpeechAnalysis }[];
}): string {
  const good = args.total - args.mistakes.length;
  const parts = [sentence(`Résultat en ${args.subject} : ${good} bonne${good > 1 ? "s" : ""} réponse${good > 1 ? "s" : ""} sur ${args.total}, soit ${args.scorePercent} pour cent`)];
  if (args.mistakes.length === 0) parts.push("Aucune erreur, excellent travail !");
  else {
    parts.push(`Voici la correction des ${args.mistakes.length} question${args.mistakes.length > 1 ? "s" : ""} à revoir.`);
    for (const m of args.mistakes) parts.push(questionSpeech(m.q, m.analysis));
  }
  const text = parts.join(" ");
  return text.length > MAX_SPEECH_CHARS ? `${text.slice(0, MAX_SPEECH_CHARS)}… La suite est à lire à l'écran.` : text;
}
