// Tests des quotas configurables. Lancer : npm run test:quota-config
import assert from "node:assert/strict";
import { freeLimit, premiumLimit, quotaEnvName } from "../lib/quota-config";
import { FREE_LIMITS, PREMIUM_LIMITS } from "../lib/quota-limits";

assert.equal(quotaEnvName("QUOTA_FREE", "exam-analysis"), "QUOTA_FREE_EXAM_ANALYSIS");
assert.equal(freeLimit("assistant", {}), FREE_LIMITS.assistant, "défaut si non configuré");
assert.equal(premiumLimit("assistant", {}), PREMIUM_LIMITS.assistant);
assert.equal(freeLimit("assistant", { QUOTA_FREE_ASSISTANT: "9" }), 9);
assert.equal(premiumLimit("exam-chat", { QUOTA_PREMIUM_EXAM_CHAT: "40" }), 40);
assert.equal(freeLimit("exam-analysis", { QUOTA_FREE_EXAM_ANALYSIS: "0" }), 0, "0 = fonction désactivée");
for (const bad of ["abc", "-3", "2.5", "", "  ", "999999999"]) {
  assert.equal(freeLimit("assistant", { QUOTA_FREE_ASSISTANT: bad }), FREE_LIMITS.assistant, `valeur invalide ignorée : « ${bad} »`);
}
assert.equal(premiumLimit("assistant", { QUOTA_FREE_ASSISTANT: "1" }), PREMIUM_LIMITS.assistant, "les catégories sont indépendantes");
console.log("quota-config : tous les tests passent");
