// Tests du quota gratuit. Exécution : npx tsx tests/quota.test.ts
// Ils vérifient les LIMITES et le LIBELLÉ (pur). Ils ne prouvent PAS le comptage SQL réel (check_and_log_usage) :
// celui-ci se vérifie sur Supabase avec un compte gratuit (voir rapport).
import assert from "node:assert/strict";
import { FREE_LIMITS, PREMIUM_LIMITS, formatUsageLabel } from "../lib/quota-limits.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
}
test("compte gratuit : 5 questions IA par jour", () => assert.equal(FREE_LIMITS.assistant, 5));
test("Premium inchangé", () => assert.equal(PREMIUM_LIMITS.assistant, 100));
const expected = [
  "Gratuit - Questions IA : 1 / 5 utilisées - 4 restantes",
  "Gratuit - Questions IA : 2 / 5 utilisées - 3 restantes",
  "Gratuit - Questions IA : 3 / 5 utilisées - 2 restantes",
  "Gratuit - Questions IA : 4 / 5 utilisées - 1 restante",
  "Gratuit - Questions IA : 5 / 5 utilisées - 0 restante",
];
expected.forEach((label, i) => test(label, () => {
  const used = i + 1;
  assert.equal(formatUsageLabel({ isPremium: false, used, limit: FREE_LIMITS.assistant, remaining: FREE_LIMITS.assistant - used }), label);
}));
test("Premium affiché comme Premium", () => assert.ok(formatUsageLabel({ isPremium: true, used: 1, limit: 100, remaining: 99 }).startsWith("Premium - ")));
console.log(`\n${passed} tests réussis`);
