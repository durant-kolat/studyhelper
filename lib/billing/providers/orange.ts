// Orange Money — « Web Payment / M Payment » DIRECT. SERVEUR UNIQUEMENT.
//
//   Jeton      POST {base}/oauth/v3/token                    Authorization: <en-tête fourni par la console Orange>
//                                                             corps : grant_type=client_credentials   → { access_token, expires_in }
//   Demander   POST {base}/orange-money-webpay/{pays}/v1/webpayment        Authorization: Bearer <jeton>
//                  corps : { merchant_key, currency, order_id, amount, return_url, cancel_url, notif_url, lang, reference }
//                  → { pay_token, payment_url, notif_token }
//   Statut     POST {base}/orange-money-webpay/{pays}/v1/transactionstatus  corps : { order_id, amount, pay_token }
//                  → { status: INITIATED | PENDING | EXPIRED | SUCCESS | FAILED, order_id, txnid }
//   Notif      Orange appelle notif_url (POST) avec { status, notif_token, txnid } : sert UNIQUEMENT de déclencheur ;
//              la preuve de paiement est l'interrogation « transactionstatus » (voir settle.ts).
//
// Parcours client : redirection vers la page officielle Orange Money (payment_url) ; le client y saisit un code à usage
// unique (OTP) obtenu par USSD. Study Helper ne demande, ne voit et n'enregistre JAMAIS ce code ni le PIN Orange Money.
//
// ⚠️ Service RÉSERVÉ aux marchands Orange Money enregistrés (KYA) : inscription dans une boutique Orange du pays
// (documents d'entreprise requis). Les URL, le code pays et la devise sont ceux de TON contrat : à confirmer dans la
// documentation Orange fournie à l'inscription. Bac à sable : pays « dev », devise « OUV ».
//
// Variables (serveur uniquement) :
//   ORANGE_MONEY_AUTH_HEADER   valeur de l'en-tête « Authorization » donnée par la console Orange (« Basic xxxx »)
//   ORANGE_MONEY_MERCHANT_KEY  clé marchand
//   ORANGE_MONEY_COUNTRY       « dev » (bac à sable, défaut) ou le code pays de production (ex. « cm »)
//   ORANGE_MONEY_CURRENCY      défaut : « OUV » en bac à sable, « XAF » sinon
//   ORANGE_MONEY_BASE_URL      défaut https://api.orange.com

import { randomUUID } from "crypto";
import { DEFAULT_COUNTRY, getCountry } from "../../payment-countries";
import type { InitResult, PaymentForCheck, PaymentProvider, ProviderCheck, ProviderPaymentContext } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;

type Env = Record<string, string | undefined>;
const val = (env: Env, name: string) => env[name]?.trim() ?? "";

/**
 * Configuration d'un PAYS : ORANGE_MONEY_<CC>_<NOM> (ex. ORANGE_MONEY_CI_MERCHANT_KEY). Les variables sans suffixe ne valent que
 * pour le pays par défaut (Cameroun). ORANGE_MONEY_<CC>_COUNTRY = segment d'URL de l'API pour ce pays (« dev » = bac à sable).
 */
export function orangeConfig(env: Env = process.env, country: string = DEFAULT_COUNTRY) {
  const cc = country.toUpperCase();
  const pick = (name: string) => val(env, `ORANGE_MONEY_${cc}_${name}`) || (cc === DEFAULT_COUNTRY ? val(env, `ORANGE_MONEY_${name}`) : "");
  const apiCountry = (pick("COUNTRY") || "dev").toLowerCase();
  const sandbox = apiCountry === "dev";
  const auth = pick("AUTH_HEADER");
  return {
    base: (val(env, "ORANGE_MONEY_BASE_URL") || "https://api.orange.com").replace(/\/+$/, ""),
    country: apiCountry,
    sandbox,
    authHeader: auth && !/^(basic|bearer)\s/i.test(auth) ? `Basic ${auth}` : auth,
    merchantKey: pick("MERCHANT_KEY"),
    currency: (pick("CURRENCY") || (sandbox ? "OUV" : getCountry(cc)?.currency || "XAF")).toUpperCase(),
  };
}

export function isOrangeConfigured(env: Env = process.env, country: string = DEFAULT_COUNTRY): boolean {
  const c = orangeConfig(env, country);
  return Boolean(c.authHeader && c.merchantKey);
}

