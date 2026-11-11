// Rappels d'expiration Premium : 7 jours avant, 3 jours avant, le jour de l'expiration,
// puis après l'expiration ; et après l'échec d'un renouvellement automatique.
// SERVEUR UNIQUEMENT (tâche planifiée /api/cron/premium).
//
// Chaque rappel n'est envoyé qu'UNE fois par échéance : la table premium_notifications
// a une contrainte unique (utilisateur, date d'expiration, type) et on « réserve » la
// ligne AVANT d'envoyer. Une fois renouvelé, Premium a une nouvelle date d'expiration :
// les rappels repartent pour la nouvelle échéance.

import { supabaseAdmin } from "../supabase-admin";
import { formatDateFr } from "../premium";
import { sendPushToUser, type PushPayload } from "../push-server";

export type NotificationKind = "expiring_7d" | "expiring_3d" | "expires_today" | "expired" | "autorenew_failed";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Quel rappel correspond au temps restant ? (pur, testable) */
export function classifyExpiry(expiresAt: Date, now: Date): NotificationKind | null {
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return left > -3 * DAY ? "expired" : null;
  if (left <= DAY) return "expires_today";
  if (left <= 3 * DAY) return "expiring_3d";
  if (left <= 7 * DAY) return "expiring_7d";
  return null;
}

export function notificationText(kind: NotificationKind, expiresAtIso: string): PushPayload {
  const date = formatDateFr(expiresAtIso);
  const url = "/profile?subscribe=1";
  switch (kind) {
    case "expiring_7d":
      return { title: "Study Helper Premium", body: `Ton Premium expire dans 7 jours (le ${date}). Renouvelle-le pour garder tes avantages.`, url };
    case "expiring_3d":
      return { title: "Study Helper Premium", body: `Ton Premium expire dans 3 jours (le ${date}). Pense à le renouveler.`, url };
    case "expires_today":
      return { title: "Study Helper Premium", body: `Ton Premium expire aujourd'hui (${date}). Renouvelle-le maintenant pour ne pas perdre l'accès.`, url };
    case "expired":
      return { title: "Study Helper Premium", body: `Ton Premium a expiré le ${date}. Renouvelle-le pour retrouver les groupes et ta limite étendue.`, url };
    case "autorenew_failed":
      return { title: "Study Helper Premium", body: "Le renouvellement automatique de ton Premium a échoué. Renouvelle-le manuellement pour éviter une interruption.", url };
  }
}

/**
 * Réserve l'envoi (ligne unique) puis envoie. Renvoie false si ce rappel a déjà été
 * traité pour cette échéance. Fonctionne même sans abonnement push (delivered = 0).
 */
export async function notifyOnce(
  userId: string,
  kind: NotificationKind,
  periodEndIso: string,
  send: (userId: string, payload: PushPayload) => Promise<number> = sendPushToUser
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("premium_notifications")
    .insert({ user_id: userId, period_end: periodEndIso, kind, channel: "push" });
  if (error) {
    if (error.code !== "23505") console.error("[premium/notify] réservation :", error.message);
    return false; // déjà envoyé (23505) ou base indisponible : on n'insiste pas
  }

  let delivered = 0;
  try {
    delivered = await send(userId, notificationText(kind, periodEndIso));
  } catch (err) {
    console.error("[premium/notify] envoi :", err instanceof Error ? err.message : err);
  }
  if (delivered > 0) {
    await supabaseAdmin
      .from("premium_notifications")
      .update({ delivered })
      .eq("user_id", userId)
      .eq("period_end", periodEndIso)
      .eq("kind", kind);
  }
  return true;
}

export async function runExpiryNotifications(
  now: Date = new Date(),
  send: (userId: string, payload: PushPayload) => Promise<number> = sendPushToUser
): Promise<{ considered: number; notified: number }> {
  const from = new Date(now.getTime() - 3 * DAY).toISOString();
  const to = new Date(now.getTime() + 7 * DAY).toISOString();

  const { data: rows } = await supabaseAdmin
    .from("profiles")
    .select("id, premium_expires_at")
    .gte("premium_expires_at", from)
    .lte("premium_expires_at", to)
    .limit(2000);

  let notified = 0;
  const list = (rows ?? []) as { id: string; premium_expires_at: string }[];
  for (const row of list) {
    const kind = classifyExpiry(new Date(row.premium_expires_at), now);
    if (!kind) continue;
    if (await notifyOnce(row.id, kind, row.premium_expires_at, send)) notified++;
  }
  return { considered: list.length, notified };
}
