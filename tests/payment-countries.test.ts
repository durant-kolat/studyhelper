// Tests du registre des pays de paiement. Lancer : npm run test:payment-countries
import assert from "node:assert/strict";
import { COUNTRIES, availableMethods, countryFlag, countryName, enabledCountryCodes, formatMoney, getCountry, isCfaCurrency, normalizeCountryCode, parseMobileNumber, suggestCountry } from "../lib/payment-countries";

// 1) Registre cohérent : codes uniques, indicatifs numériques, plages de numéros valides, devises à 3 lettres
assert.equal(new Set(COUNTRIES.map((c) => c.code)).size, COUNTRIES.length);
for (const c of COUNTRIES.filter((x) => x.code !== "ZZ")) {
  assert.match(c.code, /^[A-Z]{2}$/);
  assert.match(c.dial, /^\d{1,3}$/);
  assert.match(c.currency, /^[A-Z]{3}$/);
  assert.ok(c.minDigits >= 6 && c.maxDigits >= c.minDigits && c.maxDigits <= 11, c.code);
  assert.ok(c.mtn || c.orange, `${c.code} : au moins un opérateur`);
  assert.equal(parseMobileNumber(`+${c.dial} ${"7".repeat(c.minDigits)}`, c.code).ok || !!c.strict, true, `${c.code} : numéro international`);
}
assert.equal(getCountry("cm")?.dial, "237");
assert.equal(getCountry("FR"), null);
assert.equal(normalizeCountryCode(" ci "), "CI");
assert.equal(normalizeCountryCode("CIV"), null);

// 2) Pays activés : Cameroun seul par défaut ; liste ; ALL ; valeurs invalides ignorées
assert.deepEqual(enabledCountryCodes(undefined), ["CM"]);
assert.deepEqual(enabledCountryCodes(""), ["CM"]);
assert.deepEqual(enabledCountryCodes("ci, sn ,XX,FR,ci"), ["CI", "SN"]);
assert.deepEqual(enabledCountryCodes("xx"), ["CM"]);
assert.deepEqual(enabledCountryCodes("cm,zz"), ["CM", "ZZ"], "ZZ = autre pays (carte / PayPal)");
assert.equal(enabledCountryCodes("ALL").length, COUNTRIES.length);

// 3) Moyens proposables : jamais dans un pays non activé ; MTN / Orange seulement là où l'opérateur existe ; carte et PayPal pour tout pays activé
const none = { mtn: false, orange: false, card: false, paypal: false };
assert.deepEqual(availableMethods("CI", ["CM"]), none, "pays non activé");
assert.deepEqual(availableMethods("XX", ["CM"]), none);
assert.deepEqual(availableMethods("CM", ["CM"]), { mtn: true, orange: true, card: true, paypal: true });
assert.deepEqual(availableMethods("SN", ["SN"]), { mtn: false, orange: true, card: true, paypal: true }, "pas de MTN au Sénégal");
assert.deepEqual(availableMethods("GH", ["GH"]), { mtn: true, orange: false, card: true, paypal: true });
assert.deepEqual(availableMethods("ZZ", ["ZZ"]), { mtn: false, orange: false, card: true, paypal: true }, "autre pays : carte et PayPal seulement");
assert.equal(getCountry("ZZ")?.currency, "EUR");
assert.equal(parseMobileNumber("12345678", "ZZ").ok, false, "aucun numéro pour « autre pays »");

// 4) Numéros : Cameroun strict (comportement d'avant conservé)
for (const ok of ["677 12 34 56", "677-12-34-56", "+237 677 12 34 56", "00237677123456", "237677123456", "677123456"]) {
  const r = parseMobileNumber(ok, "CM");
  assert.ok(r.ok && r.national === "677123456" && r.international === "237677123456", ok);
}
for (const bad of ["577123456", "67712345", "6771234567", "+233677123456", "abc", "+33612345678"]) assert.equal(parseMobileNumber(bad, "CM").ok, false, bad);
assert.deepEqual(parseMobileNumber("", "CM"), { ok: false, reason: "required" });
assert.deepEqual(parseMobileNumber(null, "CM"), { ok: false, reason: "required" });

// 5) Autres pays : 0 initial retiré seulement s'il dépasse la longueur (CI et BJ : le 0 fait partie du numéro)
const gh = parseMobileNumber("024 123 4567", "GH");
assert.ok(gh.ok && gh.national === "241234567" && gh.international === "233241234567");
assert.ok(parseMobileNumber("+233 24 123 4567", "GH").ok);
const ci = parseMobileNumber("07 12 34 56 78", "CI");
assert.ok(ci.ok && ci.national === "0712345678" && ci.international === "2250712345678");
assert.equal(parseMobileNumber("+233 24 123 4567", "CI").ok, false, "indicatif d'un autre pays");
assert.equal(parseMobileNumber("12", "SN").ok, false);
assert.equal(parseMobileNumber("771234567", "XX").ok, false, "pays inconnu");

// 6) Affichage dans la langue de l'utilisateur
assert.equal(countryName("CI", "fr"), "Côte d’Ivoire");
assert.equal(countryName("CI", "en"), "Côte d’Ivoire");
assert.equal(countryName("CM", "en"), "Cameroon");
assert.equal(countryName("CM", "fr"), "Cameroun");
assert.equal(countryName("CM", "de"), "Kamerun");
assert.equal(countryName("CM", "xx-INVALID-LANG-TAG-!!"), "CM", "langue invalide : jamais d'exception");
assert.equal(countryFlag("CM"), "🇨🇲");
assert.equal(countryFlag("xx"), "");
assert.ok(formatMoney(2500, "XAF", "fr").includes("2") && formatMoney(2500, "XAF", "fr").includes("500"));
assert.equal(formatMoney(5, "ZZZ?", "fr"), "5 ZZZ?", "devise invalide : repli sûr");
assert.ok(isCfaCurrency("XAF") && isCfaCurrency("XOF") && !isCfaCurrency("GHS"));

// 7) Pays suggéré : région de la langue, seulement si activé ; sinon le premier pays activé (jamais l'IP)
assert.equal(suggestCountry(["fr-CI", "fr"], ["CM", "CI"]), "CI");
assert.equal(suggestCountry(["fr-CI"], ["CM"]), "CM");
assert.equal(suggestCountry(["en-US", "fr"], ["CM", "SN"]), "CM");
assert.equal(suggestCountry([], ["SN"]), "SN");

console.log("payment-countries : tous les tests passent");
