// Tests de la logique publicitaire (pure). Exécution : npx tsx tests/ads.test.ts
// Ils vérifient les RÈGLES (Premium, consentement, pages, formats, identifiants). Ils ne prouvent PAS le rendu
// dans un navigateur, la diffusion réelle par AdSense, ni les politiques RLS de Supabase (à vérifier à la main).
import assert from "node:assert/strict";
import {
  AD_PAGES, AD_SLOTS, decideAd, defaultConfig, pathMatchesPage, parseConsent, providerStatus, sanitizeConfig,
  serializeConsent, validAdSenseClient, validAdSenseUnit, type DecisionInput,
} from "../lib/ads/config.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
}

const CLIENT = "ca-pub-1234567890123456"; // valeur de TEST uniquement, jamais utilisée dans l'application
const UNIT = "1234567890";
const base = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  slotId: "dashboard_inline", pathname: "/dashboard", premium: "free", configSource: "db", config: defaultConfig(),
  consent: "unknown", provider: { client: undefined, units: {} }, placeholderAllowed: false, ...over,
});
const withProvider = { client: CLIENT, units: { dashboard_inline: UNIT } };

// --- Emplacements et pages
test("chaque emplacement référence une page connue", () => {
  for (const s of AD_SLOTS) assert.ok(AD_PAGES.some((p) => p.key === s.page), s.id);
});
test("jamais d'emplacement sur examens, quiz, pratique, assistant, carrière, planning, paiement, profil", () => {
  const forbidden = ["/exams", "/quizzes", "/practice", "/assistant", "/career", "/schedule", "/payments", "/profile", "/login", "/results"];
  for (const s of AD_SLOTS) for (const p of forbidden) assert.equal(pathMatchesPage(p, s.page), false, `${s.id} sur ${p}`);
  for (const p of AD_PAGES) assert.ok(!forbidden.includes(p.path), p.path);
});
test("correspondance de chemin exacte (pas de sous-page)", () => {
  assert.equal(pathMatchesPage("/library", "library"), true);
  assert.equal(pathMatchesPage("/library/", "library"), true);
  assert.equal(pathMatchesPage("/library/abc", "library"), false);
  assert.equal(pathMatchesPage("/", "home"), true);
});
test("emplacement affiché sur une mauvaise page : rien", () => {
  assert.equal(decideAd(base({ pathname: "/exams" })).kind, "none");
  assert.equal(decideAd(base({ pathname: "/practice" })).kind, "none");
});
test("contexte bloqué (lecture, séance IA…) : rien", () => {
  assert.equal(decideAd(base({ blocked: true })).kind, "none");
  assert.equal(decideAd(base({ blocked: true, provider: withProvider, consent: "granted" })).kind, "none");
});

// --- Premium
test("Premium : jamais de publicité, même avec réseau et consentement", () => {
  assert.equal(decideAd(base({ premium: "premium", provider: withProvider, consent: "granted" })).kind, "none");
});
test("statut Premium inconnu : rien (aucun script chargé)", () => {
  assert.equal(decideAd(base({ premium: "unknown", provider: withProvider, consent: "granted" })).kind, "none");
});

// --- Configuration admin
test("interrupteur général, page, emplacement et format désactivés : rien", () => {
  const c1 = defaultConfig(); c1.globalEnabled = false;
  const c2 = defaultConfig(); c2.pages.dashboard = false;
  const c3 = defaultConfig(); c3.slots.dashboard_inline.enabled = false;
  const c4 = defaultConfig(); c4.formats.horizontal = false;
  for (const c of [c1, c2, c3, c4]) assert.equal(decideAd(base({ config: c })).kind, "none");
});

