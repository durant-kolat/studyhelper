// Tests de la Partie B (questions rédigées / à schéma). Lancer : npm run test:exam-open
import assert from "node:assert/strict";
import { buildGradingData, combinedPercent, hasAnswer, noAnswerGrading, parseGrading, parseOpenQuestions, sanitizeOpenAnswers, toClientOpenQuestions } from "../lib/exam-open";

// 1) Génération : validation du barème, maxPoints recalculé, éléments invalides écartés
const qs = parseOpenQuestions([
  { question: "Explique la loi d'Ohm", type: "text", expectedAnswer: "U = R × I", rubric: [{ criterion: "Énonce U = R × I", points: 1 }, { criterion: "Définit U, R, I", points: 1.5 }], maxPoints: 99 },
  { question: "Schéma d'un circuit série", type: "diagram", expectedAnswer: "pile + 2 résistances", rubric: [{ criterion: "Symboles corrects", points: 2 }] },
  { question: "", expectedAnswer: "x", rubric: [{ criterion: "a", points: 1 }] },
  { question: "Sans barème", expectedAnswer: "x", rubric: [] },
  { question: "Barème absurde", expectedAnswer: "x", rubric: [{ criterion: "a", points: 400 }] },
  { question: "Type inconnu", type: "hack", expectedAnswer: "x", rubric: [{ criterion: "a", points: 1 }] },
]);
assert.equal(qs.length, 3);
assert.equal(qs[0].maxPoints, 2.5, "maxPoints = somme du barème, jamais la valeur du modèle");
assert.equal(qs[1].type, "diagram");
assert.equal(qs[2].type, "text", "type invalide => texte");
assert.equal(parseOpenQuestions("n'importe quoi").length, 0);
assert.equal(parseOpenQuestions(Array(20).fill(qs[0])).length, 5, "plafonné à 5");

// 2) Le navigateur ne reçoit ni corrigé ni barème
const client = toClientOpenQuestions(qs);
assert.deepEqual(Object.keys(client[0]).sort(), ["maxPoints", "question", "type"]);

// 3) Réponses : seules les photos du dossier de CET élève et de CET examen
const ok = "user1/exam-answers/exam1/0-1.jpg";
const clean = sanitizeOpenAnswers(
  [{ index: 0, text: "  réponse  ", imagePaths: [ok, "user2/exam-answers/exam1/x.jpg", "user1/exam-answers/exam9/x.jpg", "user1/exam-answers/exam1/../../secret.jpg", 42 as unknown as string] }, { index: 7, text: "hors plage" }],
  2, "user1", "exam1",
);
assert.equal(clean.length, 2);
assert.deepEqual(clean[0], { text: "réponse", imagePaths: [ok] });
assert.equal(hasAnswer(clean[1]), false);
assert.equal(sanitizeOpenAnswers(undefined, 2, "u", "e").length, 2);
assert.equal(sanitizeOpenAnswers([{ index: 0, text: "x".repeat(9000) }], 1, "u", "e")[0].text.length, 6000);
assert.equal(sanitizeOpenAnswers([{ index: 0, imagePaths: Array(9).fill("u/exam-answers/e/a.jpg") }], 1, "u", "e")[0].imagePaths.length, 3);

// 4) Correction : points bornés par critère, total RECALCULÉ, jamais supérieur au maximum
const g = parseGrading('```json\n{"criteria":[{"index":0,"awarded":5,"comment":"ok"},{"index":1,"awarded":0.7,"comment":"partiel"}],"summary":"Bien.","uncertainty":null,"total":99}\n```', qs[0].rubric);
assert.ok(g);
assert.equal(g!.criteria[0].awarded, 1, "borné au max du critère");
assert.equal(g!.criteria[1].awarded, 0.5, "arrondi au demi-point");
assert.equal(g!.points, 1.5, "total recalculé, pas le « total » du modèle");
const gm = parseGrading('{"criteria":[{"index":1,"awarded":1.5}],"summary":"x"}', qs[0].rubric);
assert.equal(gm!.criteria[0].awarded, 0);
assert.ok(gm!.criteria[0].comment.includes("non évalué"));
assert.equal(parseGrading("pas du json", qs[0].rubric), null);
assert.equal(parseGrading('{"criteria":[]}', qs[0].rubric), null);
assert.equal(parseGrading('{"criteria":[{"index":0,"awarded":-3}],"summary":""}', qs[0].rubric)!.criteria[0].awarded, 0);
const unc = parseGrading('{"criteria":[{"index":0,"awarded":1}],"summary":"s","uncertainty":"photo floue"}', qs[0].rubric);
assert.equal(unc!.uncertainty, "photo floue");

// 5) Pas de réponse => 0 point sans appel IA
const none = noAnswerGrading(qs[0].rubric);
assert.equal(none.points, 0);
assert.equal(none.criteria.length, 2);

// 6) Total indicatif et données de correction
assert.equal(combinedPercent(4, 5, 2.5, 5), 65);
assert.equal(combinedPercent(0, 0, 0, 0), 0);
const data = JSON.parse(buildGradingData(qs[0], "", 1));
assert.equal(data.studentTextAnswer, "(aucun texte)");
assert.equal(data.rubric[1].index, 1);

console.log("exam-open : tous les tests passent");

// 7) Chat de la Partie B : index décalé (pas de collision avec les QCM), contexte complet sans photo ni secret inutile
import { OPEN_CHAT_INDEX_OFFSET, buildOpenChatContext, chatIndexFor, OPEN_CHAT_SYSTEM } from "../lib/exam-open";
assert.equal(chatIndexFor("A", 3), 3);
assert.equal(chatIndexFor("B", 3), OPEN_CHAT_INDEX_OFFSET + 3);
assert.ok(chatIndexFor("B", 0) > 50, "jamais de collision avec les QCM (max 50 questions)");
const ctxGraded = JSON.parse(buildOpenChatContext({ question: "Q?", expected_answer: "R", max_points: "2.5", answer_text: "ma réponse", image_paths: ["a.jpg"], status: "graded", points: "1.5", rubric: [{ criterion: "c1", points: 1 }], feedback: { criteria: [{ criterion: "c1", awarded: 1, max: 1, comment: "ok" }], summary: "bien", uncertainty: "photo floue" } }));
assert.equal(ctxGraded.maxPoints, 2.5);
assert.equal(ctxGraded.correction.points, 1.5);
assert.equal(ctxGraded.correction.uncertainty, "photo floue");
assert.equal(ctxGraded.studentPhotos, 1);
assert.equal(JSON.parse(buildOpenChatContext({ question: "Q?", max_points: 2, status: "pending" })).correction, "pas encore corrigée par l'IA");
assert.ok(OPEN_CHAT_SYSTEM.includes("INDICATIVE") && OPEN_CHAT_SYSTEM.includes("ne peut pas être modifiée"));
console.log("exam-open (chat Partie B) : tous les tests passent");
