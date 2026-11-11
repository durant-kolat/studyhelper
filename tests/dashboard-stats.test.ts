// Tests des statistiques du tableau de bord. Lancer : npm run test:dashboard
import assert from "node:assert/strict";
import { computeInsights, recommendations, type ResultRow } from "../lib/dashboard-stats";

const NOW = new Date("2026-10-20T12:00:00Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const r = (subject: string, score: number, d: number): ResultRow => ({ subject, score_percent: score, taken_at: day(d) });

// 1) Nouvel utilisateur : AUCUNE statistique fabriquée
const empty = computeInsights([], NOW);
assert.deepEqual([empty.total, empty.average, empty.best, empty.trend, empty.daysSinceLast, empty.bySubject.length, empty.recent.length], [0, null, null, null, null, 0, 0]);
assert.equal(recommendations(empty).length, 1);
assert.ok(recommendations(empty)[0].text.includes("premier examen"));

// 2) Calculs réels : moyenne générale, par matière, meilleure matière, faiblesses (< 70 %), plus récents d'abord
const rows = [r("Maths", 40, 1), r("Maths", 60, 3), r("Physique", 90, 2), r("Histoire", 65, 10), r("Physique", 80, 12), r("Maths", 50, 20)];
const i = computeInsights(rows, NOW);
assert.equal(i.total, 6);
assert.equal(i.average, 64); // (40+60+90+65+80+50)/6 = 64,17
assert.deepEqual(i.bySubject.map((s) => [s.subject, s.average, s.count]), [["Maths", 50, 3], ["Histoire", 65, 1], ["Physique", 85, 2]]);
assert.equal(i.best?.subject, "Physique");
assert.deepEqual(i.weak.map((s) => s.subject), ["Maths", "Histoire"]);
assert.deepEqual(i.recent.map((x) => x.score_percent), [40, 90, 60, 65, 80], "du plus récent au plus ancien, 5 maximum");
assert.equal(i.daysSinceLast, 1);

// 3) Tendance : seulement à partir de 4 résultats ; écart d'au moins 5 points
assert.equal(computeInsights([r("A", 50, 1), r("A", 60, 2), r("A", 70, 3)], NOW).trend, null, "pas assez de données : rien n'est affirmé");
assert.equal(computeInsights([r("A", 80, 1), r("A", 80, 2), r("A", 80, 3), r("A", 50, 4), r("A", 50, 5), r("A", 50, 6)], NOW).trend, "up");
assert.equal(computeInsights([r("A", 40, 1), r("A", 40, 2), r("A", 40, 3), r("A", 70, 4), r("A", 70, 5), r("A", 70, 6)], NOW).trend, "down");
assert.equal(computeInsights([r("A", 60, 1), r("A", 62, 2), r("A", 61, 3), r("A", 60, 4)], NOW).trend, "stable");

// 4) Données invalides ignorées (jamais d'exception ni de NaN affiché)
const dirty = computeInsights([r("Maths", 50, 1), { subject: "", score_percent: 99, taken_at: day(1) }, { subject: "X", score_percent: NaN, taken_at: day(1) }, { subject: "Y", score_percent: 70, taken_at: "pas une date" }], NOW);
assert.equal(dirty.total, 1);
assert.equal(dirty.average, 50);

// 5) Recommandations : chacune repose sur un fait mesuré
const recs = recommendations(i);
assert.ok(recs[0].text.includes("Maths") && recs[0].text.includes("50 %") && recs[0].text.includes("3 résultats"));
assert.ok(recs.every((x) => x.href.startsWith("/")));
const old = computeInsights([r("Maths", 90, 15)], NOW);
assert.ok(recommendations(old).some((x) => x.text.includes("15 jours")));
assert.ok(recommendations(computeInsights([r("Maths", 90, 1)], NOW))[0].text.includes("solides"));
assert.ok(recommendations(computeInsights(Array.from({ length: 9 }, (_, k) => r(`M${k}`, 10, 1)), NOW)).length <= 4);

console.log("dashboard-stats : tous les tests passent");
