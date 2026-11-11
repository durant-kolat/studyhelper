"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { relativeDate } from "@/lib/utils";
import AdSlot from "@/components/ads/AdSlot";
import {
  Plus,
  ShieldCheck,
  Flag,
  MapPin,
  CalendarClock,
  ExternalLink,
} from "lucide-react";

type Opportunity = {
  id: string;
  category: string;
  title: string;
  organization: string | null;
  description: string;
  location: string | null;
  contact: string | null;
  deadline: string | null;
  verified_badge: boolean;
  status: string;
  submitted_by: string;
  created_at: string;
};

const categories = [
  { value: "bourse", label: "Bourse" },
  { value: "certification", label: "Certification" },
  { value: "formation", label: "Formation" },
  { value: "stage", label: "Stage" },
  { value: "job_etudiant", label: "Job étudiant" },
  { value: "freelance", label: "Freelance" },
  { value: "projet", label: "Projet" },
  { value: "startup", label: "Startup" },
  { value: "challenge", label: "Challenge" },
];

export default function OpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [myPending, setMyPending] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    category: categories[0].value,
    title: "",
    organization: "",
    description: "",
    location: "",
    contact: "",
    deadline: "",
  });

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;
    setUserId(uid);

    const { data: approved } = await supabase
      .from("opportunities")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false });
    setItems(approved ?? []);

    if (uid) {
      const { data: pending } = await supabase
        .from("opportunities")
        .select("*")
        .eq("submitted_by", uid)
        .neq("status", "approved")
        .order("created_at", { ascending: false });
      setMyPending(pending ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase.from("opportunities").insert({
      submitted_by: userId,
      category: form.category,
      title: form.title,
      organization: form.organization || null,
      description: form.description,
      location: form.location || null,
      contact: form.contact || null,
      deadline: form.deadline || null,
    });

    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setShowForm(false);
    setForm({
      category: categories[0].value,
      title: "",
      organization: "",
      description: "",
      location: "",
      contact: "",
      deadline: "",
    });
    load();
  }

  async function handleReport(id: string) {
    if (!userId) return;
    const reason = window.prompt(
      "Pourquoi signales-tu cette opportunité ? (arnaque, contenu trompeur, spam…)"
    );
    if (!reason) return;
    setReportingId(id);
    await supabase.from("reports").insert({
      target_type: "opportunity",
      target_id: id,
      reporter_id: userId,
      reason,
    });
    setReportingId(null);
    alert("Merci, ton signalement a été enregistré et sera examiné.");
  }

  const filtered =
    filter === "all" ? items : items.filter((i) => i.category === filter);

  return (
    <AppShell active="opportunities" title="Opportunités">
      <AdSlot slot="opportunities_inline" />
      <div className="mb-4 rounded-card border border-mist bg-mist2 px-4 py-3 text-xs text-slate">
        <ShieldCheck size={14} className="mr-1 inline text-forest" />
        Chaque opportunité est vérifiée par un modérateur avant publication.
        Signale tout ce qui te semble suspect (demande d'argent, arnaque...).
      </div>

      {myPending.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-xs font-medium text-slate">
            Tes propositions en attente de modération
          </p>
          {myPending.map((o) => (
            <div
              key={o.id}
              className="rounded-card border border-dashed border-mist bg-white px-4 py-2 text-sm text-slate"
            >
              {o.title} —{" "}
              <span className={o.status === "rejected" ? "text-clay" : "text-gold"}>
                {o.status === "rejected" ? "refusée" : "en attente"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === "all" ? "bg-ink text-paper" : "border border-mist text-slate"
            }`}
          >
            Toutes
          </button>
          {categories.map((c) => (
            <button
              key={c.value}
              onClick={() => setFilter(c.value)}
              className={`rounded-full px-3 py-1 text-xs ${
                filter === c.value
                  ? "bg-ink text-paper"
                  : "border border-mist text-slate"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex shrink-0 items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90"
        >
          <Plus size={16} /> Proposer une opportunité
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 space-y-3 rounded-card border border-mist bg-white p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate">Catégorie</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate">
                Organisation (optionnel)
              </label>
              <input
                value={form.organization}
                onChange={(e) => setForm({ ...form, organization: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate">Titre</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-card border border-mist px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate">Description</label>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-card border border-mist px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-slate">Lieu</label>
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate">
                Contact / lien
              </label>
              <input
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate">
                Date limite
              </label>
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-sm text-clay">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
          >
            {submitting ? "Envoi…" : "Soumettre pour modération"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate">Aucune opportunité pour l'instant.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((o) => (
            <div
              key={o.id}
              className="rounded-card border border-mist bg-white p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="rounded-full bg-mist2 px-2 py-0.5 text-[11px] text-slate">
                    {categories.find((c) => c.value === o.category)?.label ??
                      o.category}
                  </span>
                  <p className="mt-2 font-display text-base text-ink">
                    {o.title}
                    {o.verified_badge && (
                      <ShieldCheck
                        size={14}
                        className="ml-1 inline text-forest"
                      />
                    )}
                  </p>
                  {o.organization && (
                    <p className="text-xs text-slate">{o.organization}</p>
                  )}
                </div>
                <button
                  onClick={() => handleReport(o.id)}
                  disabled={reportingId === o.id}
                  aria-label="Signaler"
                  className="shrink-0 text-slate hover:text-clay"
                >
                  <Flag size={15} />
                </button>
              </div>
              <p className="mt-2 text-sm text-slate">{o.description}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate">
                {o.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={13} /> {o.location}
                  </span>
                )}
                {o.deadline && (
                  <span className="flex items-center gap-1">
                    <CalendarClock size={13} /> {o.deadline}
                  </span>
                )}
              </div>
              {o.contact && (
                <a
                  href={
                    o.contact.startsWith("http") ? o.contact : `mailto:${o.contact}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-sm text-clay hover:underline"
                >
                  Postuler / en savoir plus <ExternalLink size={13} />
                </a>
              )}
              <p className="mt-2 text-[11px] text-slate/50">
                publié {relativeDate(o.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
