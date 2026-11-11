// Vue d'ensemble Premium d'un utilisateur : statut, dates, jours restants, paiement en
// attente, historique des transactions/renouvellements, renouvellement automatique.
// SERVEUR UNIQUEMENT. Ne renvoie que des champs sûrs (jamais de jeton prestataire).

import { supabaseAdmin } from "../supabase-admin";
import { EXPIRING_SOON_DAYS, getPremiumState, isTerm, type SubscriptionStatus, type Term } from "../premium";
import { PAYMENT_COLUMNS, toPaymentView, type PaymentRow } from "../payments-server";
import { autoRenewAvailable } from "./providers";
import { planOffersFor } from "./config";
import type { PremiumOverview, PremiumSummary } from "./types";

/** Une tentative ratée de moins de 24 h reste visible (statuts failed / cancelled). */
const RECENT_ATTEMPT_MS = 24 * 3_600_000;

export const REMINDER_DAYS = [7, 3, 0];

type ProfileFields = {
  status?: string | null;
  term?: string | null;
  expiresAt?: string | null;
  startedAt?: string | null;
};

/** Pure (testable) : calcule le résumé d'abonnement à partir du profil et des paiements. */
export function buildSubscriptionSummary(
  profile: ProfileFields,
  payments: PaymentRow[],
  now: Date = new Date()
): { summary: PremiumSummary; pending: PaymentRow | null } {
  const state = getPremiumState({ status: profile.status, expiresAt: profile.expiresAt, startedAt: profile.startedAt }, now);

  const pending =
    payments.find(
      (p) => p.status === "pending" && (!p.expires_at || new Date(p.expires_at).getTime() > now.getTime())
    ) ?? null;

  let status: SubscriptionStatus = state.status;
  if (!state.isActive) {
    // Premium n'est pas actif : une tentative en cours / récemment ratée est plus parlante que « expired ».
    const latest = payments[0];
    if (pending) {
      status = "pending";
    } else if (
      latest &&
      ["failed", "cancelled", "expired"].includes(latest.status) &&
      now.getTime() - new Date(latest.created_at).getTime() < RECENT_ATTEMPT_MS
    ) {
      status = latest.status === "cancelled" ? "cancelled" : "failed";
    }
  }

  return {
    pending,
    summary: {
      status,
      baseStatus: state.status,
      isActive: state.isActive,
      isUnlimited: state.isUnlimited,
      startedAt: state.startedAt,
      expiresAt: state.expiresAt,
      daysRemaining: state.daysRemaining,
      plan: profile.term && isTerm(profile.term) ? (profile.term as Term) : null,
    },
  };
}

export async function getPremiumOverview(userId: string): Promise<PremiumOverview | null> {
  const now = new Date();

  // Les paiements en attente dont la validité est dépassée passent à « expired ».
  await supabaseAdmin.rpc("expire_stale_payments", { p_user_id: userId });

  const full = await supabaseAdmin
    .from("profiles")
    .select("account_type, subscription_status, subscription_term, subscription_expires_at, premium_started_at, premium_expires_at")
    .eq("id", userId)
    .maybeSingle();
  let profile = full.data as Record<string, string | null> | null;
  if (full.error) {
    // Base pas encore migrée en V2.0 : on lit les colonnes historiques (sans date de début).
    const legacy = await supabaseAdmin
      .from("profiles")
      .select("account_type, subscription_status, subscription_term, subscription_expires_at")
      .eq("id", userId)
      .maybeSingle();
    profile = legacy.data as Record<string, string | null> | null;
  }
  if (!profile) return null;

  const { data: rows } = await supabaseAdmin
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("user_id", userId)
    .eq("type", "premium")
    .order("created_at", { ascending: false })
    .limit(25);
  const payments = (rows ?? []) as PaymentRow[];

  const { summary, pending } = buildSubscriptionSummary(
    {
      status: profile.subscription_status,
      term: profile.subscription_term,
      expiresAt: profile.premium_expires_at ?? profile.subscription_expires_at,
      startedAt: profile.premium_started_at ?? null,
    },
    payments,
    now
  );

  const { data: auto } = await supabaseAdmin
    .from("premium_autorenew")
    .select("enabled, method, next_attempt_at")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    now: now.toISOString(),
    accountType: profile.account_type ?? "",
    subscription: summary,
    pendingPayment: pending ? toPaymentView(pending) : null,
    plans: planOffersFor(profile.account_type ?? ""),
    reminderDays: REMINDER_DAYS,
    autoRenew: {
      available: autoRenewAvailable(),
      enabled: Boolean((auto as { enabled?: boolean } | null)?.enabled),
      method: ((auto as { method?: string | null } | null)?.method as string | null) ?? null,
      nextAttemptAt: ((auto as { next_attempt_at?: string | null } | null)?.next_attempt_at as string | null) ?? null,
    },
    history: payments.map(toPaymentView),
  };
}

export { EXPIRING_SOON_DAYS };
