// Tests de la génération par lots (examens et quiz jusqu'à 50 questions). Lancer : npm run test:batches
import assert from "node:assert/strict";
import { batchHint, isAcceptable, mergeBatches, planBatches, questionKey } from "../lib/question-batches";

// 1) Répartition équilibrée, jamais plus de 20 par lot, somme exacte
assert.deepEqual(planBatches(12), [12]);
assert.deepEqual(planBatches(20), [20]);
assert.deepEqual(planBatches(21), [11, 10]);
assert.deepEqual(planBatches(30), [15, 15]);
assert.deepEqual(planBatches(50), [17, 17, 16]);
for (let n = 1; n <= 50; n++) {
  const p = planBatches(n);
  assert.equal(p.reduce((a, b) => a + b, 0), n);
  assert.ok(p.every((x) => x >= 1 && x <= 20) && Math.max(...p) - Math.min(...p) <= 1);
}
assert.deepEqual(planBatches(500), [17, 17, 16], "plafonné à 50");
assert.deepEqual(planBatches(0), [1]);

// 2) Doublons : même énoncé (accents, casse, ponctuation ignorés) retiré ; ordre conservé ; plafond respecté
assert.equal(questionKey("Quelle est la DÉRIVÉE de x² ?"), questionKey("quelle est la derivee de x2"));
const merged = mergeBatches([
  [{ question: "Q1 ?" }, { question: "Q2 ?" }],
  null,
  [{ question: "q1" }, { question: "Q3 ?" }, { question: "" }, { question: "Q4 ?" }],
], 3);
assert.deepEqual(merged.map((q) => q.question), ["Q1 ?", "Q2 ?", "Q3 ?"]);

// 3) Acceptation : un seul lot = tout ou presque ; grand examen = au moins 70 % (et 10)
assert.equal(isAcceptable(12, 12, 1), true);
assert.equal(isAcceptable(12, 5, 1), false);
assert.equal(isAcceptable(50, 40, 3), true);
assert.equal(isAcceptable(50, 34, 3), false);
assert.equal(isAcceptable(30, 15, 2), false);
assert.equal(isAcceptable(30, 21, 2), true);

// 4) Consigne de lot : rien pour un lot unique
assert.equal(batchHint(0, 1, 12), "");
assert.ok(batchHint(1, 3, 17).includes("lot 2 sur 3"));

console.log("question-batches : tous les tests passent");

// 5) Des questions de maths différentes ne sont JAMAIS confondues (x² ≠ x, √2 ≠ √3)
assert.notEqual(questionKey("Dérive x²"), questionKey("Dérive x"));
assert.notEqual(questionKey("Simplifie √2"), questionKey("Simplifie √3"));
