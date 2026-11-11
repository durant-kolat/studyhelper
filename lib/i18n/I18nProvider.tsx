"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_LANGUAGE, isLangCode, languageInfo, normalizeLanguage, type LangCode } from "./languages";
import { translate } from "./translate";
import { loadUiTranslation } from "./ui-translation";
import { LANGUAGE_DIRTY_KEY, LANGUAGE_STORAGE_KEY } from "./client";
import type { DictKey } from "./dictionaries";

const STORAGE_KEY = LANGUAGE_STORAGE_KEY;

type I18nContextValue = {
  lang: LangCode;
  dir: "ltr" | "rtl";
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  /** Change la langue IMMÉDIATEMENT (toute l'interface), puis l'enregistre dans le profil. */
  setLang: (lang: LangCode) => Promise<{ saved: boolean }>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function applyToDocument(lang: LangCode) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = languageInfo(lang).dir;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(DEFAULT_LANGUAGE);
  // Compteur de choix de langue de l'utilisateur : une lecture du profil démarrée AVANT un choix est périmée
  // et ne doit jamais l'écraser (ex. profil = français lu pendant que l'utilisateur choisit English).
  const choiceVersion = useRef(0);
  // Change à chaque morceau d'interface traduit automatiquement : force l'affichage à se rafraîchir.
  const [uiRevision, setUiRevision] = useState(0);

  // 1) Démarrage : langue mémorisée sur cet appareil (affichage immédiat, avant même la connexion).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLangCode(stored)) {
        setLangState(stored);
        applyToDocument(stored);
      }
    } catch {
      /* stockage indisponible : on garde le français */
    }
  }, []);

  // 2) Connexion / chargement : le CHOIX DE L'UTILISATEUR fait foi.
  //    - Si un choix local n'a pas encore pu être enregistré (déconnecté, ou échec réseau/base), on
  //      l'enregistre dans le profil : l'application ne revient JAMAIS à une autre langue (ni au français).
  //    - Sinon, la langue du profil (preferredLanguage) est appliquée : elle est retrouvée à la reconnexion.
  useEffect(() => {
    let cancelled = false;
    async function syncWithProfile(userId: string) {
      const versionAtStart = choiceVersion.current;
      let local: string | null = null;
      let dirty = false;
      try {
        local = window.localStorage.getItem(STORAGE_KEY);
        dirty = window.localStorage.getItem(LANGUAGE_DIRTY_KEY) === "1";
      } catch {
        /* ignoré */
      }
      if (dirty && isLangCode(local)) {
        const { error } = await supabase.from("profiles").update({ preferred_language: local }).eq("id", userId);
        if (!error) {
          try {
            // Un choix plus récent pendant l'enregistrement garde son propre drapeau.
            if (window.localStorage.getItem(STORAGE_KEY) === local) window.localStorage.removeItem(LANGUAGE_DIRTY_KEY);
          } catch {
            /* ignoré */
          }
        }
        return; // la langue affichée est déjà celle choisie
      }
      const { data } = await supabase.from("profiles").select("preferred_language").eq("id", userId).maybeSingle();
      if (cancelled) return;
      // Lecture périmée : l'utilisateur a choisi une langue pendant l'attente, ou son choix n'est pas encore enregistré.
      if (choiceVersion.current !== versionAtStart) return;
      try {
        if (window.localStorage.getItem(LANGUAGE_DIRTY_KEY) === "1") return;
      } catch {
        /* ignoré */
      }
      const stored = (data as { preferred_language?: string | null } | null)?.preferred_language;
      if (isLangCode(stored)) {
        setLangState(stored);
        applyToDocument(stored);
        try {
          window.localStorage.setItem(STORAGE_KEY, stored);
        } catch {
          /* ignoré */
        }
      } else if (isLangCode(local)) {
        // Profil sans langue : on y enregistre le choix local.
        await supabase.from("profiles").update({ preferred_language: local }).eq("id", userId);
      }
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) void syncWithProfile(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) void syncWithProfile(session.user.id);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 3) Langues ajoutées : l'interface est traduite automatiquement (cache de l'appareil, sinon serveur) ; en attendant, anglais.
  useEffect(() => {
    let stale = false;
    void loadUiTranslation(lang, () => stale, () => setUiRevision((n) => n + 1));
    return () => {
      stale = true;
    };
  }, [lang]);

  const setLang = useCallback(async (next: LangCode) => {
    // État React + localStorage (lu par chaque requête API) mis à jour SYNCHRONEMENT : la requête IA
    // suivante part déjà avec la nouvelle langue, sans attendre l'enregistrement dans le profil.
    const myVersion = ++choiceVersion.current;
    setLangState(next);
    applyToDocument(next);
    const markDirty = (dirty: boolean) => {
      try {
        if (dirty) window.localStorage.setItem(LANGUAGE_DIRTY_KEY, "1");
        else window.localStorage.removeItem(LANGUAGE_DIRTY_KEY);
      } catch {
        /* ignoré */
      }
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignoré */
    }
    // « Non enregistré » dès maintenant : tant que le profil n'a pas confirmé, aucune lecture de l'ancienne valeur
    // (Supabase) ne peut ramener l'ancienne langue.
    markDirty(true);
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      return { saved: true }; // pas connecté : sera enregistrée dans le profil à la connexion
    }
    const { error } = await supabase.from("profiles").update({ preferred_language: next }).eq("id", userId);
    // Une langue choisie plus récemment a pu prendre la place : ne toucher au drapeau que pour CE choix.
    if (choiceVersion.current === myVersion) markDirty(!!error); // échec : on réessaiera au prochain chargement
    return { saved: !error };
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, dir: languageInfo(lang).dir, t: (key, vars) => translate(lang, key, vars), setLang }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, setLang, uiRevision]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Hors fournisseur (ne devrait pas arriver) : français, sans plantage.
    return { lang: DEFAULT_LANGUAGE, dir: "ltr", t: (k, v) => translate(DEFAULT_LANGUAGE, k, v), setLang: async () => ({ saved: false }) };
  }
  return ctx;
}
