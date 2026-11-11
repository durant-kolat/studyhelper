// Tests de la matière d'examen issue d'un cours. Lancer : npm run test:exam-source
import assert from "node:assert/strict";
import { courseMaterial, MAX_COURSE_CHARS, MIN_COURSE_CHARS } from "../lib/exam-source";

// 1) Cours lisible
const ok = courseMaterial({ content_text: "Les dérivées mesurent la variation d'une fonction. ".repeat(5), key_notions: ["Dérivée", "Tangente", "Limite", 42, ""] });
assert.ok(ok.usable && !ok.truncated);
assert.ok(ok.text.includes("Notions clés repérées") && ok.text.includes("- Dérivée") && !ok.text.includes("42"));

// 2) Cours vide / illisible : jamais de questions « dans le vide »
assert.equal(courseMaterial({ content_text: "   ", key_notions: [] }).usable, false);
assert.equal(courseMaterial({ content_text: "a".repeat(MIN_COURSE_CHARS - 1), key_notions: ["x"] }).usable, false);
assert.equal(courseMaterial({ content_text: null, key_notions: ["A", "B", "C"] }).usable, true, "3 notions suffisent");
assert.equal(courseMaterial({}).usable, false);

// 3) Volume borné + indication de troncature
const big = courseMaterial({ content_text: ("Une phrase de cours. ").repeat(2000) });
assert.ok(big.truncated && big.text.length < MAX_COURSE_CHARS + 400);
assert.ok(big.chars > MAX_COURSE_CHARS);

// 4) Notions : plafonnées et nettoyées
const many = courseMaterial({ content_text: "x".repeat(60), key_notions: Array.from({ length: 80 }, (_, i) => `notion ${i}`) });
assert.equal((many.text.match(/^- notion/gm) ?? []).length, 30);

console.log("exam-source : tous les tests passent");
