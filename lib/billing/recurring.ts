// Renouvellement AUTOMATIQUE — architecture prête, activée UNIQUEMENT quand un prestataire
// offre réellement (API officielle) un prélèvement récurrent ou une tokenisation.
// SERVEUR UNIQUEMENT (tâche planifiée /api/cron/premium).
//
// État actuel (voir capabilities de chaque prestataire) :
//   MTN / Orange / PayPal : renouvellement MANUEL (aucun prélèvement récurrent implémenté ; jamais simulé)
// → rien n'est simulé : tant qu'aucun prestataire ne supporte `chargeRecurring`, ce module
//   ne prélève personne et l'utilisateur renouvelle à la main (rappels J-7, J-3, jour J).
//
// Ne stocke JAMAIS PIN, CVV ou données de carte : `mandate_ref` n'est qu'une référence
// opaque fournie par le prestataire.

import { supabaseAdmin } from "../supabase-admin";
import { providerById } from "./providers";
import { supportsAutoRenew, type PaymentProvider } from "./providers/types";
import { planOffersFor } from "./config";
import { notifyOnce } from "./notifications";
import { settlePayment } from "./settle";
import { isTerm } from "../premium";

const MAX_FAILURES = 3;
const RETRY_DELAY_MS = 24 * 3_600_000;

type AutoRenewRow = {
  user_id: string;
  provider: string | null;
  method: string | null;
  plan: string | null;
  mandate_ref: string | null;
  failure_count: number;
};

export async function processAutoRenewals(
  opts: { now?: Date; getProvider?: (id: string | null | undefined) => PaymentProvider | null } = {}
): Promise<{ due: number; charged: number; failed: number; disabled: number }> {
  const now = opts.now ?? new Date();
  const getProvider = opts.getProvider ?? providerById;
  const out = { due: 0, charged: 0, failed: 0, disabled: 0 };

  const { data } = await supabaseAdmin
    .from("premium_autorenew")
    .select("user_id, provider, method, plan, mandate_ref, failure_count")
    .eq("enabled", true)
    .lte("next_attempt_at", now.toISOString())
    .limit(25);
  const rows = (data ?? []) as AutoRenewRow[];
  out.due = rows.length;

  for (const row of rows) {
    const provider = getProvider(row.provider);
    const nowIso = now.toISOString();

    const fail = async (error: string, permanent: boolean) => {
      out.failed++;
      const failures = row.failure_count + 1;
      const disable = permanent || failures >= MAX_FAILURES;
      if (disable) out.disabled++;
      await supabaseAdmin
        .from("premium_autorenew")
        .update({
          failure_count: failures,
          last_error: error.slice(0, 200),
          last_attempt_at: nowIso,
          updated_at: nowIso,
          enabled: !disable,
          next_attempt_at: disable ? null : new Date(now.getTime() + RETRY_DELAY_MS).toISOString(),
        })
        .eq("user_id", row.user_id);
      await notifyOnce(row.user_id, "autorenew_failed", nowIso);
    };

    // Le prestataire ne sait pas (ou plus) prélever : on ne simule rien → renouvellement manuel.
    if (!provider || !supportsAutoRenew(provider) || !provider.isConfigured() || !row.mandate_ref) {
      await fail("provider_not_supported", true);
      continue;
    }

    const { data: profile } = await supabaseAdmin.from("profiles").select("account_type").eq("id", row.user_id).maybeSingle();
    const offer = planOffersFor((profile as { account_type?: string } | null)?.account_type ?? "").find(
      (o) => o.id === (row.plan && isTerm(row.plan) ? row.plan : "mensuel")
    );
    if (!offer) {
      await fail("plan_unavailable", true);
      continue;
    }

    const ref = provider.newReference();
    const { error: insertError } = await supabaseAdmin.from("payments").insert({
      user_id: row.user_id,
      provider: provider.id,
      provider_ref: ref,
      method: row.method,
      type: "premium",
      plan: offer.id,
      amount: offer.price,
      currency: provider.currency(),
      duration_days: offer.durationDays,
      status: "pending",
      expires_at: new Date(now.getTime() + provider.pendingTtlMinutes * 60_000).toISOString(),
      meta: { term: offer.id, auto_renew: true },
    });
    if (insertError) {
      await fail("payment_insert_failed", false);
      continue;
    }

    const charge = await provider.chargeRecurring({
      mandateRef: row.mandate_ref,
      ref,
      amount: offer.price,
      currency: provider.currency(),
      description: `Study Helper Premium - ${offer.durationDays} jours`,
      userId: row.user_id,
    });
    if (!charge.ok) {
      await supabaseAdmin.from("payments").update({ status: "failed", failure_reason: "autorenew_declined" }).eq("provider_ref", ref);
      await fail(charge.error, Boolean(charge.permanent));
      continue;
    }

    // Même vérification serveur que pour un paiement manuel : jamais « payé » sur parole.
    const settled = await settlePayment(ref, { getProvider });
    if (settled.kind === "success" || settled.kind === "already_success") {
      out.charged++;
      const nextAttempt = settled.payment?.period_end
        ? new Date(new Date(settled.payment.period_end).getTime() - 24 * 3_600_000).toISOString()
        : null;
      await supabaseAdmin
        .from("premium_autorenew")
        .update({ failure_count: 0, last_error: null, last_attempt_at: nowIso, updated_at: nowIso, next_attempt_at: nextAttempt })
        .eq("user_id", row.user_id);
    } else if (settled.kind !== "pending") {
      await fail(`charge_${settled.kind}`, false);
    }
    // « pending » : la tâche suivante revérifie (rapprochement) — pas de nouvel essai entre-temps.
  }
  return out;
}
