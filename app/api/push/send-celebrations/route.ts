import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { dueCelebrations, isSendWindow, localDateParts, type CelebrationPrefs } from "@/lib/celebrations";
import { greetingName } from "@/lib/learner-context-format";

export const runtime = "nodejs";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:contact@studyhelper.app";

/**
 * Envoie les notifications d'anniversaire / de fête. À déclencher toutes les heures (Vercel Cron Pro ou cron externe,
 * en-tête « Authorization: Bearer CRON_SECRET »). Une exécution par jour suffit aussi : l'envoi se fait dès 8 h locale de chaque élève.
 *  - Seuls les élèves qui ont ACTIVÉ les célébrations sont lus (opt-in).
 *  - Date évaluée dans le fuseau de l'élève ; jamais de nuit (8 h–21 h).
 *  - Anti-doublon ATOMIQUE : la ligne de celebration_log (UNIQUE owner/clé/année) est insérée AVANT l'envoi ; si elle existe déjà, on n'envoie pas.
 *  - Sans abonnement push, rien n'est envoyé hors de l'application (le bandeau dans l'application prend le relais).
 */
export async function GET(req: NextRequest) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "VAPID non configuré : aucune notification envoyée." }, { status: 500 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { data: prefsRows, error } = await supabaseAdmin.from("celebration_prefs").select("*").eq("celebrations_enabled", true);
  if (error) return NextResponse.json({ error: "Lecture des préférences impossible." }, { status: 500 });
  const prefs = (prefsRows ?? []) as (CelebrationPrefs & { owner_id: string })[];
  if (prefs.length === 0) return NextResponse.json({ sent: 0, due: 0 });

  const ids = prefs.map((p) => p.owner_id);
  const [{ data: profiles }, { data: memories }, { data: subs }] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, full_name, timezone").in("id", ids),
    supabaseAdmin.from("learner_memory").select("owner_id, display_name, personalization_enabled").in("owner_id", ids),
    supabaseAdmin.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").in("user_id", ids),
  ]);

  const now = new Date();
  let due = 0;
  let sent = 0;
  for (const pref of prefs) {
    const profile = (profiles ?? []).find((p) => p.id === pref.owner_id);
    const parts = localDateParts(now, profile?.timezone);
    if (!isSendWindow(parts)) continue;

    const memory = (memories ?? []).find((m) => m.owner_id === pref.owner_id);
    const name = memory?.personalization_enabled === false ? "" : greetingName(memory?.display_name, profile?.full_name);
    const ownerSubs = (subs ?? []).filter((s) => s.user_id === pref.owner_id);

    for (const c of dueCelebrations(pref, name, parts)) {
      due++;
      const { error: dupError } = await supabaseAdmin.from("celebration_log").insert({ owner_id: pref.owner_id, celebration_key: c.key, year: parts.year });
      if (dupError) continue; // déjà envoyée cette année (ou journal indisponible : on préfère ne rien envoyer que doubler)

      let delivered = 0;
      for (const sub of ownerSubs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: c.title, body: c.body, url: "/dashboard" }));
          delivered++;
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
      sent += delivered;
      // Appareils connus mais aucun envoi réussi (panne passagère) : on libère la clé pour une nouvelle tentative à la prochaine exécution.
      if (ownerSubs.length > 0 && delivered === 0) {
        await supabaseAdmin.from("celebration_log").delete().eq("owner_id", pref.owner_id).eq("celebration_key", c.key).eq("year", parts.year);
      }
    }
  }
  return NextResponse.json({ sent, due });
}
