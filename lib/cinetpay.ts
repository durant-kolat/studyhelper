// Intégration CinetPay — paiement par carte bancaire (Visa, Mastercard).
// SERVEUR UNIQUEMENT (routes app/api/**) : aucune de ces variables ne porte le
// préfixe NEXT_PUBLIC_, le navigateur ne reçoit jamais CINETPAY_API_KEY.
//
// Référence : https://docs.cinetpay.com (API checkout v2)
//   Initier    POST https://api-checkout.cinetpay.com/v2/payment  (JSON)
//              channels = CREDIT_CARD → { code: "201", data: { payment_url } }
//   Vérifier   POST https://api-checkout.cinetpay.com/v2/payment/check
//              { apikey, site_id, transaction_id } → data.status ACCEPTED | REFUSED | …
//   Notifier   CinetPay POST notify_url (form) + en-tête `x-token` = HMAC-SHA256
//              de la concaténation des champs cpm_* avec la Secret Key.
//
// Study Helper NE VOIT ET NE STOCKE JAMAIS : numéro de carte, CVV, date
// d'expiration. La carte se saisit sur la page sécurisée de CinetPay ; ici on
// n'envoie que l'identité du client (nom, e-mail…) exigée pour afficher
// l'option carte.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const INIT_URL = "https://api-checkout.cinetpay.com/v2/payment";
const CHECK_URL = "https://api-checkout.cinetpay.com/v2/payment/check";
const REQUEST_TIMEOUT_MS = 20_000;

export const CINETPAY_CURRENCY = "XAF";

export const CARD_UNAVAILABLE_MESSAGE =
  "Le paiement par carte n'est pas encore disponible. Réessaie plus tard ou utilise Mobile Money.";

const apiKey = () => process.env.CINETPAY_API_KEY ?? "";
const siteId = () => process.env.CINETPAY_SITE_ID ?? "";
const secretKey = () => process.env.CINETPAY_SECRET_KEY ?? "";
const envOr = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

/** Le paiement par carte n'est proposé que si la clé API ET l'identifiant du site sont présents. */
export function isCinetPayConfigured() {
  return !!apiKey() && !!siteId();
}

/** Identifiant de transaction court et alphanumérique (pas de « _ » ni « - »), unique. */
export function newCinetPayTransactionId(): string {
  return `SH${Date.now().toString(36)}${randomBytes(6).toString("hex")}`.toUpperCase();
}

