"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { Check, X, Flag, ShieldOff } from "lucide-react";

type Opportunity = {
  id: string;
  category: string;
  title: string;
  description: string;
  organization: string | null;
  status: string;
  submitted_by: string;
};

type Activity = {
  id: string;
  category: string;
  title: string;
  description: string;
  organizer: string | null;
  status: string;
  submitted_by: string;
};

type Report = {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  created_at: string;
};

export default function ModerationPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"opportunities" | "activities" | "reports">(
    "opportunities"
  );
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    const canModerate = profile?.role === "moderator" || profile?.role === "admin";
    setAllowed(canModerate);
    if (!canModerate) {
      setLoading(false);
      return;
    }

    const [{ data: opps }, { data: acts }, { data: reps }] = await Promise.all([
      supabase
        .from("opportunities")
        .select("id, category, title, description, organization, status, submitted_by")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("activities")
        .select("id, category, title, description, organizer, status, submitted_by")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("reports")
        .select("id, reporter_id, target_type, target_id, reason, created_at")
        .order("created_at", { ascending: false }),
    ]);

    setOpportunities(opps ?? []);
    setActivities(acts ?? []);
    setReports(reps ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function moderateOpportunity(id: string, status: "approved" | "rejected") {
    const { data: userData } = await supabase.auth.getUser();
    await supabase
      .from("opportunities")
      .update({
        status,
        moderated_by: userData.user?.id,
        moderated_at: new Date().toISOString(),
      })
      .eq("id", id);
    setOpportunities((prev) => prev.filter((o) => o.id !== id));
  }

  async function moderateActivity(id: string, status: "approved" | "rejected") {
    await supabase.from("activities").update({ status }).eq("id", id);
    setActivities((prev) => prev.filter((a) => a.id !== id));
  }

  if (allowed === false) {
    return (
      <AppShell active="moderation" title="Modération">
        <div className="flex flex-col items-center gap-2 rounded-card border border-mist bg-white p-10 text-center">
          <ShieldOff size={28} className="text-clay" />
          <p className="text-sm text-ink">
            Cette page est réservée aux modérateurs et administrateurs.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="moderation" title="Modération">
      <div className="mb-6 flex gap-2">
        {[
          { key: "opportunities", label: `Opportunités (${opportunities.length})` },
          { key: "activities", label: `Activités (${activities.length})` },
          { key: "reports", label: `Signalements (${reports.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`rounded-full px-3 py-1.5 text-xs ${
              tab === t.key ? "bg-ink text-paper" : "border border-mist text-slate"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : tab === "opportunities" ? (
        opportunities.length === 0 ? (
          <p className="text-sm text-slate">Rien en attente. 🎉</p>
        ) : (
          <div className="space-y-3">
            {opportunities.map((o) => (
              <div key={o.id} className="rounded-card border border-mist bg-white p-4">
                <span className="rounded-full bg-mist2 px-2 py-0.5 text-[11px] text-slate">
                  {o.category}
                </span>
                <p className="mt-1 font-display text-base text-ink">{o.title}</p>
                {o.organization && (
                  <p className="text-xs text-slate">{o.organization}</p>
                )}
                <p className="mt-1 text-sm text-slate">{o.description}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => moderateOpportunity(o.id, "approved")}
                    className="flex items-center gap-1 rounded-card bg-forest px-3 py-1.5 text-xs text-paper hover:bg-forest/90"
                  >
                    <Check size={13} /> Approuver
                  </button>
                  <button
                    onClick={() => moderateOpportunity(o.id, "rejected")}
                    className="flex items-center gap-1 rounded-card border border-clay px-3 py-1.5 text-xs text-clay hover:bg-clay/5"
                  >
                    <X size={13} /> Refuser
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tab === "activities" ? (
        activities.length === 0 ? (
          <p className="text-sm text-slate">Rien en attente. 🎉</p>
        ) : (
          <div className="space-y-3">
            {activities.map((a) => (
              <div key={a.id} className="rounded-card border border-mist bg-white p-4">
                <span className="rounded-full bg-mist2 px-2 py-0.5 text-[11px] text-slate">
                  {a.category}
                </span>
                <p className="mt-1 font-display text-base text-ink">{a.title}</p>
                {a.organizer && <p className="text-xs text-slate">{a.organizer}</p>}
                <p className="mt-1 text-sm text-slate">{a.description}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => moderateActivity(a.id, "approved")}
                    className="flex items-center gap-1 rounded-card bg-forest px-3 py-1.5 text-xs text-paper hover:bg-forest/90"
                  >
                    <Check size={13} /> Approuver
                  </button>
                  <button
                    onClick={() => moderateActivity(a.id, "rejected")}
                    className="flex items-center gap-1 rounded-card border border-clay px-3 py-1.5 text-xs text-clay hover:bg-clay/5"
                  >
                    <X size={13} /> Refuser
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : reports.length === 0 ? (
        <p className="text-sm text-slate">Aucun signalement.</p>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div
              key={r.id}
              className="flex items-start gap-3 rounded-card border border-mist bg-white p-4"
            >
              <Flag size={16} className="mt-0.5 shrink-0 text-clay" />
              <div>
                <p className="text-sm text-ink">{r.reason ?? "(sans motif précisé)"}</p>
                <p className="text-xs text-slate/60">
                  {r.target_type} #{r.target_id.slice(0, 8)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
