import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { providerById } from "@/lib/billing/providers";
import { settlePayment } from "@/lib/billing/settle";
import { runExpiryNotifications } from "@/lib/billing/notifications";
import { processAutoRenewals } from "@/lib/billing/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const RECONCILE_WINDOW_MS = 48 * 3_600_000;
const RECONCILE_BATCH = 40;

/**
 * Tâche planifiée (vercel.json, toutes les heures) :
 *  1. expire les paiements « pending » périmés ;
 *  2. rapproche les paiements encore ouverts (ou expirés depuis < 48 h) en interrogeant le
 *     prestataire — filet de sécurité si un callback n'est jamais arrivé ;
 *  3. envoie les rappels d'expiration (7 j, 3 j, jour J, après expiration) — une seule fois chacun ;
 *  4. traite les renouvellements automatiques (uniquement pour un prestataire qui les supporte).
 * Réservée au cron (secret) ; tout est idempotent, on peut la rejouer sans risque.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const summary: Record<string, unknown> = {};

  const { data: expired } = await supabaseAdmin.rpc("expire_stale_payments", { p_user_id: null });
  summary.expired = typeof expired === "number" ? expired : 0;

  const since = new Date(Date.now() - RECONCILE_WINDOW_MS).toISOString();
  const { data: open } = await supabaseAdmin
    .from("payments")
    .select("provider_ref, provider")
    .in("status", ["pending", "expired"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(RECONCILE_BATCH);
  const counts: Record<string, number> = {};
  for (const row of (open ?? []) as { provider_ref: string; provider: string | null }[]) {
    if (!providerById(row.provider)) continue; // ancien prestataire : réglé par son webhook
    const result = await settlePayment(row.provider_ref);
    counts[result.kind] = (counts[result.kind] ?? 0) + 1;
  }
  summary.reconciled = counts;

  summary.notifications = await runExpiryNotifications();
  summary.autoRenew = await processAutoRenewals();

  return NextResponse.json(summary);
}
