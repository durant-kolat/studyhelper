// Tests du professeur IA : logique PURE (découpage, lecture des réponses du modèle, règles d'avancement,
// quotas déclarés, budget). Exécution : npx tsx tests/tutor-logic.test.ts
//   ou sans dépendance : node --experimental-strip-types tests/tutor-logic.test.ts
// Ce que ces tests NE prouvent PAS : la qualité pédagogique réelle de Gemini, l'audio du navigateur, la base
// Supabase réelle (voir README, section « Professeur IA — ce qui reste à vérifier à la main »).

import assert from "node:assert/strict";

const load = (p: string) => import(new URL(p, import.meta.url).href);
const { splitIntoParagraphs } = await load("../lib/tutor/paragraphs.ts");
const { parseTeach, parseEval, parseFinal, shouldAdvance, attemptsAfter, REFORMULATE_AFTER_ATTEMPTS } = await load("../lib/tutor/parse.ts");
const { nextLiveStep, MAX_SILENCE_STREAK, looksLikeQuestion } = await load("../lib/tutor/live.ts");
const { evaluateBudget, readBudgetConfig, estimateCost } = await load("../lib/tutor/budget.ts");

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("Découpage en paragraphes");
test("respecte l'ordre d'origine", () => {
  const t = "Premier paragraphe assez long pour exister seul, il parle de la photosynthèse et de la lumière.\n\nDeuxième paragraphe assez long pour exister seul, il parle de la respiration cellulaire et de l'énergie.\n\nTroisième paragraphe assez long pour exister seul, il parle de la fermentation et des levures.";
  const r = splitIntoParagraphs(t);
  assert.equal(r.paragraphs.length, 3);
  assert.ok(r.paragraphs[0].startsWith("Premier"));
  assert.ok(r.paragraphs[2].startsWith("Troisième"));
  assert.equal(r.truncated, false);
});
test("fusionne un titre court avec son paragraphe", () => {
  const r = splitIntoParagraphs("Chapitre 1\n\nUn paragraphe suffisamment long pour être étudié correctement par l'élève, avec plusieurs mots.");
  assert.equal(r.paragraphs.length, 1);
  assert.ok(r.paragraphs[0].startsWith("Chapitre 1"));
});
test("coupe un bloc démesuré aux fins de phrases", () => {
  const sentence = "Ceci est une phrase de test qui sert à remplir le bloc. ";
  const r = splitIntoParagraphs(sentence.repeat(60), { maxParagraphChars: 400 });
  assert.ok(r.paragraphs.length > 3);
  for (const p of r.paragraphs) assert.ok(p.length <= 700, `trop long: ${p.length}`);
  for (const p of r.paragraphs) assert.ok(p.trimEnd().endsWith("."), "coupe au milieu d'une phrase");
});
test("limite configurable : document volumineux tronqué et signalé", () => {
  const big = Array.from({ length: 200 }, (_, i) => `Paragraphe numéro ${i} avec assez de texte pour ne pas être fusionné avec un autre.`).join("\n\n");
  const r = splitIntoParagraphs(big, { maxParagraphs: 10 });
  assert.equal(r.paragraphs.length, 10);
  assert.equal(r.truncated, true);
  const r2 = splitIntoParagraphs(big, { maxDocChars: 500 });
  assert.equal(r2.truncated, true);
});
test("déterministe (la progression sauvegardée reste valable)", () => {
  const t = "A".repeat(100) + "\n\n" + "B".repeat(100);
  assert.deepEqual(splitIntoParagraphs(t), splitIntoParagraphs(t));
});
test("texte vide → aucun paragraphe", () => {
  assert.equal(splitIntoParagraphs("   \n\n  ").paragraphs.length, 0);
});

