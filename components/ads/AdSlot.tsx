"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  AD_FORMAT_BOX, decideAd, slotDef, type AdFormat, type AdSlotId,
} from "@/lib/ads/config";
import { placeholderAllowed, providerEnv } from "@/lib/ads/provider-env";
import {
  loadAdSense, loadAdState, pushAd, readConsent, resetConsent, subscribeConsent, writeConsent, type AdState,
} from "@/lib/ads/client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { adText } from "@/lib/i18n/ads-strings";
import HouseAd from "./HouseAd";

const FILL_TIMEOUT_MS = 8000;

/**
 * Emplacement publicitaire. À placer uniquement dans le flux d'une page de contenu (jamais en position fixe,
 * jamais sur examens / quiz / pratique / assistant / carrière / planning / paiement — la page doit figurer dans
 * AD_PAGES, sinon rien ne s'affiche). Ne bloque jamais l'application : chaque échec = l'emplacement disparaît.
 *
 *  - compte Premium ou statut inconnu → rien, aucun script chargé ;
 *  - réseau tiers (AdSense) seulement avec identifiants valides, configuration lue en base ET consentement ;
 *  - sinon promotion maison (si activée), emplacement de remplacement (développement), ou rien.
 */
export default function AdSlot({ slot, blocked = false }: { slot: AdSlotId; blocked?: boolean }) {
  const pathname = usePathname() ?? "";
  const { lang } = useI18n();
  const [state, setState] = useState<AdState | null>(null);
  const consent = useSyncExternalStore(subscribeConsent, readConsent, () => "unknown" as const);

  useEffect(() => {
    let alive = true;
    loadAdState().then((s) => alive && setState(s)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const decision = useMemo(() => {
    if (!state) return null;
    return decideAd({
      slotId: slot, pathname, premium: state.premium, configSource: state.configSource, config: state.config,
      consent, provider: providerEnv, placeholderAllowed, blocked,
    });
  }, [state, slot, pathname, consent, blocked]);

  if (!decision || decision.kind === "none") return null;

  if (decision.kind === "house") return <HouseAd />;

  if (decision.kind === "placeholder") {
    return (
      <aside aria-label={adText(lang, "label")} data-ad-slot={slot} className="mb-6 rounded-card border border-dashed border-slate/40 px-4 py-3 text-center text-xs text-slate">
        {adText(lang, "placeholder")} — {slotDef(slot)?.label}
      </aside>
    );
  }

  if (decision.kind === "consent") {
    return (
      <aside aria-label={adText(lang, "label")} data-ad-slot={slot} className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-dashed border-mist bg-white/60 px-4 py-3">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate/70">{adText(lang, "label")}</span>
        <p className="min-w-0 flex-1 text-xs text-slate">{adText(lang, "consentText")}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => writeConsent("denied")} className="rounded-card border border-mist px-3 py-1 text-xs text-ink hover:bg-mist2">
            {adText(lang, "refuse")}
          </button>
          <button type="button" onClick={() => writeConsent("granted")} className="rounded-card bg-ink px-3 py-1 text-xs text-paper hover:bg-ink/90">
            {adText(lang, "accept")}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <NetworkAd
      key={`${slot}:${decision.unit}`}
      slot={slot}
      client={decision.client}
      unit={decision.unit}
      format={decision.format}
      label={adText(lang, "label")}
      choicesLabel={adText(lang, "choices")}
      loadingLabel={adText(lang, "loading")}
    />
  );
}

function adAttributes(format: AdFormat): Record<string, string> {
  switch (format) {
    case "auto": return { "data-ad-format": "auto", "data-full-width-responsive": "true" };
    case "horizontal": return { "data-ad-format": "horizontal", "data-full-width-responsive": "true" };
    case "rectangle": return { "data-ad-format": "rectangle", "data-full-width-responsive": "true" };
    case "fluid": return { "data-ad-format": "fluid", "data-ad-layout": "in-article" };
  }
}

function NetworkAd({
  slot, client, unit, format, label, choicesLabel, loadingLabel,
}: {
  slot: AdSlotId; client: string; unit: string; format: AdFormat; label: string; choicesLabel: string; loadingLabel: string;
}) {
  const insRef = useRef<HTMLModElement | null>(null);
  const [status, setStatus] = useState<"loading" | "filled" | "failed">("loading");
  const box = AD_FORMAT_BOX[format];

  useEffect(() => {
    let cancelled = false;
    let obs: MutationObserver | undefined;
    let timer: number | undefined;

    loadAdSense(client)
      .then(() => {
        const ins = insRef.current;
        if (cancelled || !ins) return;
        const read = () => {
          const st = ins.getAttribute("data-ad-status");
          if (st === "filled") setStatus("filled");
          else if (st === "unfilled") setStatus("failed");
        };
        obs = new MutationObserver(read);
        obs.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
        pushAd(ins);
        read();
        // Aucune réponse du fournisseur : l'emplacement se referme, la page ne reste pas « réservée » pour rien.
        timer = window.setTimeout(() => { if (!cancelled) setStatus((s) => (s === "filled" ? s : "failed")); }, FILL_TIMEOUT_MS);
      })
      .catch(() => { if (!cancelled) setStatus("failed"); }); // bloqueur de publicités, réseau coupé, délai dépassé

    return () => {
      cancelled = true;
      obs?.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [client]);

  if (status === "failed") return null;

  return (
    <aside
      aria-label={label}
      data-ad-slot={slot}
      className="mb-6 overflow-hidden rounded-card border border-dashed border-mist bg-white/60 px-3 pb-2 pt-1"
      style={{ minHeight: box.min + 28, maxHeight: box.max + 56 }}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate/70">{label}</span>
        <button type="button" onClick={resetConsent} className="text-[10px] text-slate/70 underline hover:text-ink">
          {choicesLabel}
        </button>
      </div>
      {status === "loading" && <p className="text-center text-[11px] text-slate/60" aria-live="polite">{loadingLabel}</p>}
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block", minHeight: box.min, maxHeight: box.max, overflow: "hidden" }}
        data-ad-client={client}
        data-ad-slot={unit}
        {...adAttributes(format)}
      />
    </aside>
  );
}
