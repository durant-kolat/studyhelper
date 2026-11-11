"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import {
  ShieldOff,
  Users,
  BookOpen,
  Briefcase,
  PartyPopper,
  Crown,
  MessageSquare,
  ShieldCheck,
  Megaphone,
} from "lucide-react";

type ProfileRow = {
  id: string;
  full_name: string;
  account_type: string;
  subscription_status: string;
  role: string;
  created_at: string;
};

type Stats = {
  users: number;
  premium: number;
  courses: number;
  pendingOpportunities: number;
  pendingActivities: number;
  groups: number;
};

const accountTypeLabels: Record<string, string> = {
  eleve_primaire: "Élève (primaire)",
  eleve_secondaire: "Élève (secondaire)",
  etudiant: "Étudiant",
  formation_pro: "Formation pro",
  enseignant: "Enseignant",
  entreprise: "Entreprise",
};

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(true);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: myProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    const isAdmin = myProfile?.role === "admin";
    setAllowed(isAdmin);
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    const { data: factors } = await supabase.auth.mfa.listFactors();
    setMfaEnabled((factors?.totp?.length ?? 0) > 0);

    const [
      { data: allProfiles },
      { count: coursesCount },
      { count: pendingOpp },
      { count: pendingAct },
      { count: groupsCount },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, account_type, subscription_status, role, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("courses").select("id", { count: "exact", head: true }),
      supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase.from("groups").select("id", { count: "exact", head: true }),
    ]);

    const profiles = allProfiles ?? [];
    setUsers(profiles);
    setStats({
      users: profiles.length,
      premium: profiles.filter((p) => p.subscription_status === "premium").length,
      courses: coursesCount ?? 0,
      pendingOpportunities: pendingOpp ?? 0,
      pendingActivities: pendingAct ?? 0,
      groups: groupsCount ?? 0,
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function changeRole(id: string, role: string) {
    setSavingId(id);
    const { error } = await supabase.rpc("admin_update_user", {
      p_target_id: id,
      p_role: role,
    });
    if (!error) {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    }
    setSavingId(null);
  }

  async function toggleSubscription(id: string, current: string) {
    setSavingId(id);
    const next = current === "premium" ? "free" : "premium";
    const { error } = await supabase.rpc("admin_update_user", {
      p_target_id: id,
      p_subscription_status: next,
    });
    if (!error) {
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, subscription_status: next } : u))
      );
    }
    setSavingId(null);
  }

  if (allowed === false) {
    return (
      <AppShell active="admin" title="Administration">
        <div className="flex flex-col items-center gap-2 rounded-card border border-mist bg-white p-10 text-center">
          <ShieldOff size={28} className="text-clay" />
          <p className="text-sm text-ink">
            Cette page est réservée aux administrateurs.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="admin" title="Administration">
      {loading || !stats ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : (
        <>
          {!mfaEnabled && (
            <Link
              href="/profile"
              className="mb-6 flex items-center gap-2 rounded-card border border-clay/40 bg-clay/5 px-4 py-3 text-sm text-clay hover:bg-clay/10"
            >
              <ShieldOff size={16} />
              Ton compte admin n'a pas la 2FA activée — active-la dans ton
              profil pour le protéger. →
            </Link>
          )}
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { icon: Users, label: "Utilisateurs", value: stats.users },
              { icon: Crown, label: "Premium", value: stats.premium },
              { icon: BookOpen, label: "Cours importés", value: stats.courses },
              { icon: Briefcase, label: "Opp. en attente", value: stats.pendingOpportunities },
              { icon: PartyPopper, label: "Activ. en attente", value: stats.pendingActivities },
              { icon: MessageSquare, label: "Groupes", value: stats.groups },
            ].map((s) => (
              <div key={s.label} className="rounded-card border border-mist bg-white p-4">
                <s.icon size={16} className="text-clay" />
                <p className="mt-2 font-display text-xl text-ink">{s.value}</p>
                <p className="text-xs text-slate">{s.label}</p>
              </div>
            ))}
          </div>

          {(stats.pendingOpportunities > 0 || stats.pendingActivities > 0) && (
            <Link
              href="/admin/moderation"
              className="mb-6 flex items-center gap-2 rounded-card border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-ink hover:bg-gold/20"
            >
              <ShieldCheck size={16} className="text-gold" />
              {stats.pendingOpportunities + stats.pendingActivities} élément(s)
              en attente de modération →
            </Link>
          )}

          <Link
            href="/admin/ads"
            className="mb-6 flex items-center gap-2 rounded-card border border-mist bg-white px-4 py-3 text-sm text-ink hover:border-ink"
          >
            <Megaphone size={16} className="text-clay" />
            Gérer les publicités →
          </Link>

          <p className="mb-3 font-display text-base text-ink">Utilisateurs</p>
          <div className="overflow-x-auto rounded-card border border-mist bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-mist text-xs text-slate">
                <tr>
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Abonnement</th>
                  <th className="px-4 py-3">Rôle</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-mist last:border-0">
                    <td className="px-4 py-3 text-ink">{u.full_name}</td>
                    <td className="px-4 py-3 text-slate">
                      {accountTypeLabels[u.account_type] ?? u.account_type}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleSubscription(u.id, u.subscription_status)}
                        disabled={savingId === u.id}
                        className={`rounded-full px-2.5 py-1 text-xs ${
                          u.subscription_status === "premium"
                            ? "bg-gold/20 text-ink"
                            : "bg-mist2 text-slate"
                        }`}
                      >
                        {u.subscription_status === "premium" ? "Premium" : "Gratuit"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u.id, e.target.value)}
                        disabled={savingId === u.id}
                        className="rounded-card border border-mist bg-white px-2 py-1 text-xs"
                      >
                        <option value="user">Utilisateur</option>
                        <option value="moderator">Modérateur</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
