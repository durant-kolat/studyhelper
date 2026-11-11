// Aides communes aux routes de paiement (initiation, webhooks, vérification, cron).
// SERVEUR UNIQUEMENT : utilise la clé service_role.
//
// Principe : un paiement n'active Premium QUE via la fonction SQL apply_payment_success(),
// qui verrouille la ligne de paiement, active en une seule transaction et mémorise
// `activated_at` : un même paiement ne peut donc jamais être activé (ni prolonger Premium)
// deux fois, même si le prestataire rappelle dix fois ou si deux requêtes arrivent en même temps.

import { supabaseAdmin } from "./supabase-admin";
import { PAYMENT_METHODS, isPaymentMethodId, methodLabel } from "./payment-methods";
import type { PaymentStatus, PaymentView } from "./billing/types";

export type PaymentRow = {
  id: string;
  user_id: string;
  provider: string | null;
  provider_ref: string;
  type: string;
  status: string;
  amount: number;
  currency: string | null;
  plan: string | null;
  method: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
  duration_days: number | null;
  period_start: string | null;
  period_end: string | null;
  renewal: boolean | null;
  paid_amount: number | null;
  provider_txn_id: string | null;
  failure_reason: string | null;
  meta: Record<string, unknown> | null;
};

export const PAYMENT_COLUMNS =
  "id, user_id, provider, provider_ref, type, status, amount, currency, plan, method, activated_at, created_at, updated_at, expires_at, duration_days, period_start, period_end, renewal, paid_amount, provider_txn_id, failure_reason, meta";

export async function findPaymentByRef(
  ref: string
): Promise<{ payment: PaymentRow | null; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("provider_ref", ref)
    .maybeSingle();
  if (error) return { payment: null, error: error.message };
  return { payment: (data as PaymentRow | null) ?? null, error: null };
}

/** Déjà traité (activé) : plus rien à faire, on répond simplement « reçu ». */
export function isSettled(payment: PaymentRow) {
  return payment.status === "success" || payment.activated_at !== null;
}

export type ApplyResult =
  | { ok: true; applied: boolean; periodStart: string | null; periodEnd: string | null; renewal: boolean }
  | { ok: false; replay: boolean; message: string };

/**
 * Confirme le paiement ET active l'achat, atomiquement et de façon idempotente.
 * `applied: false` = déjà activé auparavant (rappel du prestataire) : rien n'a changé.
 * `replay: true` = la transaction du prestataire a déjà servi pour un AUTRE paiement.
 */
export async function applyPaymentSuccess(
  paymentId: string,
  opts: { meta?: Record<string, unknown>; paidAmount?: number | null; providerTxnId?: string | null } = {}
): Promise<ApplyResult> {
  const { data, error } = await supabaseAdmin.rpc("apply_payment_success", {
    p_payment_id: paymentId,
    p_meta: opts.meta ?? {},
    p_paid_amount: opts.paidAmount ?? null,
    p_provider_txn_id: opts.providerTxnId ?? null,
  });
  if (error) return { ok: false, replay: error.code === "23505", message: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    out_applied?: boolean;
    out_period_start?: string | null;
    out_period_end?: string | null;
    out_renewal?: boolean;
  } | null;
  return {
    ok: true,
    applied: Boolean(row?.out_applied),
    periodStart: row?.out_period_start ?? null,
    periodEnd: row?.out_period_end ?? null,
    renewal: Boolean(row?.out_renewal),
  };
}

/** Jamais de rétrogradation : seul un paiement « pending » change de statut ici. */
export async function markPaymentStatus(
  paymentId: string,
  status: Exclude<PaymentStatus, "pending" | "success">,
  reason?: string | null
) {
  await supabaseAdmin
    .from("payments")
    .update({ status, failure_reason: reason ?? null, updated_at: new Date().toISOString() })
    .eq("id", paymentId)
    .eq("status", "pending");
}

/**
 * Compatibilité (anciens webhooks Monetbil / CinetPay) : confirme ET active l'achat via la fonction SQL
 * atomique et idempotente. `activated: false` = déjà activé auparavant (rappel du prestataire).
 */
export type CompleteResult =
  | { ok: true; activated: boolean }
  | { ok: false; replay: boolean; message: string };

export async function completePayment(
  paymentId: string,
  meta: Record<string, unknown> = {}
): Promise<CompleteResult> {
  const result = await applyPaymentSuccess(paymentId, { meta });
  if (!result.ok) return { ok: false, replay: result.replay, message: result.message };
  return { ok: true, activated: result.applied };
}

/** Compatibilité : marque un paiement « pending » comme échoué (jamais de rétrogradation). */
export async function markPaymentFailed(paymentId: string, reason?: string | null) {
  await markPaymentStatus(paymentId, "failed", reason);
}

/** Paiement incohérent (montant, devise, utilisateur…) : tracé, jamais activé. */
export async function rejectPayment(
  payment: PaymentRow,
  reason: string,
  detail: Record<string, unknown>
) {
  await supabaseAdmin
    .from("payments")
    .update({
      status: "failed",
      failure_reason: reason,
      updated_at: new Date().toISOString(),
      meta: { ...(payment.meta ?? {}), rejected: { reason, ...detail } },
    })
    .eq("id", payment.id)
    .in("status", ["pending", "failed", "expired", "cancelled"]);
}

/** Corps de formulaire (x-www-form-urlencoded) ou JSON → objet de chaînes. */
export async function readNotificationParams(req: Request): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await req.json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(json ?? {})) {
      if (v !== null && v !== undefined && typeof v !== "object") params[k] = String(v);
    }
    return params;
  }
  const form = await req.formData();
  form.forEach((value, k) => {
    if (typeof value === "string") params[k] = value;
  });
  return params;
}

/**
 * Forme SÛRE d'un paiement pour le navigateur : aucun jeton prestataire, aucune
 * donnée sensible (la colonne `meta` n'est jamais renvoyée).
 */
export function toPaymentView(row: PaymentRow): PaymentView {
  const status = (["pending", "success", "failed", "cancelled", "expired"].includes(row.status)
    ? row.status
    : row.status === "completed"
      ? "success"
      : "failed") as PaymentStatus;
  const method = row.method;
  const masked = typeof row.meta?.phone_masked === "string" ? (row.meta.phone_masked as string) : null;
  return {
    ref: row.provider_ref,
    type: row.type,
    status,
    provider: row.provider,
    method,
    methodLabel: methodLabel(method, row.provider),
    plan: row.plan,
    durationDays: row.duration_days,
    amount: row.amount,
    paidAmount: row.paid_amount,
    currency: row.currency ?? "XAF",
    createdAt: row.created_at,
    paidAt: row.activated_at,
    expiresAt: row.expires_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    renewal: Boolean(row.renewal),
    providerTxnId: row.provider_txn_id,
    failureReason: row.failure_reason,
    payerMasked: masked,
    flow: method && isPaymentMethodId(method) ? PAYMENT_METHODS[method].flow : null,
  };
}
