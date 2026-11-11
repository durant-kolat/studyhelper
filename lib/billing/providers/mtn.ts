// MTN Mobile Money — API « Collection » DIRECTE (Request To Pay). SERVEUR UNIQUEMENT.
//
//   Jeton      POST {base}/collection/token/                       Authorization: Basic base64(apiUser:apiKey)
//                                                                   Ocp-Apim-Subscription-Key: <clé Collection>
//                                                                   → { access_token, token_type, expires_in }
//   Demander   POST {base}/collection/v1_0/requesttopay            Authorization: Bearer <jeton>
//                                                                   X-Reference-Id: <UUID unique = NOTRE référence>
//                                                                   X-Target-Environment: <sandbox | valeur fournie par MTN>
//                                                                   (X-Callback-Url facultatif)
//                  corps : { amount, currency, externalId, payer: { partyIdType: "MSISDN", partyId }, payerMessage, payeeNote }
//                  → 202 Accepted (la demande est créée : ce n'est PAS un paiement confirmé)
//   Statut     GET  {base}/collection/v1_0/requesttopay/{X-Reference-Id}
//                  → { amount, currency, financialTransactionId, externalId, payer, status: PENDING | SUCCESSFUL | FAILED, reason }
//
// Parcours client : la demande arrive sur le téléphone (MTN MoMo) ; le client la confirme avec son code, que
// Study Helper ne voit ni ne demande JAMAIS.
//
// ⚠️ À VALIDER avec la documentation de TON contrat MTN : les URL, la valeur de X-Target-Environment, la devise et
// les plafonds diffèrent selon le pays et l'environnement (bac à sable : devise EUR uniquement). Rien n'est supposé :
// tout est lu dans les variables d'environnement, et le moyen n'est « configuré » que si tout est renseigné.
//
// Variables (serveur uniquement) :
//   MTN_MOMO_SUBSCRIPTION_KEY    clé du produit « Collection » (portail MTN > Profil)
//   MTN_MOMO_API_USER / MTN_MOMO_API_KEY   identifiants API (générés sur le portail partenaire)
//   MTN_MOMO_BASE_URL            défaut : bac à sable https://sandbox.momodeveloper.mtn.com ; en production : URL fournie par MTN
//   MTN_MOMO_TARGET_ENVIRONMENT  « sandbox » (défaut du bac à sable) ; OBLIGATOIRE en production (valeur donnée par MTN)
//   MTN_MOMO_CURRENCY            défaut XAF ; « EUR » en bac à sable
//   MTN_MOMO_USE_CALLBACK        « true » pour envoyer X-Callback-Url (la vérification par interrogation reste la preuve)

import { randomUUID } from "crypto";
import { DEFAULT_COUNTRY, getCountry } from "../../payment-countries";
import type { InitResult, PaymentForCheck, PaymentProvider, ProviderCheck, ProviderPaymentContext } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;
const SANDBOX_BASE = "https://sandbox.momodeveloper.mtn.com";

type Env = Record<string, string | undefined>;
const val = (env: Env, name: string) => env[name]?.trim() ?? "";

/**
 * Configuration d'un PAYS. Les identifiants MTN diffèrent par pays : MTN_MOMO_<CC>_<NOM> (ex. MTN_MOMO_GH_API_KEY).
 * Les variables sans suffixe (MTN_MOMO_<NOM>) ne valent que pour le pays par défaut (Cameroun) : jamais appliquées à un autre pays.
 */
export function mtnConfig(env: Env = process.env, country: string = DEFAULT_COUNTRY) {
  const cc = country.toUpperCase();
  const pick = (name: string) => val(env, `MTN_MOMO_${cc}_${name}`) || (cc === DEFAULT_COUNTRY ? val(env, `MTN_MOMO_${name}`) : "");
  const base = (pick("BASE_URL") || SANDBOX_BASE).replace(/\/+$/, "");
  const sandbox = base === SANDBOX_BASE;
  return {
    base,
    sandbox,
    subscriptionKey: pick("SUBSCRIPTION_KEY"),
    apiUser: pick("API_USER"),
    apiKey: pick("API_KEY"),
    targetEnvironment: pick("TARGET_ENVIRONMENT") || (sandbox ? "sandbox" : ""),
    currency: (pick("CURRENCY") || getCountry(cc)?.currency || "XAF").toUpperCase(),
    useCallback: pick("USE_CALLBACK").toLowerCase() === "true",
  };
}

