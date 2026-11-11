// PayPal — API REST « Orders v2 » : PayPal et cartes Visa / Mastercard sur la page sécurisée de PayPal. SERVEUR UNIQUEMENT.
//
//   Jeton      POST {base}/v1/oauth2/token                  Authorization: Basic base64(clientId:secret)  corps : grant_type=client_credentials
//   Commande   POST {base}/v2/checkout/orders               Authorization: Bearer · PayPal-Request-Id: <NOTRE référence> (idempotence)
//                  corps : { intent: "CAPTURE", purchase_units: [{ custom_id, description, amount: { currency_code, value } }],
//                            payment_source: { paypal: { experience_context: { return_url, cancel_url, landing_page, user_action: "PAY_NOW" … } } } }
//                  → { id, status, links: [{ rel: "payer-action", href }] }   (le client est envoyé sur href : page PayPal)
//   Statut     GET  {base}/v2/checkout/orders/{id}          → CREATED | PAYER_ACTION_REQUIRED | APPROVED | COMPLETED | VOIDED
//   Capture    POST {base}/v2/checkout/orders/{id}/capture  quand le client a APPROUVÉ : c'est la capture qui débite le client.
//   Webhook    POST /api/payments/paypal/webhook            signature vérifiée auprès de PayPal (verify-webhook-signature).
//
// Visa / Mastercard : le client saisit sa carte UNIQUEMENT sur la page PayPal (landing_page GUEST_CHECKOUT) ; Study Helper ne voit,
// ne demande et n'enregistre jamais numéro, date d'expiration ni CVV.
//
// ⚠️ Éligibilité : PayPal REST liste le Cameroun parmi les pays pris en charge pour les comptes marchands, mais la possibilité de
// RECEVOIR des paiements, les frais, les délais de retrait et les restrictions dépendent de TON compte et sont à confirmer auprès
// de PayPal avant la mise en production. PayPal ne facture pas en francs CFA : la devise est celle de PAYPAL_CURRENCY (défaut EUR)
// et les prix viennent du tableau NEXT_PUBLIC_PREMIUM_PRICES_JSON (jamais convertis automatiquement).
//
// Variables (serveur uniquement) :
//   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET   application REST (developer.paypal.com > Apps & Credentials)
//   PAYPAL_ENV                                « sandbox » (défaut) ou « live »
//   PAYPAL_CURRENCY                           défaut EUR (devise acceptée par PayPal)
//   PAYPAL_WEBHOOK_ID                         identifiant du webhook créé dans le tableau de bord PayPal

import { randomUUID } from "crypto";
import type { InitResult, PaymentForCheck, PaymentProvider, ProviderCheck, ProviderPaymentContext } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;
type Env = Record<string, string | undefined>;
const val = (env: Env, name: string) => env[name]?.trim() ?? "";

