"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getGreetingName } from "@/lib/conversations";
import { dueCelebrations, localDateParts, type CelebrationPrefs, type DueCelebration } from "@/lib/celebrations";

const storageKey = (key: string, year: number) => `sh-celebration-${key}-${year}`;
const safeGet = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};

/** Message de célébration dans l'application (jour J, fuseau de l'élève) : complète la notification push, ne s'affiche que si l'élève l'a activé. */
export default function CelebrationBanner() {
  const [items, setItems] = useState<(DueCelebration & { year: number })[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const { data: prefs } = await supabase.from("celebration_prefs").select("*").eq("owner_id", uid).maybeSingle();
      if (!prefs?.celebrations_enabled) return;
      const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", uid).maybeSingle();
      const parts = localDateParts(new Date(), profile?.timezone as string | undefined);
      const name = await getGreetingName().catch(() => null);
      const due = dueCelebrations(prefs as CelebrationPrefs, name ?? "", parts)
        .filter((c) => !safeGet(storageKey(c.key, parts.year)))
        .map((c) => ({ ...c, year: parts.year }));
      if (alive) setItems(due);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  function dismiss(c: DueCelebration & { year: number }) {
    try {
      window.localStorage.setItem(storageKey(c.key, c.year), "1");
    } catch {
      /* stockage indisponible : le bandeau réapparaîtra, sans gravité */
    }
    setItems((l) => l.filter((x) => x.key !== c.key));
  }

  if (items.length === 0) return null;
  return (
    <div className="mb-4 space-y-2" role="status">
      {items.map((c) => (
        <div key={c.key} className="flex items-start gap-3 rounded-card border border-gold/40 bg-gold/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-base text-ink">{c.title}</p>
            <p className="mt-0.5 text-sm text-ink">{c.body}</p>
          </div>
          <button type="button" onClick={() => dismiss(c)} aria-label="Fermer ce message" className="text-slate hover:text-ink">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
