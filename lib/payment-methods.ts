// Moyens de paiement Premium — Notch Pay uniquement.
// Les anciens (MTN, Orange, PayPal, CamPay, Lygos, Monetbil, CinetPay) : RETIRÉS, ils ne donnaient pas.
// Study Helper ne demande JAMAIS : PIN, CVV, numéro de carte.

import { DEFAULT_COUNTRY, parseMobileNumber } from "./payment-countries";

export type ProviderId = "notchpay";
export type PaymentMethodId = "notchpay";

export type PaymentMethod = {
  id: PaymentMethodId;
  label: string;
  tagline: string;
  provider: ProviderId;
  logo: string;
  requiresPhone: boolean;
  flow: "push" | "redirect";
};

export const PAYMENT_METHODS: Record<PaymentMethodId, PaymentMethod> = {
  notchpay: {
    id: "notchpay",
    label: "Notch Pay",
    tagline: "MTN MoMo, Orange Money, Carte - Paiement sécurisé",
    provider: "notchpay",
    logo: "/payment/notchpay.svg",
    requiresPhone: true,
    flow: "push",
  },
};

export type MethodTraits = { provider: ProviderId; requiresPhone: boolean; flow: "push" | "redirect" };

export function providerIdForMethod(id: PaymentMethodId): ProviderId {
  return PAYMENT_METHODS[id].provider;
}

export function methodTraits(id: PaymentMethodId): MethodTraits {
  const m = PAYMENT_METHODS[id];
  return { provider: m.provider, requiresPhone: m.requiresPhone, flow: m.flow };
}

export const CHECKOUT_METHODS: PaymentMethodId[] = ["notchpay"];

export function isPaymentMethodId(value: unknown): value is PaymentMethodId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PAYMENT_METHODS, value);
}

export function methodRequiresPhone(id: PaymentMethodId): boolean {
  return PAYMENT_METHODS[id].requiresPhone;
}

export function methodLabel(method: string | null | undefined, provider?: string | null): string {
  if (method && isPaymentMethodId(method)) return PAYMENT_METHODS[method].label;
  if (method === "mtn") return "MTN MoMo (ancien)";
  if (method === "orange") return "Orange Money (ancien)";
  if (method === "mastercard") return "Mastercard";
  if (method === "visa") return "Carte Visa";
  if (provider === "monetbil" || provider === "campay" || provider === "cinetpay") return "Mobile Money";
  return method ?? "—";
}

export const PHONE_COUNTRY_CODE = "237";
const NATIONAL_MOBILE = /^6\d{8}$/;

export const PHONE_REQUIRED_MESSAGE = "Le numéro de téléphone est obligatoire.";
export const PHONE_INVALID_COUNTRY_MESSAGE = "Numéro invalide pour ce pays : saisis ton numéro mobile avec ou sans l'indicatif.";
export const PHONE_INVALID_MESSAGE = "Numéro invalide : saisis 9 chiffres commençant par 6 (ex. 6XX XXX XXX).";

export type PhoneCheck =
  | { ok: true; national: string; international: string }
  | { ok: false; error: string };

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

export function maskPhone(national: string): string {
  return `${national.slice(0, 1)}•• ••• •${national.slice(-2)}`;
}
