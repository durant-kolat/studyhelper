// Moyens de paiement Premium — partagés entre le navigateur (choix, champ téléphone) et le serveur (routage vers le bon
// prestataire, validation). Aucun secret ici.
//
//   MTN MoMo      → API MTN Mobile Money directe : la demande de paiement arrive sur le téléphone du client, qui la confirme
//                   lui-même chez l'opérateur.
//   Orange Money  → API Orange Money (Web Payment) directe : page officielle Orange, code à usage unique obtenu par USSD.
//   Visa / Mastercard → page de paiement sécurisée de PayPal (carte saisie UNIQUEMENT chez PayPal, jamais dans Study Helper).
//   PayPal        → page de paiement PayPal (compte PayPal ou carte).
//
// Anciens prestataires (CamPay, Lygos, Monetbil, CinetPay) : RETIRÉS du circuit de paiement ; leurs transactions restent dans la
// base (historique) et s'affichent toujours (voir methodLabel).
//
// Study Helper ne demande, ne reçoit et n'enregistre JAMAIS : PIN MoMo, PIN Orange Money, CVV, numéro de carte, date d'expiration.

import { DEFAULT_COUNTRY, parseMobileNumber } from "./payment-countries";

export type ProviderId = "mtn" | "orange" | "paypal";
export type PaymentMethodId = "mtn" | "orange" | "card" | "paypal";

export type PaymentMethod = {
  id: PaymentMethodId;
  label: string;
  /** Une phrase qui explique le parcours au client. */
  tagline: string;
  provider: ProviderId;
  /** Logo servi depuis /public/payment (aucune dépendance externe). */
  logo: string;
  /** Le numéro de téléphone est demandé (Mobile Money : la demande de paiement est envoyée à ce numéro). */
  requiresPhone: boolean;
  /** push = confirmation sur le téléphone ; redirect = page officielle du prestataire. */
  flow: "push" | "redirect";
};

export const PAYMENT_METHODS: Record<PaymentMethodId, PaymentMethod> = {
  mtn: {
    id: "mtn",
    label: "MTN MoMo",
    tagline: "Confirmation directement sur votre téléphone",
    provider: "mtn",
    logo: "/payment/mtn-momo.svg",
    requiresPhone: true,
    flow: "push",
  },
  orange: {
    id: "orange",
    label: "Orange Money",
    tagline: "Page officielle Orange Money — code reçu par USSD",
    provider: "orange",
    logo: "/payment/orange-money.svg",
    requiresPhone: false,
    flow: "redirect",
  },
  card: {
    id: "card",
    label: "Visa / Mastercard",
    tagline: "Carte bancaire — saisie sur la page sécurisée du prestataire",
    provider: "paypal",
    logo: "/payment/visa-mastercard.svg",
    requiresPhone: false,
    flow: "redirect",
  },
  paypal: {
    id: "paypal",
    label: "PayPal",
    tagline: "Paiement sécurisé sur la page PayPal",
    provider: "paypal",
    logo: "/payment/paypal.svg",
    requiresPhone: false,
    flow: "redirect",
  },
};

export type MethodTraits = { provider: ProviderId; requiresPhone: boolean; flow: "push" | "redirect" };

/** Prestataire qui traite un moyen de paiement (le serveur ne se fie jamais au navigateur pour le déterminer). */
export function providerIdForMethod(id: PaymentMethodId): ProviderId {
  return PAYMENT_METHODS[id].provider;
}

export function methodTraits(id: PaymentMethodId): MethodTraits {
  const m = PAYMENT_METHODS[id];
  return { provider: m.provider, requiresPhone: m.requiresPhone, flow: m.flow };
}

/** Ordre d'affichage dans la fiche de paiement. */
export const CHECKOUT_METHODS: PaymentMethodId[] = ["mtn", "orange", "card", "paypal"];

export function isPaymentMethodId(value: unknown): value is PaymentMethodId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PAYMENT_METHODS, value);
}

export function methodRequiresPhone(id: PaymentMethodId): boolean {
  return PAYMENT_METHODS[id].requiresPhone;
}

/** Libellé d'un moyen de paiement enregistré, y compris les ANCIENNES valeurs de l'historique (CamPay, Lygos, Monetbil, CinetPay). */
export function methodLabel(method: string | null | undefined, provider?: string | null): string {
  if (method && isPaymentMethodId(method)) return PAYMENT_METHODS[method].label;
  if (method === "mastercard") return "Mastercard";
  if (method === "visa") return "Carte Visa";
  if (provider === "monetbil" || provider === "campay" || provider === "cinetpay") return "Mobile Money";
  return method ?? "—";
}

// ---------------------------------------------------------------------------
// Numéro de téléphone (Cameroun). Modifie ces constantes pour un autre pays.
// ---------------------------------------------------------------------------

export const PHONE_COUNTRY_CODE = "237"; // Cameroun : pays par défaut (le registre complet est dans lib/payment-countries.ts)
const NATIONAL_MOBILE = /^6\d{8}$/; // 9 chiffres, commence par 6

export const PHONE_REQUIRED_MESSAGE = "Le numéro de téléphone est obligatoire.";
export const PHONE_INVALID_COUNTRY_MESSAGE = "Numéro invalide pour ce pays : saisis ton numéro mobile avec ou sans l'indicatif.";
export const PHONE_INVALID_MESSAGE =
  "Numéro invalide : saisis 9 chiffres commençant par 6 (ex. 6XX XXX XXX).";

export type PhoneCheck =
  | { ok: true; /** 9 chiffres */ national: string; /** 237 + 9 chiffres (MSISDN) */ international: string }
  | { ok: false; error: string };

/**
 * Valide et normalise un numéro mobile camerounais.
 * Accepte « 677 12 34 56 », « 677-12-34-56 », « +237 677 12 34 56 », « 00237677123456 »…
 */
export function validateMobileMoneyPhone(input: string | null | undefined, country: string = DEFAULT_COUNTRY): PhoneCheck {
  if (country !== DEFAULT_COUNTRY) {
    const r = parseMobileNumber(input, country);
    if (r.ok) return { ok: true, national: r.national, international: r.international };
    return { ok: false, error: r.reason === "required" ? PHONE_REQUIRED_MESSAGE : PHONE_INVALID_COUNTRY_MESSAGE };
  }
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: PHONE_REQUIRED_MESSAGE };

  let digits = raw.replace(/[\s.\-()\u00a0]/g, "");
  if (!/^\+?\d+$/.test(digits)) return { ok: false, error: PHONE_INVALID_MESSAGE };
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith(PHONE_COUNTRY_CODE) && digits.length === PHONE_COUNTRY_CODE.length + 9) {
    digits = digits.slice(PHONE_COUNTRY_CODE.length);
  }

  if (!NATIONAL_MOBILE.test(digits)) return { ok: false, error: PHONE_INVALID_MESSAGE };
  return { ok: true, national: digits, international: `${PHONE_COUNTRY_CODE}${digits}` };
}

/** « 677123456 » → « 6•• ••• •56 » : de quoi s'y retrouver sans stocker le numéro complet. */
export function maskPhone(national: string): string {
  return `${national.slice(0, 1)}•• ••• •${national.slice(-2)}`;
}
