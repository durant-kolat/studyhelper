"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import ProgressCard, { SubjectProgress } from "@/components/ProgressCard";
import Notification from "@/components/Notification";
import { supabase } from "@/lib/supabase";
import { fetchSubjectProgress } from "@/lib/api";
import { todayLocalISO } from "@/lib/utils";
import { minutesBetween } from "@/lib/schedule";
import { CheckCircle2, Circle } from "lucide-react";
import AdSlot from "@/components/ads/AdSlot";
import StudyInsights from "@/components/StudyInsights";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { displayFirstName, greetingPeriod } from "@/lib/greeting";
import { greetingText } from "@/lib/i18n/greeting-strings";

type ScheduleRow = {
  id: string;
  start_time: string;
  end_time: string;
  title: string;
  subject: string | null;
  is_exam: boolean;
  completed: boolean;
};

export default function DashboardPage() {
  const [progress, setProgress] = useState<SubjectProgress[]>([]);
  const [today, setToday] = useState<ScheduleRow[]>([]);
  const [loadingToday, setLoadingToday] = useState(true);
  const { lang } = useI18n();
  const [firstName, setFirstName] = useState<string | null>(null);
  // Heure LOCALE de l'appareil, remise à jour chaque minute (changement de période / de jour).
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => setHour(new Date().getHours()), 60000);
    return () => clearInterval(t);
  }, []);

  async function loadToday(userId: string) {
    const { data } = await supabase
      .from("schedule_items")
      .select("id, start_time, end_time, title, subject, is_exam, completed")
      .eq("owner_id", userId)
      .eq("item_date", todayLocalISO())
      .order("start_time", { ascending: true });
    setToday(data ?? []);
    setLoadingToday(false);
  }

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      // Prénom du compte connecté uniquement (RLS + filtre sur son propre id).
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", userData.user.id).maybeSingle();
      setFirstName(displayFirstName(prof?.full_name));
      setProgress(await fetchSubjectProgress(userData.user.id));
      await loadToday(userData.user.id);
    }
    load();
  }, []);

  async function toggleCompleted(item: ScheduleRow) {
    setToday((prev) =>
      prev.map((t) => (t.id === item.id ? { ...t, completed: !t.completed } : t))
    );
    const next = !item.completed;
    const { error } = await supabase
      .from("schedule_items")
      .update({ completed: next, status: next ? "done" : "todo" })
      .eq("id", item.id);
    if (error) {
      // Base sans la migration v2.7 (colonne `status` absente) : on garde au moins `completed`.
      await supabase.from("schedule_items").update({ completed: next }).eq("id", item.id);
    }
  }

  const revisions = today.filter(
    (t) => t.subject || t.is_exam
  );
  const completedCount = revisions.filter((r) => r.completed).length;
  const objectivePercent =
    revisions.length > 0
      ? Math.round((completedCount / revisions.length) * 100)
      : 0;

  return (
    <AppShell active="dashboard" title={greetingText(lang, greetingPeriod(hour), firstName)}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-card border border-mist bg-white p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-base text-ink">
                Objectif du jour
              </p>
              <span className="text-sm text-slate">
                {revisions.length > 0
                  ? `${completedCount}/${revisions.length} · ${objectivePercent}%`
                  : "—"}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-mist2">
              <div
                className="h-2.5 rounded-full bg-gold transition-all"
                style={{ width: `${objectivePercent}%` }}
              />
            </div>
          </div>

          <div className="ruled-bg rounded-card border border-mist bg-white p-5">
            <p className="mb-4 font-display text-base text-ink">
              Révisions aujourd'hui
            </p>
            {loadingToday ? (
              <p className="text-sm text-slate">Chargement…</p>
            ) : today.length === 0 ? (
              <p className="text-sm text-slate">
                Pas encore de planning aujourd'hui — génère-le depuis
                "Planning".
              </p>
            ) : (
              <ul className="space-y-3">
                {today.map((item) => {
                  const checkable =
                    item.subject || item.is_exam;
                  return (
                    <li key={item.id} className="flex items-center gap-4">
                      <span className="w-14 shrink-0 font-display text-sm text-clay">
                        {item.start_time}
                      </span>
                      <span
                        className={`flex-1 text-sm ${
                          item.completed
                            ? "text-slate/50 line-through"
                            : "text-ink"
                        }`}
                      >
                        {item.title}
                      </span>
                      {item.end_time !== item.start_time && (
                        <span className="text-xs text-slate">
                          {minutesBetween(item.start_time, item.end_time)} min
                        </span>
                      )}
                      {checkable && (
                        <button
                          onClick={() => toggleCompleted(item)}
                          aria-label={
                            item.completed
                              ? "Marquer comme non terminé"
                              : "Marquer comme terminé"
                          }
                          className="text-slate hover:text-forest"
                        >
                          {item.completed ? (
                            <CheckCircle2 size={18} className="text-forest" />
                          ) : (
                            <Circle size={18} />
                          )}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {progress.length > 0 ? (
            <ProgressCard data={progress} />
          ) : (
            <div className="rounded-card border border-mist bg-white p-5 text-sm text-slate">
              Pas encore de résultat d'examen — ta progression par matière
              apparaîtra ici.
            </div>
          )}
          <div className="space-y-3">
            {revisions.length === 0 ? (
              <Notification
                kind="reminder"
                message="Génère ton planning du jour pour recevoir des rappels."
              />
            ) : (
              revisions
                .filter((r) => !r.completed)
                .slice(0, 2)
                .map((r) => (
                  <Notification
                    key={r.id}
                    kind={r.is_exam ? "exam" : "reminder"}
                    message={
                      r.is_exam
                        ? `Ton examen de ${minutesBetween(r.start_time, r.end_time) || 30} minutes commence à ${r.start_time}.`
                        : `Révision de ${r.title} à ${r.start_time}.`
                    }
                  />
                ))
            )}
          </div>
        </div>
      </div>
      <StudyInsights />
      {/* Publicité discrète, SOUS les cartes principales : ne masque ni statistiques ni fonctions. */}
      <div className="mt-6"><AdSlot slot="dashboard_inline" /></div>
    </AppShell>
  );
}
