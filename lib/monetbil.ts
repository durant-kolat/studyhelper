// Monetbil — HÉRITAGE (aucun NOUVEAU paiement ne passe plus par Monetbil depuis la V2.0 :
// MTN MoMo et Orange Money utilisent désormais les API officielles des opérateurs).
//
// Ce fichier ne sert qu'à VÉRIFIER les notifications des paiements Monetbil déjà créés
// avant la V2.0 (route app/api/payments/webhook), pour qu'aucun paiement en cours ne soit
// perdu. Une fois qu'aucun paiement Monetbil n'est plus « pending », tu peux supprimer ce
// fichier, la route app/api/payments/webhook et les variables MONETBIL_*.
//
//   Notifier   Monetbil POST notify_url (form-urlencoded) avec `sign`
//              sign = md5(service_secret + valeurs triées par clé, sans `sign`)
//   Vérifier   POST https://api.monetbil.com/payment/v1/checkPayment
//              paymentId = transaction_id Monetbil → { transaction: { status, testmode } }
//   Statuts    live : 1 succès, 0 échec, -1 annulé — test : 7, 8, 9

import { createHash, timingSafeEqual } from "crypto";

const CHECK_PAYMENT_URL = "https://api.monetbil.com/payment/v1/checkPayment";
const REQUEST_TIMEOUT_MS = 20_000;

export const MONETBIL_CURRENCY = "XAF";

const key = () => process.env.MONETBIL_SERVICE_KEY ?? "";
const secret = () => process.env.MONETBIL_SERVICE_SECRET ?? "";

/** Le secret est indispensable pour signer les requêtes ET vérifier les notifications. */
export function isMonetbilConfigured() {
  return !!key() && !!secret();
}

/** Paiements « test » (statuts 7/8/9) : refusés par défaut, jamais en production. */
function allowTestMode() {
  return process.env.MONETBIL_ALLOW_TESTMODE === "true" && process.env.NODE_ENV !== "production";
}

// ---------------------------------------------------------------------------
// Signature (algorithme officiel : ksort + md5(secret . implode('', valeurs)))
// ---------------------------------------------------------------------------

export function signMonetbil(params: Record<string, string>, serviceSecret = secret()) {
  const concatenated = Object.keys(params)
    .filter((k) => k !== "sign")
    .sort()
    .map((k) => params[k])
    .join("");
  return createHash("md5").update(serviceSecret + concatenated, "utf8").digest("hex");
}

/** Vérifie la signature d'une notification (comparaison à temps constant). */
export function verifyMonetbilSignature(params: Record<string, string>, serviceSecret = secret()) {
  const received = params.sign;
  if (!serviceSecret || typeof received !== "string" || received === "") return false;
  const expected = Buffer.from(signMonetbil(params, serviceSecret), "utf8");
  const actual = Buffer.from(received.toLowerCase(), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Vérification serveur → Monetbil (checkPayment)
// ---------------------------------------------------------------------------

export type MonetbilCheck = {
  /** 1 succès, 0 échec, -1 annulé, 7/8/9 test ; null si la réponse est inexploitable. */
  status: number | null;
  testmode: boolean;
  amount: number | null;
  currency: string | null;
};

/** Lève une erreur si Monetbil est injoignable → le webhook répond 5xx et Monetbil réessaiera. */
export async function checkMonetbilPayment(monetbilTransactionId: string): Promise<MonetbilCheck> {
  const res = await fetch(CHECK_PAYMENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ paymentId: monetbilTransactionId }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`checkPayment HTTP ${res.status}`);

  const data = (await res.json()) as { transaction?: Record<string, unknown> };
  const t = data?.transaction;
  if (!t || typeof t !== "object") return { status: null, testmode: false, amount: null, currency: null };

  const status = Number(t.status);
  const amount = t.amount !== undefined && t.amount !== null && t.amount !== "" ? Number(t.amount) : null;
  return {
    status: Number.isFinite(status) ? status : null,
    testmode: t.testmode === true || t.testmode === 1 || t.testmode === "1",
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency: typeof t.currency === "string" && t.currency ? t.currency.toUpperCase() : null,
  };
}

// ---------------------------------------------------------------------------
// Décision : une notification ne vaut « payé » que si TOUT concorde
// ---------------------------------------------------------------------------

export type ExpectedPayment = { amount: number; currency: string; userId: string };

export type NotificationVerdict =
  | { kind: "success"; transactionId: string }
  | { kind: "failed"; reason: string }
  | { kind: "pending"; reason: string }
  | { kind: "reject"; reason: string; detail: Record<string, unknown> };

const SUCCESS = [1, 7];
const FAILURE = [0, -1, 8, 9];

/**
 * @param params  paramètres de la notification, signature DÉJÀ vérifiée
 * @param expected valeurs attendues, lues dans NOTRE base (jamais dans la requête)
 * @param check   réponse de checkPayment (source d'autorité pour le statut)
 */
export function evaluateNotification(
  params: Record<string, string>,
  expected: ExpectedPayment,
  check: MonetbilCheck
): NotificationVerdict {
  const notifStatus = Number(params.status);
  const notifSuccess = SUCCESS.includes(notifStatus);
  const checkSuccess = check.status !== null && SUCCESS.includes(check.status);

  // 1) Statut : la notification ET l'API de vérification doivent dire « succès ».
  if (!(notifSuccess && checkSuccess)) {
    if (check.status !== null && FAILURE.includes(check.status)) {
      return { kind: "failed", reason: `checkPayment status=${check.status}` };
    }
    return { kind: "pending", reason: `notif=${params.status} check=${check.status}` };
  }

  // 2) Mode test : jamais d'activation Premium sur un paiement de test en production.
  const isTest = check.testmode || check.status === 7 || notifStatus === 7;
  if (isTest && !allowTestMode()) {
    return { kind: "reject", reason: "test_mode", detail: { status: notifStatus, testmode: check.testmode } };
  }

  // 3) Transaction : identifiant Monetbil présent.
  const transactionId = (params.transaction_id ?? "").trim();
  if (!transactionId) {
    return { kind: "reject", reason: "missing_transaction_id", detail: {} };
  }

  // 4) Montant : notification signée ET (si fourni) checkPayment doivent égaler le montant attendu.
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount !== expected.amount) {
    return { kind: "reject", reason: "amount_mismatch", detail: { expected: expected.amount, received: params.amount } };
  }
  if (check.amount !== null && check.amount !== expected.amount) {
    return { kind: "reject", reason: "amount_mismatch_check", detail: { expected: expected.amount, received: check.amount } };
  }

  // 5) Devise : obligatoire dans la notification (échec fermé si absente).
  const currency = (params.currency ?? "").trim().toUpperCase();
  if (currency !== expected.currency.toUpperCase()) {
    return { kind: "reject", reason: "currency_mismatch", detail: { expected: expected.currency, received: params.currency ?? null } };
  }
  if (check.currency !== null && check.currency !== expected.currency.toUpperCase()) {
    return { kind: "reject", reason: "currency_mismatch_check", detail: { expected: expected.currency, received: check.currency } };
  }

  // 6) Utilisateur : le champ `user` envoyé à l'initiation doit revenir identique.
  if (params.user !== undefined && params.user !== "" && params.user !== expected.userId) {
    return { kind: "reject", reason: "user_mismatch", detail: { expected: expected.userId, received: params.user } };
  }

  return { kind: "success", transactionId };
}
