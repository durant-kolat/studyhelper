"use client";
// Côté navigateur : statut Premium (lu en base sous RLS), configuration publicitaire, consentement, chargement d'AdSense.
// Rien ici n'est un secret. Le statut Premium n'est JAMAIS lu depuis le stockage du navigateur : il vient de la
// base (colonnes protégées contre l'auto-attribution, cf. migration v1.1) avec le jeton de session de l'utilisateur.
import { supabase } from "@/lib/supabase";
import { isPremiumActive } from "@/lib/premium";
import {
  CONSENT_STORAGE_KEY, defaultConfig, parseConsent, sanitizeConfig, serializeConsent,
  type AdConfig, type ConsentState, type PremiumState,
} from "./config";

export type AdState = { premium: PremiumState; config: AdConfig; configSource: "db" | "default" };

const TTL_MS = 30_000;
let cache: { at: number; promise: Promise<AdState> } | null = null;

async function readPremium(): Promise<PremiumState> {
  try {
    const { data: u } = await supabase.auth.getUser();
    // Visiteur non connecté (page d'accueil publique) : compte « gratuit » par définition.
    if (!u.user) return "free";
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("subscription_status, subscription_expires_at")
      .eq("id", u.user.id)
      .single();
    // Profil illisible : inconnu → aucune publicité (plutôt que d'en montrer à un Premium).
    if (error || !profile) return "unknown";
    return isPremiumActive(profile.subscription_status, profile.subscription_expires_at) ? "premium" : "free";
  } catch {
    return "unknown";
  }
}

async function readConfig(): Promise<{ config: AdConfig; source: "db" | "default" }> {
  try {
    const { data, error } = await supabase.from("ad_settings").select("config").eq("id", "global").maybeSingle();
    // Table absente (migration v2.8 non passée), ligne absente ou erreur réseau : valeurs par défaut.
    if (error || !data) return { config: defaultConfig(), source: "default" };
    return { config: sanitizeConfig(data.config), source: "db" };
  } catch {
    return { config: defaultConfig(), source: "default" };
  }
}

/** État partagé par tous les emplacements d'une même page (une seule lecture toutes les 30 s). */
export function loadAdState(): Promise<AdState> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.promise;
  const promise = Promise.all([readPremium(), readConfig()]).then(([premium, c]) => ({
    premium, config: c.config, configSource: c.source,
  }));
  cache = { at: now, promise };
  return promise;
}
export function invalidateAdState() {
  cache = null;
}

// --- Consentement ---------------------------------------------------------

const CONSENT_EVENT = "sh-ads-consent-changed";

export function readConsent(): ConsentState {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return "unknown"; // stockage indisponible : on redemandera, et aucun script tiers n'est chargé sans choix
  }
}
export function writeConsent(v: "granted" | "denied") {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent(v));
  } catch {
    /* ignoré : le choix vaut pour cette page seulement */
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
export function resetConsent() {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    /* ignoré */
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
export function subscribeConsent(cb: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CONSENT_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// --- Chargement d'AdSense (une seule fois par page, jamais sans consentement) ----------------------

const SCRIPT_TIMEOUT_MS = 8000;
let scriptPromise: Promise<void> | null = null;

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** Charge le script AdSense UNE fois. Rejette en cas d'échec, de blocage (bloqueur de publicités) ou de délai dépassé. */
export function loadAdSense(clientId: string): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (err) {
        scriptPromise = null; // permet une nouvelle tentative plus tard
        reject(err);
      } else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error("délai dépassé")), SCRIPT_TIMEOUT_MS);
    try {
      const existing = document.querySelector<HTMLScriptElement>('script[data-sh-adsense="1"]');
      if (existing) {
        existing.addEventListener("load", () => finish());
        existing.addEventListener("error", () => finish(new Error("script bloqué")));
        if (window.adsbygoogle && (window.adsbygoogle as unknown as { loaded?: boolean }).loaded) finish();
        return;
      }
      const s = document.createElement("script");
      s.async = true;
      s.crossOrigin = "anonymous";
      s.dataset.shAdsense = "1";
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
      s.onload = () => finish();
      s.onerror = () => finish(new Error("script bloqué"));
      document.head.appendChild(s);
    } catch (e) {
      finish(e instanceof Error ? e : new Error("échec"));
    }
  });
  return scriptPromise;
}

/** Demande à AdSense de remplir un bloc <ins>. Une seule fois par élément (protège du double montage React). */
export function pushAd(ins: HTMLElement): boolean {
  if (ins.dataset.shPushed === "1") return false;
  try {
    ins.dataset.shPushed = "1";
    (window.adsbygoogle = window.adsbygoogle || []).push({});
    return true;
  } catch {
    return false;
  }
}
