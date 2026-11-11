"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { X, Crown } from "lucide-react";
import { isPremiumActive } from "@/lib/premium";

// Messages tournants — pour l'instant une "publicité maison" (promotion
// Premium), en attendant un vrai réseau publicitaire tiers (Google
// AdSense ou équivalent) — voir README pour comment le brancher.
const HOUSE_ADS = [
  {
    title: "Passe à Premium",
    body: "Sans publicité, et 100 questions/jour à l'assistant IA au lieu de 10.",
  },
  {
    title: "Encore des matières faibles ?",
    body: "Premium débloque plus d'examens et de Grands Quiz générés par jour.",
  },
];

/**
 * À placer uniquement sur les pages de contenu (dashboard, cours,
 * bibliothèque, groupes, opportunités, activités) — JAMAIS sur /exams,
 * /quizzes ou pendant un chronomètre, conformément au cahier des
 * charges. Ne s'affiche qu'aux comptes gratuits.
 */
export default function AdBanner() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [adIndex] = useState(() => Math.floor(Math.random() * HOUSE_ADS.length));

  useEffect(() => {
    async function check() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_status, subscription_expires_at")
        .eq("id", userData.user.id)
        .single();
      // Premium ACTIF (statut ET date d'expiration, même règle que la base) : jamais de bannière. Un Premium expiré
      // redevient un compte gratuit. Aucun réseau publicitaire tiers n'est chargé ici : rien n'est téléchargé pour un Premium.
      if (!profile) return; // profil illisible : on n'affiche rien plutôt que d'afficher une pub à un Premium
      setVisible(!isPremiumActive(profile.subscription_status, profile.subscription_expires_at));
    }
    check();
  }, []);

  if (!visible || dismissed) return null;
  const ad = HOUSE_ADS[adIndex];

  return (
    <div className="mb-6 flex items-center gap-3 rounded-card border border-gold/30 bg-gold/10 px-4 py-3">
      <Crown size={18} className="shrink-0 text-gold" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{ad.title}</p>
        <p className="text-xs text-slate">{ad.body}</p>
      </div>
      <Link
        href="/profile"
        className="shrink-0 rounded-card bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold/90"
      >
        Voir
      </Link>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Fermer"
        className="shrink-0 text-slate hover:text-ink"
      >
        <X size={15} />
      </button>
    </div>
  );
}
