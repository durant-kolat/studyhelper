// Tests de la salutation. Exécution : npx tsx tests/greeting.test.ts
import assert from "node:assert/strict";
import { greetingPeriod, displayFirstName } from "../lib/greeting.ts";
let passed = 0;
function test(name: string, fn: () => void) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; } }
test("04:59 → soir, 05:00 → matin", () => { assert.equal(greetingPeriod(4), "evening"); assert.equal(greetingPeriod(5), "morning"); });
test("11:59 → matin, 12:00 → après-midi", () => { assert.equal(greetingPeriod(11), "morning"); assert.equal(greetingPeriod(12), "afternoon"); });
test("17:59 → après-midi, 18:00 → soir", () => { assert.equal(greetingPeriod(17), "afternoon"); assert.equal(greetingPeriod(18), "evening"); });
test("minuit → soir", () => assert.equal(greetingPeriod(0), "evening"));
test("24 heures couvertes", () => { for (let h = 0; h < 24; h++) assert.ok(["morning", "afternoon", "evening"].includes(greetingPeriod(h))); });
test("prénom : premier mot", () => assert.equal(displayFirstName("  Jean  Dupont "), "Jean"));
test("prénom absent / invalide → null", () => {
  for (const v of [null, undefined, "", "   ", "null", "undefined", "a@b.com", "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "12345", 42]) assert.equal(displayFirstName(v), null, String(v));
});
console.log(`\n${passed} tests réussis`);
