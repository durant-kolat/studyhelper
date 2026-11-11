import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:contact@studyhelper.app";

// Calcule la date/heure "maintenant" dans un fuseau IANA donné (celui
// de chaque utilisateur, stocké dans profiles.timezone) — plus un seul
// fuseau codé en dur pour tout le monde.
function nowInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function addMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60);
  const mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

type ScheduleRow = {
  owner_id: string;
  title: string;
  subject: string | null;
  start_time: string;
  end_time: string;
  is_exam: boolean;
};

export async function GET(req: NextRequest) {
  // Sécurise cette route : seul le cron (avec le bon secret) peut la
  // déclencher — sinon n'importe qui pourrait la spammer/l'abuser.
  const auth = req.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  // Déclasse les abonnements Premium arrivés à expiration — sans ça,
  // subscription_status resterait "premium" pour toujours après le
  // dernier paiement (l'affichage et les quotas seraient incohérents).
  await supabaseAdmin
    .from("profiles")
    .update({ subscription_status: "free" })
    .eq("subscription_status", "premium")
    .lt("subscription_expires_at", new Date().toISOString());

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "VAPID non configuré." }, { status: 500 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  type Notif = { owner_id: string; title: string; body: string };
  const notifications: Notif[] = [];

  // Un fuseau par utilisateur : on regroupe les utilisateurs par
  // fuseau (généralement peu de valeurs distinctes en pratique), et on
  // calcule "maintenant" séparément pour chaque groupe.
  const { data: timezoneRows } = await supabaseAdmin
    .from("profiles")
    .select("timezone")
    .not("timezone", "is", null);
  const timezones = [...new Set((timezoneRows ?? []).map((r) => r.timezone))];

  for (const tz of timezones) {
    const { date, time } = nowInTimezone(tz);
    const reminderTime = addMinutes(time, 10);

    const { data: ownersInTz } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("timezone", tz);
    const ownerIds = (ownersInTz ?? []).map((o) => o.id);
    if (ownerIds.length === 0) continue;

    const { data: items } = await supabaseAdmin
      .from("schedule_items")
      .select("owner_id, title, subject, start_time, end_time, is_exam")
      .eq("item_date", date)
      .in("owner_id", ownerIds);

    for (const item of (items ?? []) as ScheduleRow[]) {
      // Seuls les blocs matière ou examen déclenchent un rappel — pas les
      // simples repères (réveil, pause, départ pour l'école).
      if (!item.subject && !item.is_exam) continue;

      const durationMinutes =
        item.end_time !== item.start_time
          ? (() => {
              const [sh, sm] = item.start_time.split(":").map(Number);
              const [eh, em] = item.end_time.split(":").map(Number);
              const d = eh * 60 + em - (sh * 60 + sm);
              return d > 0 ? d : null;
            })()
          : null;

      if (item.start_time === reminderTime) {
        notifications.push({
          owner_id: item.owner_id,
          title: "🔔 Study Helper",
          body: `Révision dans 10 minutes : ${item.title}`,
        });
      }
      if (item.start_time === time) {
        notifications.push({
          owner_id: item.owner_id,
          title: item.is_exam ? "📝 Study Helper" : "📚 Study Helper",
          body: item.is_exam
            ? `Ton examen de ${durationMinutes ?? 30} minutes commence maintenant.`
            : `C'est l'heure de ta révision : ${item.title}.`,
        });
      }
      if (durationMinutes && addMinutes(item.start_time, durationMinutes) === time) {
        notifications.push({
          owner_id: item.owner_id,
          title: "✅ Study Helper",
          body: `Session terminée : ${item.title}.`,
        });
      }
    }
  }

  if (notifications.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const ownerIds = [...new Set(notifications.map((n) => n.owner_id))];
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", ownerIds);

  let sent = 0;
  for (const notif of notifications) {
    const ownerSubs = (subs ?? []).filter((s) => s.user_id === notif.owner_id);
    for (const sub of ownerSubs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({ title: notif.title, body: notif.body, url: "/dashboard" })
        );
        sent++;
      } catch (err: unknown) {
        // Abonnement expiré/invalide (410 Gone) : on le supprime.
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await supabaseAdmin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }
    }
  }

  return NextResponse.json({ sent });
}
