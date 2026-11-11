// Tests des célébrations (logique pure). Lancer : npm run test:celebrations
import assert from "node:assert/strict";
import { dueCelebrations, isSendWindow, isValidMonthDay, localDateParts, type CelebrationPrefs } from "../lib/celebrations";

const P = (year: number, month: number, day: number, hour = 9) => ({ year, month, day, hour });
const base: CelebrationPrefs = { celebrations_enabled: true, birthday_enabled: true, birth_month: 3, birth_day: 14 };

// 1) Anniversaire : bon jour seulement, avec prénom ou formule neutre (jamais inventé)
let d = dueCelebrations(base, "Alex", P(2026, 3, 14));
assert.equal(d.length, 1);
assert.equal(d[0].title, "🎂 Joyeux anniversaire, Alex !");
assert.equal(dueCelebrations(base, "", P(2026, 3, 14))[0].title, "🎂 Joyeux anniversaire !");
assert.equal(dueCelebrations(base, "Alex", P(2026, 3, 15)).length, 0);

// 2) Désactivé / interrupteur général coupé => rien
assert.equal(dueCelebrations({ ...base, celebrations_enabled: false }, "Alex", P(2026, 3, 14)).length, 0);
assert.equal(dueCelebrations({ ...base, birthday_enabled: false }, "Alex", P(2026, 3, 14)).length, 0);
assert.equal(dueCelebrations(null, "Alex", P(2026, 3, 14)).length, 0);

// 3) 29 février : le 28 février les années non bissextiles, le 29 les années bissextiles (et pas le 28)
const leapDay: CelebrationPrefs = { ...base, birth_month: 2, birth_day: 29 };
assert.equal(dueCelebrations(leapDay, "A", P(2027, 2, 28)).length, 1);
assert.equal(dueCelebrations(leapDay, "A", P(2028, 2, 28)).length, 0);
assert.equal(dueCelebrations(leapDay, "A", P(2028, 2, 29)).length, 1);

// 4) Dates invalides ignorées (jamais de date inventée)
assert.ok(!isValidMonthDay(2, 30) && !isValidMonthDay(13, 1) && !isValidMonthDay(4, 31) && isValidMonthDay(2, 29));
assert.equal(dueCelebrations({ ...base, birth_month: 2, birth_day: 30 }, "A", P(2026, 3, 2)).length, 0);

// 5) Fête personnelle + fêtes fixes choisies uniquement
const prefs: CelebrationPrefs = { celebrations_enabled: true, feast_enabled: true, feast_month: 5, feast_day: 20, holidays: ["national-day"] };
const may20 = dueCelebrations(prefs, "Alex", P(2026, 5, 20));
assert.deepEqual(may20.map((c) => c.key).sort(), ["feast", "holiday:national-day"]);
assert.equal(dueCelebrations({ celebrations_enabled: true, holidays: [] }, "A", P(2026, 5, 20)).length, 0, "fête non choisie => pas de message");
assert.equal(dueCelebrations({ celebrations_enabled: true, holidays: ["inconnue"] }, "A", P(2026, 5, 20)).length, 0);

// 6) Clés distinctes (anti-doublon par utilisateur / clé / année) et prénom assaini
assert.equal(new Set(may20.map((c) => c.key)).size, may20.length);
assert.ok(!dueCelebrations(base, "Al<script>\nex", P(2026, 3, 14))[0].title.includes("<"));

// 7) Fuseau : la date locale décide, pas l'UTC
const t = new Date("2026-05-19T23:30:00Z");
const douala = localDateParts(t, "Africa/Douala"); // UTC+1 => 20 mai, 00 h 30
assert.deepEqual([douala.month, douala.day, douala.hour], [5, 20, 0]);
assert.equal(isSendWindow(douala), false, "jamais d'envoi à minuit");
const nyc = localDateParts(t, "America/New_York"); // UTC-4 => 19 mai, 19 h 30
assert.deepEqual([nyc.month, nyc.day, nyc.hour], [5, 19, 19]);
assert.equal(isSendWindow(localDateParts(new Date("2026-05-20T07:00:00Z"), "Africa/Douala")), true, "8 h locale à Douala");
assert.equal(localDateParts(t, "Fuseau/Invalide").day, 20, "fuseau invalide => fuseau par défaut, sans exception");
assert.equal(localDateParts(t, null).day, 20);

console.log("celebrations : tous les tests passent");