console.log("Lecture des réponses du modèle");
test("parseTeach accepte du JSON entouré de ```", () => {
  const r = parseTeach('```json\n{"explanation":"Voici.","question":"Pourquoi ?"}\n```');
  assert.deepEqual(r, { explanation: "Voici.", question: "Pourquoi ?", paragraphLang: "" });
  assert.equal(parseTeach('{"explanation":"a","question":"b","paragraphLang":"FR"}')?.paragraphLang, "fr");
  assert.equal(parseTeach('{"explanation":"a","question":"b","paragraphLang":"français!"}')?.paragraphLang, "");
});
test("parseTeach refuse une réponse sans question", () => {
  assert.equal(parseTeach('{"explanation":"x"}'), null);
  assert.equal(parseTeach("pas du json"), null);
});
test("parseEval valide le verdict", () => {
  assert.equal(parseEval('{"verdict":"correct","feedback":"Oui."}')?.verdict, "correct");
  assert.equal(parseEval('{"verdict":"peut-être","feedback":"?"}'), null);
  assert.equal(parseEval('{"verdict":"correct"}'), null);
});
test("parseFinal exige un résumé et au moins une question", () => {
  const ok = parseFinal('{"summary":"S","keyNotions":["a"],"quiz":[{"question":"Q","answer":"R"}]}');
  assert.equal(ok?.quiz.length, 1);
  assert.equal(parseFinal('{"summary":"S","quiz":[]}'), null);
});

console.log("Règles pédagogiques d'avancement");
test("seule une réponse correcte fait avancer", () => {
  assert.equal(shouldAdvance("correct"), true);
  for (const v of ["partial", "incorrect", "unclear"]) assert.equal(shouldAdvance(v), false);
});
test("une réponse ambiguë ne compte pas comme une erreur", () => {
  assert.equal(attemptsAfter(1, "unclear"), 1);
  assert.equal(attemptsAfter(1, "incorrect"), 2);
  assert.equal(attemptsAfter(1, "partial"), 2);
  assert.equal(attemptsAfter(3, "correct"), 0);
});
test("reformulation après 2 tentatives non réussies", () => {
  assert.equal(REFORMULATE_AFTER_ATTEMPTS, 2);
});

console.log("Quotas déclarés");
const { FREE_LIMITS, PREMIUM_LIMITS } = await load("../lib/quota-limits.ts");
test("valeurs existantes inchangées", () => {
  assert.deepEqual([FREE_LIMITS.assistant, PREMIUM_LIMITS.assistant], [10, 100]);
  assert.deepEqual([FREE_LIMITS.analyze, PREMIUM_LIMITS.analyze], [5, 50]);
  assert.deepEqual([FREE_LIMITS["generate-exam"], PREMIUM_LIMITS["generate-exam"]], [3, 20]);
  assert.deepEqual([FREE_LIMITS["generate-quiz"], PREMIUM_LIMITS["generate-quiz"]], [2, 10]);
});
test("nouveaux quotas : Premium 10/jour, essai gratuit limité", () => {
  for (const k of ["tutor", "voice-session", "summary"]) {
    assert.equal(PREMIUM_LIMITS[k], 10);
    assert.ok(FREE_LIMITS[k] >= 1 && FREE_LIMITS[k] < PREMIUM_LIMITS[k]);
  }
});

