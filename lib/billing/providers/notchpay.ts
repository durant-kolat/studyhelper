// Notch Pay — Paiement unifié (MTN MoMo + Orange Money + carte). SERVEUR UNIQUEMENT.
//
//   Initier   POST {base}/payments/initialize        Authorization: <clé publique>
//               corps : { amount, currency, email, description, reference, callback, channels }
//               → { transaction: { reference, authorization_url } }
//   Vérifier  GET  {base}/payments/{reference}       Authorization: <clé privée>
//               → { transaction: { status: complete | failed | canceled | expired | pending, amount, currency, reference } }
//
// Parcours client : redirection vers la page Notch Pay, le client choisit MTN / Orange / carte.
// Study Helper ne voit ni ne demande JAMAIS le code secret du client.
//
// Variables (serveur uniquement) :
//   NOTCHPAY_PUBLIC_KEY   clé publique (initiation)
//   NOTCHPAY_PRIVATE_KEY  clé privée (vérification)
//   NOTCHPAY_BASE_URL     défaut : https://api.notchpay.co
//   NOTCHPAY_CURRENCY     défaut : devise du pays (XAF pour CM)

import { randomUUID } from "crypto";
import { DEFAULT_COUNTRY, getCountry } from "../../payment-countries";
import type { InitResult, PaymentForCheck, PaymentProvider, ProviderCheck, ProviderPaymentContext } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_BASE = "https://api.notchpay.co";

type Env = Record<string, string | undefined>;
const val = (env: Env, name: string) => env[name]?.trim() ?? "";

export function notchpayConfig(env: Env = process.env, country: string = DEFAULT_COUNTRY) {
  const cc = country.toUpperCase();
  const pick = (name: string) => val(env, `NOTCHPAY_${cc}_${name}`) || (cc === DEFAULT_COUNTRY ? val(env, `NOTCHPAY_${name}`) : "");
  return {
    base: (pick("BASE_URL") || val(env, "NOTCHPAY_BASE_URL") || DEFAULT_BASE).replace(/\/+$/, ""),
    publicKey: pick("PUBLIC_KEY") || val(env, "NOTCHPAY_PUBLIC_KEY"),
    privateKey: pick("PRIVATE_KEY") || val(env, "NOTCHPAY_PRIVATE_KEY"),
    currency: ((pick("CURRENCY") || val(env, "NOTCHPAY_CURRENCY") || getCountry(cc)?.currency || "XAF").toUpperCase()),
  };
}

export function isNotchpayConfigured(env: Env = process.env, country: string = DEFAULT_COUNTRY): boolean {
  const c = notchpayConfig(env, country);
  return Boolean(c.publicKey && c.privateKey);
}

async function initiate(ctx: ProviderPaymentContext): Promise<InitResult> {
  const country = ctx.country || DEFAULT_COUNTRY;
  if (!getCountry(country) || !isNotchpayConfigured(process.env, country)) {
    return { ok: false, error: notchpayProvider.unavailableMessage, code: "payment_unavailable" };
  }
  if (!Number.isInteger(ctx.amount) || ctx.amount <= 0) {
    return { ok: false, error: "Montant invalide.", code: "invalid_amount" };
  }
  const c = notchpayConfig(process.env, country);

  let res: Response;
  try {
    res = await fetch(`${c.base}/payments/initialize`, {
      method: "POST",
      headers: {
        Authorization: c.publicKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: ctx.amount,
        currency: c.currency,
        email: ctx.customerEmail || "client@studyhelper.cm",
        name: ctx.customerName || "Study Helper",
        description: ctx.description.replace(/\s+/g, " ").trim().slice(0, 100) || "Study Helper",
        reference: ctx.ref,
        callback: ctx.urls.return,
        channels: ["momo", "card"],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[notchpay] initialize injoignable :", err instanceof Error ? err.message : err);
    return { ok: false, error: "Impossible de joindre Notch Pay, réessaie dans un instant." };
  }

  const json = (await res.json().catch(() => ({}))) as {
    transaction?: { reference?: string; authorization_url?: string };
    message?: string;
  };

  if (!res.ok || !json.transaction?.authorization_url) {
    console.error(`[notchpay] initialize refusé HTTP ${res.status} :`, json.message ?? "");
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: notchpayProvider.unavailableMessage, code: "payment_unavailable" };
    }
    return { ok: false, error: "Notch Pay est momentanément indisponible, réessaie dans un instant." };
  }

  return {
    ok: true,
    flow: "redirect",
    url: json.transaction.authorization_url,
    meta: { notchpay_reference: ctx.ref, country, notchpay_currency: c.currency },
  };
}

type NotchpayStatusBody = {
  transaction?: {
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    reference?: unknown;
    channel?: unknown;
  };
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function parseNotchpayStatus(json: NotchpayStatusBody): ProviderCheck {
  const t = json.transaction ?? {};
  const status = typeof t.status === "string" ? t.status.trim().toLowerCase() : "";
  const amount = t.amount !== undefined && t.amount !== null && t.amount !== "" ? Number(t.amount) : null;

  let outcome: ProviderCheck["outcome"] = "pending";
  if (status === "complete" || status === "completed" || status === "success" || status === "successful") outcome = "success";
  else if (status === "failed" || status === "failure") outcome = "failed";
  else if (status === "canceled" || status === "cancelled") outcome = "cancelled";
  else if (status === "expired" || status === "timeout") outcome = "expired";

  return {
    outcome,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency: str(t.currency)?.toUpperCase() ?? null,
    providerTxnId: str(t.reference),
    reason: status && status !== "pending" ? status : null,
    echoRef: str(t.reference),
    userRef: null,
  };
}

async function check(payment: PaymentForCheck): Promise<ProviderCheck> {
  const ref = payment.meta && typeof payment.meta.notchpay_reference === "string" ? payment.meta.notchpay_reference : payment.provider_ref;
  const country = payment.meta && typeof payment.meta.country === "string" ? payment.meta.country : DEFAULT_COUNTRY;
  const c = notchpayConfig(process.env, country);
  if (!c.privateKey) throw new Error("notchpay non configuré");

  const res = await fetch(`${c.base}/payments/${encodeURIComponent(ref)}`, {
    method: "GET",
    headers: { Authorization: c.privateKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404) {
    return { outcome: "pending", amount: null, currency: null, providerTxnId: null, reason: "not_found", echoRef: null, userRef: null };
  }
  if (!res.ok) throw new Error(`notchpay status HTTP ${res.status}`);
  return parseNotchpayStatus((await res.json()) as NotchpayStatusBody);
}

export const notchpayProvider: PaymentProvider = {
  id: "notchpay",
  capabilities: { autoRenew: false },
  currency: (country) => notchpayConfig(process.env, country ?? DEFAULT_COUNTRY).currency,
  pendingTtlMinutes: 15,
  isConfigured: (country) => isNotchpayConfigured(process.env, country ?? DEFAULT_COUNTRY),
  unavailableMessage: "Notch Pay n'est pas encore disponible. Réessaie plus tard.",
  newReference: () => randomUUID(),
  initiate,
  check,
};