/** Configuré UNIQUEMENT si tout ce que l'API exige est renseigné POUR CE PAYS (jamais de valeur devinée en production). */
export function isMtnConfigured(env: Env = process.env, country: string = DEFAULT_COUNTRY): boolean {
  const c = mtnConfig(env, country);
  return Boolean(c.subscriptionKey && c.apiUser && c.apiKey && c.targetEnvironment);
}

// ---------------------------------------------------------------------------
// Jeton d'accès : mis en cache en mémoire, renouvelé avant l'échéance.
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>(); // un jeton par pays

async function getToken(country: string, force = false): Promise<string> {
  const cached = tokenCache.get(country);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  const c = mtnConfig(process.env, country);
  if (!isMtnConfigured(process.env, country)) throw new Error("mtn non configuré");
  const res = await fetch(`${c.base}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.apiUser}:${c.apiKey}`).toString("base64")}`,
      "Ocp-Apim-Subscription-Key": c.subscriptionKey,
      ...(c.sandbox ? {} : { "X-Target-Environment": c.targetEnvironment }),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`mtn token HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number | string };
  if (!json.access_token) throw new Error("mtn token absent");
  const ttl = Number(json.expires_in) > 120 ? Number(json.expires_in) : 3600;
  tokenCache.set(country, { token: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 });
  return json.access_token;
}