/** Devises acceptées par PayPal (liste officielle) : toute autre valeur de PAYPAL_CURRENCY est ignorée (retour à EUR). */
const PAYPAL_CURRENCIES = new Set(["AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "TWD", "NZD", "NOK", "PHP", "PLN", "GBP", "SGD", "SEK", "CHF", "THB", "USD"]);
const ZERO_DECIMAL = new Set(["HUF", "JPY", "TWD"]);

export function paypalConfig(env: Env = process.env) {
  const live = val(env, "PAYPAL_ENV").toLowerCase() === "live";
  const cur = (val(env, "PAYPAL_CURRENCY") || "EUR").toUpperCase();
  return {
    live,
    base: live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    clientId: val(env, "PAYPAL_CLIENT_ID"),
    clientSecret: val(env, "PAYPAL_CLIENT_SECRET"),
    currency: PAYPAL_CURRENCIES.has(cur) ? cur : "EUR",
    webhookId: val(env, "PAYPAL_WEBHOOK_ID"),
  };
}

export function isPaypalConfigured(env: Env = process.env): boolean {
  const c = paypalConfig(env);
  return Boolean(c.clientId && c.clientSecret);
}

/** L'adresse de paiement n'est suivie que si elle est en https sur un domaine PayPal (jamais une redirection ouverte). */
export function isTrustedPaypalUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "paypal.com" || u.hostname.endsWith(".paypal.com"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Jeton d'accès (cache mémoire)
// ---------------------------------------------------------------------------
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const c = paypalConfig();
  if (!isPaypalConfigured()) throw new Error("paypal non configuré");
  const res = await fetch(`${c.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`paypal token HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number | string };
  if (!json.access_token) throw new Error("paypal token absent");
  const ttl = Number(json.expires_in) > 120 ? Number(json.expires_in) : 3000;
  tokenCache = { token: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return json.access_token;
}

export async function paypalFetch(path: string, init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string, string> }) {
  const c = paypalConfig();
  const call = async (token: string) =>
    fetch(`${c.base}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  let res = await call(await getToken());
  if (res.status === 401) res = await call(await getToken(true));
  return res;
}

// ---------------------------------------------------------------------------
// Création de la commande (pur → testable sans réseau)
// ---------------------------------------------------------------------------

/** Montant au format PayPal : chaîne décimale (« 4.00 »), sans décimale pour les devises qui n'en ont pas. */
export const paypalAmountValue = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency) ? String(amount) : `${amount}.00`);

export function buildOrder(ctx: ProviderPaymentContext, currency: string) {
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: ctx.ref, // NOTRE référence : revient dans les notifications et dans la capture
        description: ctx.description.replace(/\s+/g, " ").trim().slice(0, 120) || "Study Helper",
        amount: { currency_code: currency, value: paypalAmountValue(ctx.amount, currency) },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Study Helper",
          // « Visa / Mastercard » ouvre directement le formulaire carte de PayPal ; « PayPal » ouvre la connexion au compte.
          landing_page: ctx.method === "card" ? "GUEST_CHECKOUT" : "LOGIN",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: ctx.urls.return,
          cancel_url: ctx.urls.cancel,
        },
      },
    },
  };
}

async function initiate(ctx: ProviderPaymentContext): Promise<InitResult> {
  if (!isPaypalConfigured()) return { ok: false, error: paypalProvider.unavailableMessage, code: "payment_unavailable" };
  if (!Number.isInteger(ctx.amount) || ctx.amount <= 0) return { ok: false, error: "Montant invalide.", code: "invalid_amount" };
  const currency = paypalConfig().currency;

  let res: Response;
  try {
    res = await paypalFetch("/v2/checkout/orders", { method: "POST", body: buildOrder(ctx, currency), headers: { "PayPal-Request-Id": ctx.ref } });
  } catch (err) {
    console.error("[paypal] commande injoignable :", err instanceof Error ? err.message : err);
    return { ok: false, error: "Impossible de joindre PayPal, réessaie dans un instant." };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[paypal] commande refusée HTTP ${res.status} :`, detail.slice(0, 400));
    if (res.status === 401 || res.status === 403) return { ok: false, error: paypalProvider.unavailableMessage, code: "payment_unavailable" };
    return { ok: false, error: "PayPal est momentanément indisponible, réessaie dans un instant." };
  }
  const json = (await res.json().catch(() => ({}))) as { id?: unknown; links?: { rel?: string; href?: string }[] };
  const link = (json.links ?? []).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (typeof json.id !== "string" || !isTrustedPaypalUrl(link)) {
    console.error("[paypal] réponse de commande incomplète ou adresse de paiement non fiable.");
    return { ok: false, error: "PayPal est momentanément indisponible, réessaie dans un instant." };
  }
  return { ok: true, flow: "redirect", url: link, meta: { paypal_order_id: json.id, paypal_currency: currency, country: ctx.country } };
}

// ---------------------------------------------------------------------------
// Vérification : état de la commande (+ capture quand le client a approuvé)
// ---------------------------------------------------------------------------
type Capture = { id?: unknown; status?: unknown; custom_id?: unknown; amount?: { value?: unknown; currency_code?: unknown } };
type PaypalOrder = { id?: unknown; status?: unknown; purchase_units?: { custom_id?: unknown; payments?: { captures?: Capture[] } }[] };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const pending = (reason: string | null = null): ProviderCheck => ({ outcome: "pending", amount: null, currency: null, providerTxnId: null, reason, echoRef: null, userRef: null });

/**
 * Interprète une commande PayPal (pure). Résultat :
 *  - { capture: true } : le client a APPROUVÉ, il faut CAPTURER (la capture débite) ;
 *  - { check } : état normalisé. Seule une capture « COMPLETED » vaut paiement confirmé ; tout statut inconnu = « pending ».
 */
export function interpretOrder(order: PaypalOrder): { capture: true } | { check: ProviderCheck } {
  const status = typeof order.status === "string" ? order.status.toUpperCase() : "";
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const echoRef = str(unit?.custom_id) ?? str(capture?.custom_id);

  if (status === "APPROVED") return { capture: true };
  if (status === "VOIDED") return { check: { ...pending("VOIDED"), outcome: "cancelled", echoRef } };
  if (status === "COMPLETED" && capture) {
    const cs = typeof capture.status === "string" ? capture.status.toUpperCase() : "";
    const value = capture.amount?.value !== undefined ? Number(capture.amount.value) : NaN;
    const base: ProviderCheck = {
      outcome: "pending",
      amount: Number.isFinite(value) ? value : null,
      currency: str(capture.amount?.currency_code)?.toUpperCase() ?? null,
      providerTxnId: str(capture.id),
      reason: cs || null,
      echoRef,
      userRef: null,
    };
    if (cs === "COMPLETED") return { check: { ...base, outcome: "success", reason: null } };
    if (cs === "DECLINED" || cs === "FAILED") return { check: { ...base, outcome: "failed" } };
    return { check: base }; // PENDING, PARTIALLY_REFUNDED, REFUNDED… : on n'active rien
  }
  return { check: { ...pending(status || null), echoRef } }; // CREATED, SAVED, PAYER_ACTION_REQUIRED, inconnu : en attente
}

async function check(payment: PaymentForCheck): Promise<ProviderCheck> {
  const orderId = payment.meta && typeof payment.meta.paypal_order_id === "string" ? payment.meta.paypal_order_id : "";
  if (!orderId) return pending("no_provider_reference");
  const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;

  const get = await paypalFetch(path, { method: "GET" });
  if (get.status === 404) return pending("not_found");
  if (!get.ok) throw new Error(`paypal status HTTP ${get.status}`); // injoignable / erreur : réessai ultérieur, jamais « payé »
  let step = interpretOrder((await get.json()) as PaypalOrder);

  if ("capture" in step) {
    // Idempotent : « PayPal-Request-Id » = notre référence + « -capture » ; une commande déjà capturée est relue, jamais recapturée.
    const cap = await paypalFetch(`${path}/capture`, { method: "POST", body: {}, headers: { "PayPal-Request-Id": `${payment.provider_ref}-capture`, Prefer: "return=representation" } });
    if (cap.ok || cap.status === 422) {
      const body = (await cap.json().catch(() => ({}))) as PaypalOrder & { details?: { issue?: string }[] };
      if (cap.ok) step = interpretOrder(body);
      else if (body.details?.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")) {
        const again = await paypalFetch(path, { method: "GET" });
        if (again.ok) step = interpretOrder((await again.json()) as PaypalOrder);
        else throw new Error(`paypal status HTTP ${again.status}`);
      } else if (body.details?.some((d) => d.issue === "INSTRUMENT_DECLINED" || d.issue === "TRANSACTION_REFUSED")) {
        return { ...pending("DECLINED"), outcome: "failed" };
      } else {
        throw new Error("paypal capture refusée"); // cas non classé : réessai ultérieur, jamais « payé »
      }
    } else {
      throw new Error(`paypal capture HTTP ${cap.status}`);
    }
  }
  return "check" in step ? step.check : pending("capture_pending");
}

// ---------------------------------------------------------------------------
// Authenticité des notifications (webhook) : vérifiée AUPRÈS de PayPal
// ---------------------------------------------------------------------------
export async function verifyPaypalWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const c = paypalConfig();
  if (!c.webhookId || !isPaypalConfigured()) return false;
  const h = (n: string) => headers.get(n) ?? "";
  const body = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: c.webhookId,
    webhook_event: event,
  };
  if (!body.transmission_id || !body.transmission_sig || !body.cert_url) return false;
  try {
    const res = await paypalFetch("/v1/notifications/verify-webhook-signature", { method: "POST", body });
    if (!res.ok) return false;
    return ((await res.json()) as { verification_status?: string }).verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/** NOTRE référence dans un événement PayPal (custom_id de la commande ou de la capture). */
export function refFromPaypalEvent(event: unknown): string | null {
  const r = (event as { resource?: Record<string, unknown> })?.resource;
  if (!r) return null;
  const unit = (r.purchase_units as { custom_id?: unknown }[] | undefined)?.[0];
  return str(r.custom_id) ?? str(unit?.custom_id);
}

export const paypalProvider: PaymentProvider = {
  id: "paypal",
  // PayPal propose des abonnements/prélèvements, mais ils ne sont PAS implémentés ici : renouvellement MANUEL (jamais simulé).
  capabilities: { autoRenew: false },
  currency: () => paypalConfig().currency,
  pendingTtlMinutes: 60,
  isConfigured: () => isPaypalConfigured(),
  unavailableMessage: "Le paiement par carte / PayPal n'est pas encore disponible. Réessaie plus tard ou choisis Mobile Money.",
  newReference: () => randomUUID(),
  initiate,
  check,
};
