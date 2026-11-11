// Pays de paiement : registre CENTRAL (module PUR, serveur + navigateur, aucun secret).
// Ajouter un pays = ajouter UNE ligne ici (+ ses identifiants opérateur dans l'environnement) ; aucune page à modifier.
//
// ⚠️ Un pays n'est jamais « disponible » parce qu'il figure ici : il faut (1) l'activer dans NEXT_PUBLIC_PAYMENT_COUNTRIES,
// (2) avoir un contrat / des identifiants opérateur pour CE pays, (3) avoir défini le tarif dans sa devise (voir lib/premium.ts).
// Les formats de numéro sont des plages d'aide à la saisie : l'opérateur reste juge de la validité d'un numéro. Seul le Cameroun est
// contrôlé strictement (9 chiffres commençant par 6). Les autres pays sont marqués verified:false → à confirmer à l'activation.
//
// Sources de la couverture opérateurs : Orange Money Web Payment (page officielle developer.orange.com/apis/om-webpay :
// Mali, Cameroun, Côte d'Ivoire, Sénégal, Madagascar, Botswana, Guinée, Guinée-Bissau, Sierra Leone, RD Congo, Centrafrique) ;
// MTN MoMo API (environnements pays du portail partenaire MTN : à confirmer par MTN pour chaque contrat).

export type CountryConfig = {
  /** ISO 3166-1 alpha-2 */
  code: string;
  /** Indicatif téléphonique, sans « + » */
  dial: string;
  /** Devise de facturation (ISO 4217) */
  currency: string;
  /** Longueur du numéro national (sans indicatif ni 0 initial facultatif) */
  minDigits: number;
  maxDigits: number;
  /** Exemple affiché dans le champ de saisie */
  example: string;
  /** Contrôle strict supplémentaire (Cameroun) */
  strict?: RegExp;
  /** L'opérateur existe dans ce pays (couverture ≠ disponibilité : voir l'avertissement ci-dessus) */
  mtn: boolean;
  orange: boolean;
  /** Format validé en production avec l'opérateur ? */
  verified: boolean;
};

export const DEFAULT_COUNTRY = "CM";

