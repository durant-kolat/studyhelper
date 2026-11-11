"use client";

import { useState } from "react";
import Link from "next/link";
import { X, Crown } from "lucide-react";
import { FREE_LIMITS, PREMIUM_LIMITS } from "@/lib/quota-limits";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { adText } from "@/lib/i18n/ads-strings";

/**
 * Promotion Study Helper (Premium) : contenu maison, PAS une publicité tierce. Affichée seulement aux comptes
 * gratuits, étiquetée comme telle. Les chiffres viennent de lib/quota-limits.ts (source unique), jamais écrits en dur.
 * (Ancien AdBanner.tsx : annonçait « 10 questions » gratuites alors que la limite réelle est de 5.)
 */
export default function HouseAd() {
  const { lang } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const [idx] = useState(() => Math.floor(Math.random() * 2));
  if (dismissed) return null;
  const vars = { premium: PREMIUM_LIMITS.assistant, free: FREE_LIMITS.assistant };
  const title = adText(lang, idx === 0 ? "houseTitle1" : "houseTitle2");
  const body = adText(lang, idx === 0 ? "houseBody1" : "houseBody2", vars);

  return (
    <aside aria-label={adText(lang, "houseLabel")} className="mb-6 rounded-card border border-gold/30 bg-gold/10 px-4 py-3">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate/70">{adText(lang, "houseLabel")}</p>
      <div className="flex items-center gap-3">
        <Crown size={18} className="shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="text-xs text-slate">{body}</p>
        </div>
        <Link href="/profile" className="shrink-0 rounded-card bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold/90">
          {adText(lang, "see")}
        </Link>
        <button onClick={() => setDismissed(true)} aria-label={adText(lang, "close")} className="shrink-0 text-slate hover:text-ink">
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}
