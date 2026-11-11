"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { loadLearnerMemory } from "@/lib/conversations";
import { computeInsights, recommendations, type Insights, type ResultRow } from "@/lib/dashboard-stats";
import { todayLocalISO } from "@/lib/utils";

type NextItem = { id: string; item_date: string; start_time: string; title: string; is_exam: boolean };

/**
 * « Mon suivi » : examens terminés, moyenne, tendance, performance par matière, derniers résultats, recommandations de révision,
 * prochaines activités et objectif personnel. Tout vient de TES données (RLS : uniquement les tiennes) ; états vides pour un nouvel
 * utilisateur, aucune statistique inventée.
 */
export default function StudyInsights() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [next, setNext] = useState<NextItem[] | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const [results, upcoming, memory] = await Promise.all([
        supabase.from("exam_results").select("subject, score_percent, taken_at").eq("owner_id", uid).order("taken_at", { ascending: false }).limit(200),
        supabase
          .from("schedule_items")
          .select("id, item_date, start_time, title, is_exam")
          .eq("owner_id", uid)
          .eq("completed", false)
          .gte("item_date", todayLocalISO())
          .order("item_date", { ascending: true })
          .order("start_time", { ascending: true })
          .limit(3),
        loadLearnerMemory().catch(() => null),
      ]);
      if (results.error) throw new Error("results");
      setInsights(computeInsights((results.data as ResultRow[] | null) ?? []));
      setNext((upcoming.data as NextItem[] | null) ?? []);
      // L'objectif n'est affiché que s'il est renseigné ET que la personnalisation n'est pas désactivée.
      setGoal(memory?.personalization_enabled === false ? null : memory?.goals?.trim() || null);
    })().catch(() => setError(true));
  }, []);

  if (error) return null; // le reste du tableau de bord reste utilisable
  if (!insights) return <div className="mt-6 rounded-card border border-mist bg-white p-5 text-sm text-slate">Chargement de ton suivi…</div>;

  const recs = recommendations(insights);
  const TrendIcon = insights.trend === "up" ? ArrowUpRight : insights.trend === "down" ? ArrowDownRight : ArrowRight;
  const trendText = insights.trend === "up" ? "en progression" : insights.trend === "down" ? "en baisse" : insights.trend === "stable" ? "stable" : null;

  return (
    <section className="mt-6 space-y-6" aria-label="Mon suivi">
      <div className="rounded-card border border-mist bg-white p-5">
        <p className="mb-4 font-display text-base text-ink">Mon suivi</p>
        {insights.total === 0 ? (
          <p className="text-sm text-slate">Pas encore de résultat : passe un examen pour voir ici tes statistiques, tes progrès et tes points à revoir.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-card bg-mist2 p-3">
                <p className="text-xs text-slate">Examens terminés</p>
                <p className="font-display text-xl text-ink">{insights.total}</p>
              </div>
              <div className="rounded-card bg-mist2 p-3">
                <p className="text-xs text-slate">Moyenne</p>
                <p className="font-display text-xl text-ink">{insights.average} %</p>
              </div>
              <div className="rounded-card bg-mist2 p-3">
                <p className="text-xs text-slate">Meilleure matière</p>
                <p className="truncate font-display text-base text-ink">{insights.best?.subject}</p>
                <p className="text-xs text-slate">{insights.best?.average} %</p>
              </div>
              <div className="rounded-card bg-mist2 p-3">
                <p className="text-xs text-slate">Tendance</p>
                {trendText ? (
                  <p className="flex items-center gap-1 font-display text-base text-ink">
                    <TrendIcon size={16} /> {trendText}
                  </p>
                ) : (
                  <p className="text-xs text-slate">Il faut au moins 4 résultats.</p>
                )}
              </div>
            </div>

            <p className="mb-2 mt-5 text-xs font-medium text-slate">Performance par matière</p>
            <ul className="space-y-2">
              {[...insights.bySubject].reverse().map((s) => (
                <li key={s.subject}>
                  <div className="flex justify-between text-sm text-ink">
                    <span className="truncate">{s.subject}</span>
                    <span>
                      {s.average} % <span className="text-xs text-slate">({s.count})</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-mist2" role="img" aria-label={`${s.subject} : ${s.average} %`}>
                    <div className={`h-2 rounded-full ${s.average < 70 ? "bg-clay" : "bg-forest"}`} style={{ width: `${s.average}%` }} />
                  </div>
                </li>
              ))}
            </ul>

            <p className="mb-2 mt-5 text-xs font-medium text-slate">Derniers résultats</p>
            <ul className="divide-y divide-mist text-sm">
              {insights.recent.map((x, i) => (
                <li key={i} className="flex justify-between py-1.5">
                  <span className="truncate text-ink">{x.subject}</span>
                  <span className="text-slate">
                    {x.score_percent} % · {new Date(x.taken_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-mist bg-white p-5">
          <p className="mb-3 font-display text-base text-ink">À revoir</p>
          <ul className="space-y-2 text-sm">
            {recs.map((r, i) => (
              <li key={i}>
                <Link href={r.href} className="text-ink underline decoration-mist underline-offset-2 hover:decoration-ink">
                  {r.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-card border border-mist bg-white p-5">
          <p className="mb-3 font-display text-base text-ink">Prochaines activités</p>
          {next && next.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {next.map((n) => (
                <li key={n.id} className="flex justify-between gap-3">
                  <span className="truncate text-ink">{n.is_exam ? "📝 " : ""}{n.title}</span>
                  <span className="shrink-0 text-slate">
                    {n.item_date === todayLocalISO() ? "aujourd'hui" : new Date(n.item_date).toLocaleDateString()} · {n.start_time}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate">
              Rien de prévu : génère ton planning depuis <Link href="/schedule" className="underline">Planning</Link>.
            </p>
          )}
          <p className="mb-1 mt-4 text-xs font-medium text-slate">Mon objectif</p>
          {goal ? (
            <p className="text-sm text-ink">{goal}</p>
          ) : (
            <p className="text-sm text-slate">
              Définis tes objectifs dans ton <Link href="/profile" className="underline">profil</Link> (mémoire pédagogique) pour les retrouver ici.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
