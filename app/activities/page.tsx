"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { Plus, MapPin, CalendarClock, Trophy, ExternalLink } from "lucide-react";
import AdSlot from "@/components/ads/AdSlot";

type Activity = {
  id: string;
  category: string;
  title: string;
  organizer: string | null;
  description: string;
  location: string | null;
  event_date: string | null;
  registration_link: string | null;
  rewards: string | null;
  status: string;
  submitted_by: string;
};

const categories = [
  { value: "hackathon", label: "Hackathon" },
  { value: "concours", label: "Concours" },
  { value: "olympiade", label: "Olympiade" },
  { value: "conference", label: "Conférence" },
  { value: "atelier", label: "Atelier" },
  { value: "club", label: "Club étudiant" },
];

export default function ActivitiesPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [myPending, setMyPending] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    category: categories[0].value,
    title: "",
    organizer: "",
    description: "",
    location: "",
    event_date: "",
    registration_link: "",
    rewards: "",
  });

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;
    setUserId(uid);

    const { data: approved } = await supabase
      .from("activities")
      .select("*")
      .eq("status", "approved")
      .order("event_date", { ascending: true });
    setItems(approved ?? []);

    if (uid) {
      const { data: pending } = await supabase
        .from("activities")
        .select("*")
        .eq("submitted_by", uid)
        .neq("status", "approved");
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

    const { error: insertError } = await supabase.from("activities").insert({
      submitted_by: userId,
      category: form.category,
      title: form.title,
      organizer: form.organizer || null,
      description: form.description,
      location: form.location || null,
      event_date: form.event_date || null,
      registration_link: form.registration_link || null,
      rewards: form.rewards || null,
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
      organizer: "",
      description: "",
      location: "",
      event_date: "",
      registration_link: "",
      rewards: "",
    });
    load();
  }

  const filtered =
    filter === "all" ? items : items.filter((i) => i.category === filter);

  return (
    <AppShell active="activities" title="Activités éducatives">
      <AdSlot slot="activities_inline" />
      <p className="mb-4 text-sm text-slate">
        Hackathons, concours, olympiades, conférences, ateliers, clubs — vérifiés
        avant publication, comme les opportunités.
      </p>

      {myPending.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-xs font-medium text-slate">
            Tes propositions en attente de modération
          </p>
          {myPending.map((a) => (
            <div
              key={a.id}
              className="rounded-card border border-dashed border-mist bg-white px-4 py-2 text-sm text-slate"
            >
              {a.title} —{" "}
              <span className={a.status === "rejected" ? "text-clay" : "text-gold"}>
                {a.status === "rejected" ? "refusée" : "en attente"}
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
          className="flex shrink-0 items-center gap-2 rounded-card bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold/90"
        >
          <Plus size={16} /> Proposer une activité
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
                Organisateur
              </label>
              <input
                value={form.organizer}
                onChange={(e) => setForm({ ...form, organizer: e.target.value })}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate">Lieu</label>
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate">Date</label>
              <input
                type="date"
                value={form.event_date}
                onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate">
                Lien d'inscription
              </label>
              <input
                value={form.registration_link}
                onChange={(e) =>
                  setForm({ ...form, registration_link: e.target.value })
                }
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate">
                Récompenses (optionnel)
              </label>
              <input
                value={form.rewards}
                onChange={(e) => setForm({ ...form, rewards: e.target.value })}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-sm text-clay">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-card bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold/90 disabled:opacity-60"
          >
            {submitting ? "Envoi…" : "Soumettre pour modération"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate">Aucune activité pour l'instant.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((a) => (
            <div
              key={a.id}
              className="rounded-card border border-mist bg-white p-5"
            >
              <span className="rounded-full bg-mist2 px-2 py-0.5 text-[11px] text-slate">
                {categories.find((c) => c.value === a.category)?.label}
              </span>
              <p className="mt-2 font-display text-base text-ink">{a.title}</p>
              {a.organizer && (
                <p className="text-xs text-slate">Par {a.organizer}</p>
              )}
              <p className="mt-2 text-sm text-slate">{a.description}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate">
                {a.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={13} /> {a.location}
                  </span>
                )}
                {a.event_date && (
                  <span className="flex items-center gap-1">
                    <CalendarClock size={13} /> {a.event_date}
                  </span>
                )}
                {a.rewards && (
                  <span className="flex items-center gap-1">
                    <Trophy size={13} /> {a.rewards}
                  </span>
                )}
              </div>
              {a.registration_link && (
                <a
                  href={a.registration_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-sm text-clay hover:underline"
                >
                  S'inscrire <ExternalLink size={13} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
