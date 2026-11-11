"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { joinGroup } from "@/lib/api";
import { GROUPS_PREMIUM_MESSAGE, isPremiumActive } from "@/lib/group-access";
import { MessageCircle, Loader2, Plus, Crown } from "lucide-react";
import AdSlot from "@/components/ads/AdSlot";

type GroupRow = {
  id: string;
  name: string;
  subject: string | null;
  memberCount: number;
  /** true = déjà membre (l'accès effectif dépend en plus du Premium actif). */
  isMember: boolean;
};

const subjects = ["Mathématiques", "Physique", "Informatique", "Anglais", "Autre"];

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState(subjects[0]);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  // Premium actif ? (affichage — la base applique la règle pour de bon)
  const [premium, setPremium] = useState(false);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const userId = userData.user.id;

    const { data: allGroups } = await supabase
      .from("groups")
      .select("id, name, subject")
      .order("created_at", { ascending: false });

    const { data: members } = await supabase
      .from("group_members")
      .select("group_id, user_id");

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status, subscription_expires_at")
      .eq("id", userId)
      .maybeSingle();
    setPremium(isPremiumActive(profile?.subscription_status, profile?.subscription_expires_at));

    const rows: GroupRow[] = (allGroups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      subject: g.subject,
      memberCount: (members ?? []).filter((m) => m.group_id === g.id).length,
      isMember: (members ?? []).some((m) => m.group_id === g.id && m.user_id === userId),
    }));

    setGroups(rows);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Créer un groupe fait partie de l'offre Premium (vérifié par la base : la politique
  // d'insertion sur "groups" exige un Premium actif). On ajoute ensuite le créateur comme membre.
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!premium) {
      setError(GROUPS_PREMIUM_MESSAGE);
      return;
    }
    setCreating(true);
    setError(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setCreating(false);
      return;
    }

    const { data: group, error: createError } = await supabase
      .from("groups")
      .insert({ name, subject, owner_id: userData.user.id })
      .select("id")
      .single();

    if (createError || !group) {
      setError(createError?.message ?? "Échec de la création.");
      setCreating(false);
      return;
    }

    const { error: memberError } = await supabase
      .from("group_members")
      .insert({ group_id: group.id, user_id: userData.user.id, role: "owner" });
    if (memberError) {
      // Le groupe existe mais le créateur n'y est pas inscrit : on le dit au lieu de l'ignorer
      // (sans adhésion, il n'aurait pas accès à son propre groupe).
      setError(`Groupe créé, mais ton inscription a échoué : ${memberError.message}`);
    }

    setCreating(false);
    setShowForm(false);
    setName("");
    load();
  }

  // Rejoindre un groupe : gratuit pour un Premium actif (aucun paiement supplémentaire).
  // La vérification du statut Premium est faite par la base (fonction join_group).
  async function handleJoin(groupId: string) {
    setJoiningId(groupId);
    setError(null);
    try {
      await joinGroup(groupId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de rejoindre ce groupe.");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <AppShell active="groups" title="Groupes d'étude">
      <AdSlot slot="groups_inline" />
      {!loading && !premium && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-gold/60 bg-gold/10 p-4">
          <p className="text-sm text-ink">{GROUPS_PREMIUM_MESSAGE}</p>
          <Link
            href="/profile"
            className="flex items-center gap-1.5 rounded-card bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold/90"
          >
            <Crown size={14} /> Passer Premium
          </Link>
        </div>
      )}
      <div className="mb-6 flex justify-end">
        <button
          disabled={!premium}
          title={premium ? undefined : "Réservé aux abonnés Premium"}
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 disabled:opacity-50"
        >
          <Plus size={16} /> Créer un groupe
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-card border border-mist bg-white p-4"
        >
          <div className="flex-1">
            <label className="mb-1 block text-sm text-slate">
              Nom du groupe
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex : Terminale C — Mathématiques"
              className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate">Matière</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-card border border-mist px-3 py-2 text-sm"
            >
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
          >
            {creating ? "Création…" : "Créer"}
          </button>
          {error && <p className="w-full text-sm text-clay">{error}</p>}
        </form>
      )}

      {error && !showForm && <p className="mb-4 text-sm text-clay">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate">
          Aucun groupe pour l'instant — {premium ? "crée le premier." : "les abonnés Premium peuvent en créer."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <div
              key={g.id}
              className="rounded-card border border-mist bg-white p-5"
            >
              <p className="font-display text-base text-ink">📚 {g.name}</p>
              {g.subject && <p className="text-xs text-slate">{g.subject}</p>}
              <p className="mt-1 text-xs text-slate">
                {g.memberCount} membre{g.memberCount > 1 ? "s" : ""}
              </p>
              <div className="mt-4 flex items-center gap-3">
                {!premium ? (
                  <span className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-slate">
                    <Crown size={13} /> Premium requis
                  </span>
                ) : g.isMember ? (
                  <Link
                    href={`/groups/${g.id}`}
                    className="flex items-center gap-1 rounded-card bg-ink px-3 py-1.5 text-xs text-paper hover:bg-ink/90"
                  >
                    <MessageCircle size={14} /> Ouvrir
                  </Link>
                ) : (
                  <button
                    onClick={() => handleJoin(g.id)}
                    disabled={joiningId === g.id}
                    className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink disabled:opacity-60"
                  >
                    {joiningId === g.id ? <Loader2 size={13} className="animate-spin" /> : null}
                    Rejoindre — inclus dans Premium
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