export const COUNTRIES: CountryConfig[] = [
  { code: "CM", dial: "237", currency: "XAF", minDigits: 9, maxDigits: 9, example: "677 12 34 56", strict: /^6\d{8}$/, mtn: true, orange: true, verified: true },
  { code: "CI", dial: "225", currency: "XOF", minDigits: 10, maxDigits: 10, example: "07 12 34 56 78", mtn: true, orange: true, verified: false },
  { code: "SN", dial: "221", currency: "XOF", minDigits: 9, maxDigits: 9, example: "77 123 45 67", mtn: false, orange: true, verified: false },
  { code: "ML", dial: "223", currency: "XOF", minDigits: 8, maxDigits: 8, example: "76 12 34 56", mtn: false, orange: true, verified: false },
  { code: "GW", dial: "245", currency: "XOF", minDigits: 9, maxDigits: 9, example: "955 123 456", mtn: false, orange: true, verified: false },
  { code: "BJ", dial: "229", currency: "XOF", minDigits: 10, maxDigits: 10, example: "01 97 12 34 56", mtn: true, orange: false, verified: false },
  { code: "CF", dial: "236", currency: "XAF", minDigits: 8, maxDigits: 8, example: "72 12 34 56", mtn: false, orange: true, verified: false },
  { code: "CG", dial: "242", currency: "XAF", minDigits: 9, maxDigits: 9, example: "06 123 4567", mtn: true, orange: false, verified: false },
  { code: "CD", dial: "243", currency: "CDF", minDigits: 9, maxDigits: 9, example: "81 234 5678", mtn: false, orange: true, verified: false },
  { code: "GN", dial: "224", currency: "GNF", minDigits: 9, maxDigits: 9, example: "620 12 34 56", mtn: true, orange: true, verified: false },
  { code: "SL", dial: "232", currency: "SLE", minDigits: 8, maxDigits: 8, example: "076 123 456", mtn: false, orange: true, verified: false },
  { code: "LR", dial: "231", currency: "LRD", minDigits: 7, maxDigits: 9, example: "077 123 4567", mtn: true, orange: false, verified: false },
  { code: "GH", dial: "233", currency: "GHS", minDigits: 9, maxDigits: 9, example: "024 123 4567", mtn: true, orange: false, verified: false },
  { code: "UG", dial: "256", currency: "UGX", minDigits: 9, maxDigits: 9, example: "077 123 4567", mtn: true, orange: false, verified: false },
  { code: "ZM", dial: "260", currency: "ZMW", minDigits: 9, maxDigits: 9, example: "096 123 4567", mtn: true, orange: false, verified: false },
  { code: "ZA", dial: "27", currency: "ZAR", minDigits: 9, maxDigits: 9, example: "082 123 4567", mtn: true, orange: false, verified: false },
  { code: "SZ", dial: "268", currency: "SZL", minDigits: 8, maxDigits: 8, example: "7612 3456", mtn: true, orange: false, verified: false },
  { code: "MG", dial: "261", currency: "MGA", minDigits: 9, maxDigits: 9, example: "034 12 345 67", mtn: false, orange: true, verified: false },
  { code: "BW", dial: "267", currency: "BWP", minDigits: 8, maxDigits: 8, example: "71 234 567", mtn: false, orange: true, verified: false },
  // Autre pays (carte Visa / Mastercard et PayPal seulement, facturés dans la devise internationale du prestataire). ZZ = « région non précisée » (ISO).
  { code: "ZZ", dial: "", currency: "EUR", minDigits: 0, maxDigits: 0, example: "", mtn: false, orange: false, verified: true },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function normalizeCountryCode(input: unknown): string | null {
  return typeof input === "string" && /^[A-Za-z]{2}$/.test(input.trim()) ? input.trim().toUpperCase() : null;
}
export const getCountry = (code: unknown): CountryConfig | null => BY_CODE.get(normalizeCountryCode(code) ?? "") ?? null;

// ---------------------------------------------------------------------------
// Pays ACTIVÉS (aiguillage non secret, lu par le serveur ET par l'interface). Défaut : Cameroun seul.
// NEXT_PUBLIC_PAYMENT_COUNTRIES = « CM » | « CM,CI,SN » | « ALL » (tous ceux du registre : à n'utiliser qu'avec tous les contrats en place).
// ---------------------------------------------------------------------------
const ENV_COUNTRIES = process.env.NEXT_PUBLIC_PAYMENT_COUNTRIES;
export function enabledCountryCodes(raw: string | null | undefined = ENV_COUNTRIES): string[] {
  const value = (raw ?? "").trim();
  if (!value) return [DEFAULT_COUNTRY];
  if (value.toUpperCase() === "ALL") return COUNTRIES.map((c) => c.code);
  const codes = value.split(",").map((s) => normalizeCountryCode(s)).filter((c): c is string => c !== null && BY_CODE.has(c));
  return codes.length ? [...new Set(codes)] : [DEFAULT_COUNTRY];
}

export type MethodAvailability = { mtn: boolean; orange: boolean; card: boolean; paypal: boolean };

/**
 * Moyens PROPOSABLES dans un pays (règle statique, sans secret). La disponibilité RÉELLE (identifiants configurés, tarif défini)
 * est décidée par le serveur : voir /api/payments/methods. MTN / Orange n'existent que dans les pays où l'opérateur opère ;
 * la carte Visa / Mastercard et PayPal (page du prestataire) s'adressent à tout pays activé.
 */
export function availableMethods(countryCode: string, enabled: string[] = enabledCountryCodes()): MethodAvailability {
  const c = getCountry(countryCode);
  if (!c || !enabled.includes(c.code)) return { mtn: false, orange: false, card: false, paypal: false };
  return { mtn: c.mtn, orange: c.orange, card: true, paypal: true };
}

export const isCfaCurrency = (currency: string) => currency === "XAF" || currency === "XOF";

// ---------------------------------------------------------------------------
// Numéro de téléphone mobile, par pays
// ---------------------------------------------------------------------------
export type PhoneResult = { ok: true; national: string; international: string } | { ok: false; reason: "required" | "invalid" };

/**
 * Accepte « 677 12 34 56 », « 0241234567 », « +233 24 123 4567 », « 00233241234567 ». Un 0 initial est retiré seulement s'il
 * dépasse la longueur attendue (en Côte d'Ivoire et au Bénin, le 0 fait partie du numéro). Le pays choisi décide : jamais l'adresse IP.
 */
export function parseMobileNumber(input: string | null | undefined, countryCode: string = DEFAULT_COUNTRY): PhoneResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "required" };
  const country = getCountry(countryCode);
  if (!country || country.code === "ZZ") return { ok: false, reason: "invalid" };

  let digits = raw.replace(/[\s.\-()\u00a0]/g, "");
  if (!/^\+?\d+$/.test(digits)) return { ok: false, reason: "invalid" };
  const international = digits.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);

  if (international) {
    if (!digits.startsWith(country.dial)) return { ok: false, reason: "invalid" }; // indicatif d'un autre pays
    digits = digits.slice(country.dial.length);
  } else if (digits.startsWith(country.dial) && digits.length === country.dial.length + country.maxDigits) {
    digits = digits.slice(country.dial.length);
  }
  if (digits.startsWith("0") && digits.length > country.maxDigits) digits = digits.slice(1);

  if (digits.length < country.minDigits || digits.length > country.maxDigits) return { ok: false, reason: "invalid" };
  if (country.strict && !country.strict.test(digits)) return { ok: false, reason: "invalid" };
  return { ok: true, national: digits, international: `${country.dial}${digits}` };
}

// ---------------------------------------------------------------------------
// Affichage selon la LANGUE de l'utilisateur
// ---------------------------------------------------------------------------
/** Nom du pays dans la langue de l'interface (Intl.DisplayNames), jamais dans une langue figée. */
export function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Drapeau (emoji) à partir du code pays. */
export function countryFlag(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";
}

/** Prix formaté selon la langue ET la devise (ex. fr : « 2 500 FCFA », en : « XAF 2,500 »). */
export function formatMoney(amount: number, currency: string, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Aide à la saisie : pays proposé d'après la région de la langue du navigateur (« fr-CM » → CM) si ce pays est activé. Corrigeable. */
export function suggestCountry(locales: readonly string[], enabled: string[] = enabledCountryCodes()): string {
  for (const l of locales) {
    const region = /[-_]([A-Za-z]{2})(?:$|[-_])/.exec(l)?.[1]?.toUpperCase();
    if (region && enabled.includes(region) && BY_CODE.has(region)) return region;
  }
  return enabled[0] ?? DEFAULT_COUNTRY;
}
