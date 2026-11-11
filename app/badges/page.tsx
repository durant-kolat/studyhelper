"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { BADGES, levelFromXp, xpForNextLevel } from "@/lib/badges";
import { Lock } from "lucide-react";

export default function BadgesPage() {
  const [xp, setXp] = useState(0);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("xp")
        .eq("id", userData.user.id)
        .single();
      setXp(profile?.xp ?? 0);

      const { data: badges } = await supabase
        .from("user_badges")
        .select("badge_key")
        .eq("user_id", userData.user.id);
      setEarned(new Set((badges ?? []).map((b) => b.badge_key)));

      setLoading(false);
    }
    load();
  }, []);

  const { level, progress, needed } = xpForNextLevel(xp);

  return (
    <AppShell active="badges" title="Progression & Badges">
      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : (
        <>
          <div className="mb-6 rounded-card border border-mist bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="font-display text-2xl text-ink">Niveau {level}</p>
              <p className="text-sm text-slate">{xp} XP au total</p>
            </div>
            <div className="mt-3 h-2.5 w-full rounded-full bg-mist2">
              <div
                className="h-2.5 rounded-full bg-gold"
                style={{ width: `${(progress / needed) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate">
              {progress} / {needed} XP avant le niveau {level + 1}
            </p>
          </div>

          <p className="mb-3 font-display text-base text-ink">Badges</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.values(BADGES).map((badge) => {
              const has = earned.has(badge.key);
              return (
                <div
                  key={badge.key}
                  className={`rounded-card border p-5 ${
                    has
                      ? "border-gold/40 bg-gold/5"
                      : "border-mist bg-white opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{has ? badge.emoji : "🔒"}</span>
                    <p className="font-display text-base text-ink">
                      {badge.label}
                    </p>
                    {!has && <Lock size={13} className="ml-auto text-slate" />}
                  </div>
                  <p className="mt-2 text-sm text-slate">{badge.description}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}
