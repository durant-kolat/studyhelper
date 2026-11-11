// Tests du texte lu à voix haute pour la correction. Lancer : npm run test:exam-speech
import assert from "node:assert/strict";
import { fullCorrectionSpeech, questionSpeech, MAX_SPEECH_CHARS, type SpeechQuestion } from "../lib/exam-speech";

const q: SpeechQuestion = { index: 2, question: "Simplifie √48", options: ["2√3", "4√3", "6√2"], given: 0, correctIndex: 1, method: "48 = 16 × 3" };

// 1) Question fausse : réponse de l'élève, réponse attendue, méthode
const t = questionSpeech(q);
assert.ok(t.startsWith("Question 3.") && t.includes("Ta réponse : 2√3.") && t.includes("Réponse attendue : 4√3.") && t.includes("Méthode : 48 = 16 × 3."));

// 2) Question réussie / sans réponse
assert.ok(questionSpeech({ ...q, given: 1 }).includes("C'est la bonne réponse."));
assert.ok(!questionSpeech({ ...q, given: 1 }).includes("Réponse attendue"));
assert.ok(questionSpeech({ ...q, given: -1 }).includes("Tu n'as pas répondu"));

// 3) Analyse IA lue (étapes, exemple) mais JAMAIS la solution de l'exercice similaire
const a = questionSpeech(q, { errorExplanation: "Tu as oublié de sortir 16", steps: ["Décompose 48", "Sors le carré"], example: "√50 = 5√2", similarExercise: { statement: "Simplifie √75", answer: "5√3" }, uncertainty: null });
assert.ok(a.includes("Étape 1 : Décompose 48.") && a.includes("Étape 2 :") && a.includes("Exemple : √50 = 5√2."));
assert.ok(a.includes("Exercice similaire à essayer : Simplifie √75.") && !a.includes("5√3"), "la solution n'est pas lue");

// 4) Correction complète : score + questions à revoir ; texte borné
const full = fullCorrectionSpeech({ subject: "Maths", scorePercent: 60, total: 5, mistakes: [{ q, analysis: null }, { q: { ...q, index: 3 }, analysis: null }] });
assert.ok(full.startsWith("Résultat en Maths : 3 bonnes réponses sur 5, soit 60 pour cent.") && full.includes("2 questions à revoir"));
assert.ok(fullCorrectionSpeech({ subject: "Maths", scorePercent: 100, total: 5, mistakes: [] }).includes("Aucune erreur"));
const long = fullCorrectionSpeech({ subject: "M", scorePercent: 0, total: 99, mistakes: Array.from({ length: 99 }, (_, i) => ({ q: { ...q, index: i, method: "x ".repeat(200) }, analysis: null })) });
assert.ok(long.length <= MAX_SPEECH_CHARS + 60);

console.log("exam-speech : tous les tests passent");
