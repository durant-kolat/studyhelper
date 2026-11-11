// Envoi de notifications push (web-push) à un utilisateur — réutilise les abonnements
// existants (table push_subscriptions) et les clés VAPID déjà configurées.
// SERVEUR UNIQUEMENT. Ne lève jamais : renvoie le nombre d'appareils joints (0 si aucun
// abonnement ou si VAPID n'est pas configuré — l'interface affiche de toute façon les
// rappels Premium dans le compte de l'utilisateur).

import webpush from "web-push";
import { supabaseAdmin } from "./supabase-admin";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:contact@studyhelper.app";

export type PushPayload = { title: string; body: string; url?: string };

let vapidReady = false;
function ensureVapid(): boolean {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  }
  return true;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureVapid()) return 0;
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  let delivered = 0;
  for (const sub of (subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? "/profile" })
      );
      delivered++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }
  return delivered;
}
