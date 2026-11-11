// Tests de la logique pure d'analyse d'examen. Lancer : npm run test:exam
import assert from "node:assert/strict";
import { collectMistakes, parseAnalysis, sanitizeChatMessages, isChatAction, buildAnalysisData, type GradedQ } from "../lib/exam-analysis";

const qs: GradedQ[] = [
  { question: "2+2 ?", options: ["3", "4", "5"], correctIndex: 1, method: "addition" },
  { question: "3×3 ?", options: ["6", "9", "12"], correctIndex: 1, method: "multiplication" },
  { question: "√16 ?", options: ["2", "4", "8"], correctIndex: 1, method: "racine" },
];

// 1) Seules les questions fausses ou sans réponse partent à l'IA
const m = collectMistakes(qs, [1, 0, -1]);
assert.deepEqual(m.map((x) => x.index), [1, 2]);
assert.equal(m[1].given, -1);
assert.equal(collectMistakes(qs, [1, 1, 1]).length, 0);
assert.equal(collectMistakes(null, null).length, 0);
assert.equal(collectMistakes(qs, undefined).length, 3, "réponses absentes = toutes fausses");

// 2) Le corrigé serveur est transmis, la réponse vide est explicite
const data = JSON.parse(buildAnalysisData(m));
assert.equal(data[1].studentAnswer, "aucune réponse");
assert.equal(data[0].correctAnswer, "B. 9");

// 3) parseAnalysis : valide, filtre les index non autorisés, tronque, rejette le JSON invalide
const ok = parseAnalysis('```json\n{"items":[{"index":1,"errorExplanation":"Tu as additionné.","steps":["a","b"],"example":"ex","similarExercise":{"statement":"4×4 ?","answer":"16"},"uncertainty":null},{"index":0,"errorExplanation":"hors liste"},{"index":1,"errorExplanation":"doublon"}]}\n```', [1, 2]);
assert.ok(ok && ok.length === 1 && ok[0].index === 1 && ok[0].similarExercise?.answer === "16");
assert.equal(parseAnalysis("pas du json", [1]), null);
assert.equal(parseAnalysis('{"items":[]}', [1]), null);
assert.equal(parseAnalysis('{"items":[{"index":1}]}', [1]), null, "item vide rejeté");
const long = parseAnalysis(JSON.stringify({ items: [{ index: 1, errorExplanation: "x".repeat(5000), steps: Array(20).fill("s") }] }), [1]);
assert.equal(long![0].errorExplanation.length, 1200);
assert.equal(long![0].steps.length, 8);

// 4) Historique de chat : jamais de confiance aveugle
const msgs = sanitizeChatMessages([{ role: "user", content: "a" }, { role: "system", content: "pirate" }, { role: "assistant", content: " " }, 42, { role: "assistant", content: "b" }]);
assert.deepEqual(msgs.map((x) => x.role), ["user", "assistant"]);
assert.equal(sanitizeChatMessages("n'importe quoi").length, 0);
assert.equal(sanitizeChatMessages(Array.from({ length: 50 }, () => ({ role: "user", content: "x" }))).length, 30);

// 5) Actions autorisées
assert.ok(isChatAction("steps") && !isChatAction("hack") && !isChatAction(undefined));

console.log("exam-analysis : tous les tests passent");
