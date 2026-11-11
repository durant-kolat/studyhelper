"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { todayLocalISO } from "@/lib/utils";

type ScheduleRow = {
  start_time: string | null;
  end_time: string | null;
  title: string | null;
  subject: string | null;
  is_exam: boolean | null;
  status: string | null;
};

function todayAt(time: string) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function notify(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

export default function NotificationScheduler() {
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    async function schedule() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data } = await supabase
        .from("schedule_items")
        .select("start_time, end_time, title, subject, is_exam, status")
        .eq("owner_id", userData.user.id)
        .eq("item_date", todayLocalISO());

      const items = (data ?? []) as ScheduleRow[];
      const now = Date.now();

      for (const item of items) {
        // Seules les séances de révision déclenchent un rappel (pas les cours, repas, pauses…).
        if (!item.subject || !item.start_time || !item.end_time || item.status === "done") continue;
        const startMin = item.start_time.split(":").map(Number);
        const endMin = item.end_time.split(":").map(Number);
        const durationMinutes = endMin[0] * 60 + endMin[1] - (startMin[0] * 60 + startMin[1]);
        if (!(durationMinutes > 0)) continue;

        const start = todayAt(item.start_time).getTime();
        const isExam = !!item.is_exam;
        const label = item.subject;

        const reminderAt = start - 10 * 60 * 1000;
        if (reminderAt > now) {
          timeouts.push(
            setTimeout(
              () => notify("🔔 Study Helper", `Révision dans 10 minutes : ${label}`),
              reminderAt - now
            )
          );
        }

        if (start > now) {
          timeouts.push(
            setTimeout(
              () =>
                notify(
                  "📚 Study Helper",
                  isExam
                    ? `Ton examen de ${durationMinutes} minutes commence maintenant.`
                    : `C'est l'heure de ta révision : ${label}.`
                ),
              start - now
            )
          );
        }

        {
          const end = start + durationMinutes * 60 * 1000;
          if (end > now) {
            timeouts.push(
              setTimeout(
                () => notify("✅ Study Helper", `Session terminée : ${label}.`),
                end - now
              )
            );
          }
        }
      }
    }

    schedule();
    return () => timeouts.forEach(clearTimeout);
  }, []);

  return null;
}
