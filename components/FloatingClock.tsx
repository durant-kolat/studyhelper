"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { readClock, resolveTimezone } from "@/lib/tz";
import {
  TIMEZONE_CHANGED_EVENT,
  announceToolOpen,
  onOtherToolOpen,
} from "@/lib/floating-tools";

// Horloge flottante — INDÉPENDANTE de la calculatrice (composant, état et
// position propres, en position: fixed). Elle affiche l'heure exacte,
// secondes comprises, et la date complète dans le fuseau enregistré dans le
// profil (repli : fuseau du navigateur). La pastille reste visible en
// permanence ; le panneau donne la date complète et le fuseau utilisé.

export default function FloatingClock() {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [timezone, setTimezone] = useState<string>(() => resolveTimezone(null));
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Tic-tac : on relit l'heure système à chaque seconde (pas de compteur
  // incrémenté à la main, donc aucune dérive).
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    const onVisible = () => {
      if (!document.hidden) setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Fuseau enregistré dans le profil de l'utilisateur.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return;
      const { data } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) setTimezone(resolveTimezone(data?.timezone));
    })();

    // La page Paramètres prévient quand le fuseau change.
    const onChange = (event: Event) => {
      setTimezone(resolveTimezone((event as CustomEvent<string>).detail));
    };
    window.addEventListener(TIMEZONE_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(TIMEZONE_CHANGED_EVENT, onChange);
    };
  }, []);

  // Ne se chevauche jamais avec la calculatrice ; Échap referme.
  useEffect(() => onOtherToolOpen("clock", () => setOpen(false)), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    setOpen((wasOpen) => {
      if (!wasOpen) announceToolOpen("clock");
      return !wasOpen;
    });
  }

  const reading = now ? readClock(now, timezone) : null;

  return (
    <>
      {/* Pastille : à gauche du bouton calculatrice, toujours visible */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="floating-clock-panel"
        aria-label={open ? "Fermer l'horloge" : "Ouvrir l'horloge"}
        className="fixed z-50 flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-paper shadow-lg hover:bg-ink/90"
        style={{
          right: "4.5rem",
          bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <Clock size={16} className="shrink-0 text-gold" aria-hidden="true" />
        <span
          className="min-w-[4.25rem] text-sm font-medium tabular-nums"
          aria-hidden="true"
        >
          {reading ? reading.shortTime : "--:--"}
        </span>
      </button>

      {open && (
        <div
          id="floating-clock-panel"
          role="dialog"
          aria-label="Horloge"
          className="floating-panel fixed z-50 overflow-y-auto rounded-card border border-mist bg-white p-5 shadow-xl"
          style={{
            right: "1rem",
            bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))",
            width: "min(19rem, calc(100vw - 2rem))",
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-slate">
              Heure locale
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer l'horloge"
              className="rounded-full p-1.5 text-slate hover:bg-mist2"
            >
              <X size={16} />
            </button>
          </div>

          <div className="rounded-card bg-ink px-4 py-5 text-center">
            <time
              dateTime={now ? now.toISOString() : undefined}
              aria-live="off"
              className="block font-display text-4xl tabular-nums text-paper"
            >
              {reading ? reading.time : "--:--:--"}
            </time>
          </div>

          <p className="mt-3 text-center font-display text-base text-ink">
            {reading ? reading.date : "…"}
          </p>
          <p className="mt-1 text-center text-xs text-slate">
            Fuseau : {timezone.replace(/_/g, " ")}
          </p>
          <p className="mt-3 border-t border-mist pt-3 text-center text-xs text-slate/80">
            Ce n'est pas le bon fuseau ?{" "}
            <Link href="/profile" className="underline hover:text-ink">
              Modifier dans Paramètres
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