/** L'URL de paiement renvoyée par Orange n'est suivie que si elle est en https sur un domaine Orange (jamais une redirection ouverte). */
export function isTrustedOrangePaymentUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "orange-money.com" || u.hostname.endsWith(".orange-money.com") || u.hostname.endsWith(".orange.com"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Jeton d'accès (cache mémoire)
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>(); // un jeton par pays

async function getToken(country: string, force = false): Promise<string> {
  const cached = tokenCache.get(country);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  const c = orangeConfig(process.env, country);
  if (!isOrangeConfigured(process.env, country)) throw new Error("orange non configuré");
  const res = await fetch(`${c.base}/oauth/v3/token`, {
    method: "POST",
    headers: { Authorization: c.authHeader, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`orange token HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number | string };
  if (!json.access_token) throw new Error("orange token absent");
  const ttl = Number(json.expires_in) > 120 ? Number(json.expires_in) : 3600;
  tokenCache.set(country, { token: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 });
  return json.access_token;
}

async function orangeFetch(country: string, path: string, body: unknown) {
  const c = orangeConfig(process.env, country);
  const call = async (token: string) =>
    fetch(`${c.base}/orange-money-webpay/${c.country}/v1/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  let res = await call(await getToken(country));
  if (res.status === 401) res = await call(await getToken(country, true));
  return res;
}

// ---------------------------------------------------------------------------
// Initiation : webpayment
// ---------------------------------------------------------------------------

/** Corps du « webpayment » (pur : testable). Le montant est un entier ; order_id = NOTRE référence. */
export function buildWebPayment(ctx: ProviderPaymentContext, merchantKey: string, currency: string) {
  return {
    merchant_key: merchantKey,
    currency,
    order_id: ctx.ref,
    amount: ctx.amount,
    return_url: ctx.urls.return,
    cancel_url: ctx.urls.cancel,
    notif_url: ctx.urls.notify,
    lang: "fr",
    reference: "Study Helper",
  };
}

async function initiate(ctx: ProviderPaymentContext): Promise<InitResult> {
  const country = ctx.country || DEFAULT_COUNTRY;
  if (!getCountry(country) || !isOrangeConfigured(process.env, country)) return { ok: false, error: orangeProvider.unavailableMessage, code: "payment_unavailable" };
  if (!Number.isInteger(ctx.amount) || ctx.amount <= 0) return { ok: false, error: "Montant invalide.", code: "invalid_amount" };
  const c = orangeConfig(process.env, country);

  let res: Response;
  try {
    res = await orangeFetch(country, "webpayment", buildWebPayment(ctx, c.merchantKey, c.currency));
  } catch (err) {
    console.error("[orange] webpayment injoignable :", err instanceof Error ? err.message : err);
    return { ok: false, error: "Impossible de joindre Orange Money, réessaie dans un instant." };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[orange] webpayment refusé HTTP ${res.status} :`, detail.replace(/\d{9,}/g, "•••").slice(0, 300));
    if (res.status === 401 || res.status === 403) return { ok: false, error: orangeProvider.unavailableMessage, code: "payment_unavailable" };
    return { ok: false, error: "Orange Money est momentanément indisponible, réessaie dans un instant." };
  }
  const json = (await res.json().catch(() => ({}))) as { pay_token?: unknown; payment_url?: unknown; notif_token?: unknown };
  if (typeof json.pay_token !== "string" || typeof json.notif_token !== "string" || !isTrustedOrangePaymentUrl(json.payment_url)) {
    console.error("[orange] réponse webpayment incomplète ou URL de paiement non fiable.");
    return { ok: false, error: "Orange Money est momentanément indisponible, réessaie dans un instant." };
  }
  // pay_token et notif_token restent côté serveur (meta) : indispensables pour vérifier et rapprocher la notification.
  return {
    ok: true,
    flow: "redirect",
    url: json.payment_url,
    meta: { orange_pay_token: json.pay_token, orange_notif_token: json.notif_token, country },
  };
}

// ---------------------------------------------------------------------------
// Vérification : transactionstatus
// ---------------------------------------------------------------------------

type OrangeStatusBody = { status?: unknown; order_id?: unknown; txnid?: unknown; message?: unknown };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** Interprète la réponse d'Orange (pure). SUCCESS seul = payé ; tout statut inconnu = « pending ». */
export function parseOrangeStatus(json: OrangeStatusBody): ProviderCheck {
  const status = typeof json.status === "string" ? json.status.trim().toUpperCase() : "";
  let outcome: ProviderCheck["outcome"] = "pending";
  if (status === "SUCCESS" || status === "SUCCESSFUL") outcome = "success";
  else if (status === "FAILED" || status === "FAILURE") outcome = "failed";
  else if (status === "EXPIRED") outcome = "expired";
  else if (status === "CANCELLED" || status === "CANCELED") outcome = "cancelled";
  return {
    outcome,
    amount: null, // transactionstatus reçoit NOTRE montant et ne le renvoie pas : le montant attendu est celui de notre base
    currency: null,
    providerTxnId: str(json.txnid),
    reason: status && status !== "INITIATED" && status !== "PENDING" && status !== "SUCCESS" ? status : null,
    echoRef: str(json.order_id),
    userRef: null,
  };
}

async function check(payment: PaymentForCheck): Promise<ProviderCheck> {
  const payToken = payment.meta && typeof payment.meta.orange_pay_token === "string" ? payment.meta.orange_pay_token : "";
  if (!payToken) {
    return { outcome: "pending", amount: null, currency: null, providerTxnId: null, reason: "no_provider_reference", echoRef: null, userRef: null };
  }
  const country = payment.meta && typeof payment.meta.country === "string" ? payment.meta.country : DEFAULT_COUNTRY; // le pays du PAIEMENT
  const res = await orangeFetch(country, "transactionstatus", { order_id: payment.provider_ref, amount: payment.amount, pay_token: payToken });
  if (res.status === 404) return { outcome: "pending", amount: null, currency: null, providerTxnId: null, reason: "not_found", echoRef: null, userRef: null };
  if (!res.ok) throw new Error(`orange status HTTP ${res.status}`); // erreur / injoignable : réessai ultérieur, jamais « payé »
  return parseOrangeStatus((await res.json()) as OrangeStatusBody);
}

export const orangeProvider: PaymentProvider = {
  id: "orange",
  capabilities: { autoRenew: false }, // pas de prélèvement récurrent implémenté : renouvellement MANUEL
  currency: (country) => orangeConfig(process.env, country ?? DEFAULT_COUNTRY).currency,
  pendingTtlMinutes: 15,
  isConfigured: (country) => isOrangeConfigured(process.env, country ?? DEFAULT_COUNTRY),
  unavailableMessage: "Orange Money n'est pas encore disponible. Réessaie plus tard ou choisis un autre moyen de paiement.",
  // order_id : 32 caractères hexadécimaux, sans tirets (valeur courte et sûre pour l'API Orange).
  newReference: () => randomUUID().replace(/-/g, ""),
  initiate,
  check,
};