// --- Fournisseur et consentement
test("sans identifiants : pas de réseau (promotion maison par défaut)", () => {
  assert.equal(decideAd(base()).kind, "house");
});
test("promotion maison désactivée, production : aucune fausse publicité", () => {
  const c = defaultConfig(); c.houseFallback = false;
  assert.equal(decideAd(base({ config: c })).kind, "none");
});
test("promotion maison désactivée, développement : emplacement de remplacement", () => {
  const c = defaultConfig(); c.houseFallback = false;
  assert.equal(decideAd(base({ config: c, placeholderAllowed: true })).kind, "placeholder");
});
test("réseau configuré, consentement inconnu : on demande, aucun script", () => {
  assert.equal(decideAd(base({ provider: withProvider, consent: "unknown" })).kind, "consent");
});
test("réseau configuré, consentement accordé : bloc réseau", () => {
  const d = decideAd(base({ provider: withProvider, consent: "granted" }));
  assert.equal(d.kind, "network");
  if (d.kind === "network") { assert.equal(d.client, CLIENT); assert.equal(d.unit, UNIT); }
});
test("consentement refusé : jamais de réseau", () => {
  assert.notEqual(decideAd(base({ provider: withProvider, consent: "denied" })).kind, "network");
});
test("configuration non lue en base : jamais de réseau (échec = prudence)", () => {
  assert.notEqual(decideAd(base({ provider: withProvider, consent: "granted", configSource: "default" })).kind, "network");
});
test("identifiant d'éditeur ou de bloc invalide : pas de réseau", () => {
  assert.notEqual(decideAd(base({ provider: { client: "n'importe quoi", units: { dashboard_inline: UNIT } }, consent: "granted" })).kind, "network");
  assert.notEqual(decideAd(base({ provider: { client: CLIENT, units: { dashboard_inline: "abc" } }, consent: "granted" })).kind, "network");
  assert.notEqual(decideAd(base({ provider: { client: CLIENT, units: {} }, consent: "granted" })).kind, "network");
});
test("validation des identifiants", () => {
  assert.equal(validAdSenseClient(CLIENT), CLIENT);
  assert.equal(validAdSenseClient("ca-pub-123"), null);
  assert.equal(validAdSenseClient(undefined), null);
  assert.equal(validAdSenseUnit(UNIT), UNIT);
  assert.equal(validAdSenseUnit("12 34"), null);
});
test("état du fournisseur : rien d'inventé", () => {
  const empty = providerStatus({ client: undefined, units: {} });
  assert.equal(empty.ready, false);
  assert.ok(Object.values(empty.unitsConfigured).every((v) => v === false));
  const ok = providerStatus({ client: CLIENT, units: { home_banner: UNIT } });
  assert.equal(ok.ready, true); assert.equal(ok.unitsConfigured.home_banner, true); assert.equal(ok.unitsConfigured.dashboard_inline, false);
});

// --- Nettoyage de la configuration
test("sanitizeConfig : entrées invalides → valeurs par défaut", () => {
  for (const bad of [null, undefined, 42, "x", [], { slots: 3, pages: "x" }]) assert.deepEqual(sanitizeConfig(bad), defaultConfig());
});
test("sanitizeConfig : ignore les clés inconnues et les types faux", () => {
  const c = sanitizeConfig({ globalEnabled: "oui", pages: { exams: true, home: false }, slots: { fake: { enabled: true }, home_banner: { enabled: false, format: "nope" } }, extra: 1 });
  assert.equal(c.globalEnabled, true);
  assert.equal(c.pages.home, false);
  assert.ok(!("exams" in c.pages));
  assert.ok(!("fake" in c.slots));
  assert.equal(c.slots.home_banner.enabled, false);
  assert.equal(c.slots.home_banner.format, "horizontal");
  assert.ok(!("extra" in c));
});
test("sanitizeConfig est idempotent", () => {
  const c = sanitizeConfig({ houseFallback: false, pages: { library: false } });
  assert.deepEqual(sanitizeConfig(c), c);
});

// --- Consentement
test("consentement : analyse robuste et horodatage", () => {
  assert.equal(parseConsent(null), "unknown");
  assert.equal(parseConsent("pas du json"), "unknown");
  assert.equal(parseConsent('{"v":"autre"}'), "unknown");
  assert.equal(parseConsent(serializeConsent("granted")), "granted");
  assert.equal(parseConsent(serializeConsent("denied")), "denied");
});

console.log(`\n${passed} tests réussis`);