/** CinetPay déconseille # / $ _ & dans la description. */
function cleanDescription(text: string) {
  return text
    .replace(/[#/$_&—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

// ---------------------------------------------------------------------------
// Initiation
// ---------------------------------------------------------------------------

export type CinetPayInitResult =
  | { ok: true; paymentUrl: string }
  | { ok: false; error: string; code?: "payment_unavailable" | "invalid_amount" };

export async function initiateCinetPayPayment(p: {
  transactionId: string;
  amount: number;
  description: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  /** Facultatif : sinon un numéro par défaut est envoyé (exigé par CinetPay pour la carte). */
  customerPhone?: string;
  notifyUrl: string;
  returnUrl: string;
}): Promise<CinetPayInitResult> {
  if (!isCinetPayConfigured()) {
    return { ok: false, error: CARD_UNAVAILABLE_MESSAGE, code: "payment_unavailable" };
  }
  // Règle CinetPay : montant entier, multiple de 5 (sinon la transaction échoue).
  if (!Number.isInteger(p.amount) || p.amount <= 0 || p.amount % 5 !== 0) {
    return {
      ok: false,
      error: "Le montant doit être un multiple de 5 FCFA pour un paiement par carte.",
      code: "invalid_amount",
    };
  }

  const parts = p.customerName.trim().split(/\s+/).filter(Boolean);
  const surname = parts[0] ?? "Utilisateur"; // prénom
  const name = parts.slice(1).join(" ") || surname; // nom

  const payload = {
    apikey: apiKey(),
    site_id: siteId(),
    transaction_id: p.transactionId,
    amount: p.amount,
    currency: CINETPAY_CURRENCY,
    description: cleanDescription(p.description),
    notify_url: p.notifyUrl,
    return_url: p.returnUrl,
    channels: "CREDIT_CARD",
    lang: "fr",
    metadata: p.userId,
    // Champs exigés par CinetPay pour afficher l'option « carte bancaire ».
    customer_id: p.userId,
    customer_name: name,
    customer_surname: surname,
    customer_email: p.customerEmail,
    customer_phone_number: p.customerPhone || envOr("CINETPAY_DEFAULT_PHONE", "+237000000000"),
    customer_address: envOr("CINETPAY_DEFAULT_ADDRESS", "Douala"),
    customer_city: envOr("CINETPAY_DEFAULT_CITY", "Douala"),
    customer_country: "CM",
    customer_state: "CM",
    customer_zip_code: envOr("CINETPAY_DEFAULT_ZIP", "00237"),
  };

  let res: Response;
  try {
    res = await fetch(INIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[cinetpay] requête d'initiation échouée :", err instanceof Error ? err.message : err);
    return { ok: false, error: "Impossible de joindre CinetPay, réessaie dans un instant." };
  }

  const bodyText = await res.text();
  let data: { code?: unknown; message?: unknown; description?: unknown; data?: { payment_url?: unknown } } = {};
  try {
    data = JSON.parse(bodyText);
  } catch {
    console.error(`[cinetpay] réponse non-JSON (HTTP ${res.status}) :`, bodyText.slice(0, 300));
    return { ok: false, error: `CinetPay a répondu de façon inattendue (HTTP ${res.status}).` };
  }

  const paymentUrl = typeof data.data?.payment_url === "string" ? data.data.payment_url : "";
  if (String(data.code) !== "201" || !paymentUrl) {
    console.error(
      "[cinetpay] échec d'initiation :",
      JSON.stringify({ code: data.code, message: data.message, description: data.description }).slice(0, 300)
    );
    return { ok: false, error: "Échec de l'initiation du paiement par carte." };
  }

  // On n'envoie l'utilisateur que vers un domaine CinetPay en HTTPS.
  try {
    const u = new URL(paymentUrl);
    if (u.protocol !== "https:" || !/(^|\.)cinetpay\.com$/i.test(u.hostname)) throw new Error("hôte");
  } catch {
    console.error("[cinetpay] payment_url inattendue :", paymentUrl.slice(0, 200));
    return { ok: false, error: "Réponse CinetPay invalide." };
  }

  return { ok: true, paymentUrl };
}

// ---------------------------------------------------------------------------
// Vérification serveur → CinetPay (source d'autorité pour le statut)
// ---------------------------------------------------------------------------

export type CinetPayCheck = {
  /** accepted = payé ; refused = refusé/annulé ; pending = en cours ou inconnu. */
  outcome: "accepted" | "refused" | "pending";
  code: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  metadata: string | null;
  paymentMethod: string | null;
  operatorId: string | null;
};

/** Lève une erreur si CinetPay est injoignable → le webhook répond 5xx et CinetPay réessaiera. */
export async function checkCinetPayTransaction(transactionId: string): Promise<CinetPayCheck> {
  const res = await fetch(CHECK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apikey: apiKey(), site_id: siteId(), transaction_id: transactionId }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status >= 500) throw new Error(`check HTTP ${res.status}`);

  let json: { code?: unknown; data?: Record<string, unknown> | null };
  try {
    json = await res.json();
  } catch {
    throw new Error(`check réponse non-JSON (HTTP ${res.status})`);
  }
  return parseCinetPayCheck(json);
}

/** Interprète la réponse de /v2/payment/check (pure : testable sans réseau). */
export function parseCinetPayCheck(json: { code?: unknown; data?: Record<string, unknown> | null }): CinetPayCheck {
  const d = json?.data && typeof json.data === "object" ? json.data : {};
  const code = json?.code !== undefined && json.code !== null ? String(json.code) : null;
  const status = typeof d.status === "string" ? d.status.trim().toUpperCase() : null;

  const rawAmount = d.amount !== undefined && d.amount !== null && d.amount !== "" ? Number(d.amount) : null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  let outcome: CinetPayCheck["outcome"] = "pending";
  if (status === "ACCEPTED" && (code === "00" || code === "0")) outcome = "accepted";
  else if (status === "REFUSED") outcome = "refused";

  return {
    outcome,
    code,
    status,
    amount: rawAmount !== null && Number.isFinite(rawAmount) ? rawAmount : null,
    currency: str(d.currency)?.toUpperCase() ?? null,
    metadata: str(d.metadata),
    paymentMethod: str(d.payment_method),
    operatorId: str(d.operator_id),
  };
}

// ---------------------------------------------------------------------------
// Notification : jeton HMAC (x-token)
// ---------------------------------------------------------------------------

// Ordre imposé par la documentation CinetPay (« X-TOKEN HMAC »).
const NOTIFICATION_FIELDS = [
  "cpm_site_id",
  "cpm_trans_id",
  "cpm_trans_date",
  "cpm_amount",
  "cpm_currency",
  "signature",
  "payment_method",
  "cel_phone_num",
  "cpm_phone_prefixe",
  "cpm_language",
  "cpm_version",
  "cpm_payment_config",
  "cpm_page_action",
  "cpm_custom",
  "cpm_designation",
  "cpm_error_message",
] as const;

/**
 * « skipped » : CINETPAY_SECRET_KEY absente (le jeton ne peut pas être vérifié —
 * la vérification serveur /payment/check reste, elle, toujours obligatoire).
 */
export function verifyCinetPayToken(
  params: Record<string, string>,
  xToken: string | null,
  secret = secretKey()
): "valid" | "invalid" | "skipped" {
  if (!secret) return "skipped";
  if (!xToken) return "invalid";
  const data = NOTIFICATION_FIELDS.map((k) => params[k] ?? "").join("");
  const expected = Buffer.from(createHmac("sha256", secret).update(data, "utf8").digest("hex"), "utf8");
  const actual = Buffer.from(xToken.trim().toLowerCase(), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? "valid" : "invalid";
}

/** Le `cpm_site_id` d'une notification doit être celui de NOTRE service. */
export function isOwnSiteId(received: string | undefined) {
  if (!received) return true; // champ absent : la vérification serveur tranchera
  return received.trim() === siteId().trim();
}

// ---------------------------------------------------------------------------
// Décision : « payé » seulement si TOUT concorde avec NOTRE base
// ---------------------------------------------------------------------------

export type CinetPayVerdict =
  | { kind: "success"; operatorId: string | null; paymentMethod: string | null }
  | { kind: "failed"; reason: string }
  | { kind: "pending"; reason: string }
  | { kind: "reject"; reason: string; detail: Record<string, unknown> };

export function evaluateCinetPay(
  check: CinetPayCheck,
  expected: { amount: number; currency: string; userId: string }
): CinetPayVerdict {
  if (check.outcome === "refused") return { kind: "failed", reason: `status=${check.status}` };
  if (check.outcome !== "accepted") return { kind: "pending", reason: `code=${check.code} status=${check.status}` };

  // Le montant vient de NOTRE base (jamais de la requête) et doit égaler celui que CinetPay a encaissé.
  if (check.amount === null || check.amount !== expected.amount) {
    return { kind: "reject", reason: "amount_mismatch", detail: { expected: expected.amount, received: check.amount } };
  }
  if (check.currency !== null && check.currency !== expected.currency.toUpperCase()) {
    return { kind: "reject", reason: "currency_mismatch", detail: { expected: expected.currency, received: check.currency } };
  }
  // metadata = id utilisateur envoyé à l'initiation : s'il revient, il doit être identique.
  if (check.metadata !== null && check.metadata !== expected.userId) {
    return { kind: "reject", reason: "user_mismatch", detail: { expected: expected.userId, received: check.metadata } };
  }
  return { kind: "success", operatorId: check.operatorId, paymentMethod: check.paymentMethod };
}