console.log("Budget de consommation");
test("sous le plafond → autorisé ; au plafond → bloqué avec la période", () => {
  const cfg = readBudgetConfig({ AI_TOKEN_BUDGET_DAILY_FREE: "1000", AI_TOKEN_BUDGET_DAILY_PREMIUM: "5000", AI_TOKEN_BUDGET_MONTHLY_FREE: "0", AI_TOKEN_BUDGET_MONTHLY_PREMIUM: "0" });
  assert.equal(evaluateBudget(cfg, false, { dayTokens: 999, monthTokens: 10 }).allowed, true);
  const b = evaluateBudget(cfg, false, { dayTokens: 1000, monthTokens: 10 });
  assert.equal(b.allowed, false);
  assert.equal(b.period, "day");
  assert.equal(evaluateBudget(cfg, true, { dayTokens: 1000, monthTokens: 10 }).allowed, true);
});
test("0 désactive le plafond de la période", () => {
  const cfg = readBudgetConfig({ AI_TOKEN_BUDGET_DAILY_FREE: "0", AI_TOKEN_BUDGET_DAILY_PREMIUM: "0", AI_TOKEN_BUDGET_MONTHLY_FREE: "0", AI_TOKEN_BUDGET_MONTHLY_PREMIUM: "0" });
  assert.equal(evaluateBudget(cfg, false, { dayTokens: 9e9, monthTokens: 9e9 }).allowed, true);
});
test("plafond mensuel appliqué", () => {
  const cfg = readBudgetConfig({ AI_TOKEN_BUDGET_DAILY_FREE: "0", AI_TOKEN_BUDGET_DAILY_PREMIUM: "0", AI_TOKEN_BUDGET_MONTHLY_FREE: "500", AI_TOKEN_BUDGET_MONTHLY_PREMIUM: "9000" });
  const b = evaluateBudget(cfg, false, { dayTokens: 1, monthTokens: 500 });
  assert.equal(b.allowed, false);
  assert.equal(b.period, "month");
});
test("coût : jamais inventé sans tarif configuré", () => {
  assert.equal(estimateCost({ promptTokens: 1000, outputTokens: 500 }, {}), null);
  const c = estimateCost({ promptTokens: 1_000_000, outputTokens: 1_000_000 }, { GEMINI_PRICE_INPUT_PER_MTOK: "0.1", GEMINI_PRICE_OUTPUT_PER_MTOK: "0.4" });
  assert.ok(c !== null && Math.abs(c - 0.5) < 1e-9);
});
test("valeurs de budget invalides → valeurs par défaut", () => {
  const cfg = readBudgetConfig({ AI_TOKEN_BUDGET_DAILY_FREE: "abc" });
  assert.ok(cfg.dailyFree > 0);
});

console.log("Appel en direct");
const base = { live: true, phase: "teaching", hasExplanation: true, speaking: false, busy: false, listening: false, advancePending: false, silenceStreak: 0 };
test("hors appel : rien ne se passe", () => {
  assert.equal(nextLiveStep({ ...base, live: false }), "none");
});
test("le micro ne s'ouvre pas tant que le professeur parle (anti-écho)", () => {
  assert.equal(nextLiveStep({ ...base, speaking: true }), "none");
});
test("pas d'écoute pendant un appel IA ou une écoute déjà ouverte", () => {
  assert.equal(nextLiveStep({ ...base, busy: true }), "none");
  assert.equal(nextLiveStep({ ...base, listening: true }), "none");
});
test("professeur silencieux, rien en cours → on écoute l'élève", () => {
  assert.equal(nextLiveStep(base), "listen");
});
test("bonne réponse confirmée → paragraphe suivant, sans rouvrir le micro avant", () => {
  assert.equal(nextLiveStep({ ...base, advancePending: true }), "continue");
});
test("silences répétés → on raccroche (pas de boucle)", () => {
  assert.equal(nextLiveStep({ ...base, silenceStreak: MAX_SILENCE_STREAK }), "hangup");
  assert.equal(nextLiveStep({ ...base, silenceStreak: MAX_SILENCE_STREAK - 1 }), "listen");
});
test("rien avant le début de la séance ni après la fin", () => {
  assert.equal(nextLiveStep({ ...base, phase: "boot" }), "none");
  assert.equal(nextLiveStep({ ...base, phase: "finished" }), "none");
  assert.equal(nextLiveStep({ ...base, hasExplanation: false }), "none");
});

test("question parlée détectée (fr/en/es/de…), réponse normale non détectée", () => {
  for (const q of ["Pourquoi le ciel est bleu", "c'est quoi un container ?", "Can you explain that", "¿Qué es Bootstrap", "warum das so ist", "explique-moi encore"]) {
    assert.equal(looksLikeQuestion(q), true, q);
  }
  for (const a of ["Bootstrap est un framework CSS", "La grille a douze colonnes", "", "   "]) {
    assert.equal(looksLikeQuestion(a), false, a);
  }
});

console.log(`\n${passed} tests réussis${process.exitCode ? " — AU MOINS UN ÉCHEC" : ""}`);