/** Appel authentifié ; un 401 (jeton expiré) déclenche UN renouvellement du jeton. */
async function mtnFetch(country: string, path: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) {
  const c = mtnConfig(process.env, country);
  const call = async (token: string) =>
    fetch(`${c.base}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": c.subscriptionKey,
        "X-Target-Environment": c.targetEnvironment,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  let res = await call(await getToken(country));
  if (res.status === 401) res = await call(await getToken(country, true));
  return res;
}

// ---------------------------------------------------------------------------
// Initiation : requesttopay (pure → testable sans réseau)
// ---------------------------------------------------------------------------

/** Corps du « Request To Pay ». Le montant est une chaîne, la référence externe est NOTRE référence. */
export function buildRequestToPay(ctx: ProviderPaymentContext, currency: string) {
  const note = ctx.description.replace(/\s+/g, " ").trim().slice(0, 100) || "Study Helper";
  return {
    amount: String(ctx.amount),
    currency,
    externalId: ctx.ref,
    payer: { partyIdType: "MSISDN", partyId: `${getCountry(ctx.country)?.dial ?? ""}${ctx.phone}` },
    payerMessage: note,
    payeeNote: note,
  };
}

async function initiate(ctx: ProviderPaymentContext): Promise<InitResult> {
  const country = ctx.country || DEFAULT_COUNTRY;
  if (!getCountry(country) || !isMtnConfigured(process.env, country)) return { ok: false, error: mtnProvider.unavailableMessage, code: "payment_unavailable" };
  if (!ctx.phone) return { ok: false, error: "Le numéro de téléphone est obligatoire pour MTN Mobile Money." };
  if (!Number.isInteger(ctx.amount) || ctx.amount <= 0) return { ok: false, error: "Montant invalide.", code: "invalid_amount" };
  const c = mtnConfig(process.env, country);

  let res: Response;
  try {
    res = await mtnFetch(country, "/collection/v1_0/requesttopay", {
      method: "POST",
      headers: { "X-Reference-Id": ctx.ref, ...(c.useCallback ? { "X-Callback-Url": ctx.urls.notify } : {}) },
      body: JSON.stringify(buildRequestToPay(ctx, c.currency)),
    });
  } catch (err) {
    console.error("[mtn] requesttopay injoignable :", err instanceof Error ? err.message : err);
    return { ok: false, error: "Impossible de joindre MTN Mobile Money, réessaie dans un instant." };
  }

  // 202 Accepted = demande CRÉÉE chez MTN (pas payée). La preuve viendra de l'interrogation du statut.
  if (res.status === 202 || res.status === 200 || res.status === 201) {
    return { ok: true, flow: "push", meta: { mtn_reference: ctx.ref, country, mtn_currency: c.currency } };
  }
  const detail = await res.text().catch(() => "");
  console.error(`[mtn] requesttopay refusé HTTP ${res.status} :`, detail.replace(/\d{9,}/g, "•••").slice(0, 300));
  if (res.status === 401 || res.status === 403) return { ok: false, error: mtnProvider.unavailableMessage, code: "payment_unavailable" };
  if (res.status === 400) return { ok: false, error: "Le paiement a été refusé : vérifie ton numéro MTN Mobile Money et réessaie." };
  return { ok: false, error: "MTN Mobile Money est momentanément indisponible, réessaie dans un instant." };
}

// ---------------------------------------------------------------------------
// Vérification : GET requesttopay/{reference}
// ---------------------------------------------------------------------------

type MtnStatusBody = {
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
  externalId?: unknown;
  financialTransactionId?: unknown;
  reason?: unknown;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** Interprète la réponse de MTN (pure : testable sans réseau). SUCCESSFUL seul = payé ; tout statut inconnu = « pending ». */
export function parseMtnStatus(json: MtnStatusBody): ProviderCheck {
  const status = typeof json.status === "string" ? json.status.trim().toUpperCase() : "";
  const reasonRaw = json.reason;
  const reason =
    typeof reasonRaw === "string"
      ? reasonRaw.trim()
      : reasonRaw && typeof reasonRaw === "object"
        ? str((reasonRaw as { code?: unknown }).code) ?? str((reasonRaw as { message?: unknown }).message) ?? ""
        : "";
  const amount = json.amount !== undefined && json.amount !== null && json.amount !== "" ? Number(json.amount) : null;

  let outcome: ProviderCheck["outcome"] = "pending";
  if (status === "SUCCESSFUL") outcome = "success";
  else if (status === "FAILED") {
    if (/reject|cancel|declin|denied|refus/i.test(reason)) outcome = "cancelled";
    else if (/expire|timeout|time_out|time out/i.test(reason)) outcome = "expired";
    else outcome = "failed";
  }
  return {
    outcome,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency: str(json.currency)?.toUpperCase() ?? null,
    providerTxnId: str(json.financialTransactionId),
    reason: reason || (status && status !== "PENDING" ? status : null),
    echoRef: str(json.externalId),
    userRef: null,
  };
}

async function check(payment: PaymentForCheck): Promise<ProviderCheck> {
  const ref = payment.meta && typeof payment.meta.mtn_reference === "string" ? payment.meta.mtn_reference : payment.provider_ref;
  const country = payment.meta && typeof payment.meta.country === "string" ? payment.meta.country : DEFAULT_COUNTRY; // le pays du PAIEMENT, pas celui du moment
  const res = await mtnFetch(country, `/collection/v1_0/requesttopay/${encodeURIComponent(ref)}`, { method: "GET" });
  if (res.status === 404) {
    // Demande inconnue de MTN (pas encore visible ou jamais créée) : on attend, la validité du paiement tranchera.
    return { outcome: "pending", amount: null, currency: null, providerTxnId: null, reason: "not_found", echoRef: null, userRef: null };
  }
  if (!res.ok) throw new Error(`mtn status HTTP ${res.status}`); // injoignable / erreur : réessai ultérieur, jamais « payé »
  return parseMtnStatus((await res.json()) as MtnStatusBody);
}

export const mtnProvider: PaymentProvider = {
  id: "mtn",
  // L'API Collection est une demande de paiement ponctuelle : pas de prélèvement récurrent implémenté → renouvellement MANUEL.
  capabilities: { autoRenew: false },
  currency: (country) => mtnConfig(process.env, country ?? DEFAULT_COUNTRY).currency,
  pendingTtlMinutes: 10,
  isConfigured: (country) => isMtnConfigured(process.env, country ?? DEFAULT_COUNTRY),
  unavailableMessage: "MTN Mobile Money n'est pas encore disponible. Réessaie plus tard ou choisis un autre moyen de paiement.",
  newReference: () => randomUUID(), // X-Reference-Id MTN : UUID v4
  initiate,
  check,
};
