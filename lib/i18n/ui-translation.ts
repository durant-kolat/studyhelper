// Traduction automatique de l'interface pour les langues ajoutées. NAVIGATEUR UNIQUEMENT.
// Les textes traduits sont gardés sur l'appareil : ils ne sont demandés qu'une fois par langue.
import { DICTIONARIES } from "./dictionaries";
import { hasHandwrittenUi, type LangCode } from "./languages";
import { uiPartCount, uiVersion } from "./ui-translation-shared";

const cacheKey = (lang: LangCode) => `sh_ui_${lang}_${uiVersion()}`;

export function applyUiTranslation(lang: LangCode, entries: Record<string, string>) {
  Object.assign(DICTIONARIES[lang], entries);
}

function readCache(lang: LangCode): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(lang));
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function writeCache(lang: LangCode, entries: Record<string, string>) {
  try {
    window.localStorage.setItem(cacheKey(lang), JSON.stringify(entries));
  } catch {
    /* stockage plein ou indisponible : la traduction sera simplement redemandée */
  }
}

/**
 * Prépare l'interface d'une langue ajoutée : cache de l'appareil d'abord, puis serveur morceau par morceau.
 * `onProgress` est appelé à chaque morceau reçu (l'interface se traduit au fur et à mesure).
 * Renvoie false si la traduction n'a pas pu être obtenue (l'interface reste en anglais, rien ne casse).
 */
export async function loadUiTranslation(lang: LangCode, isStale: () => boolean, onProgress: () => void): Promise<boolean> {
  if (hasHandwrittenUi(lang)) return true;
  const cached = readCache(lang);
  if (cached) {
    applyUiTranslation(lang, cached);
    onProgress();
    return true;
  }
  const all: Record<string, string> = {};
  const parts = uiPartCount();
  for (let part = 0; part < parts; part++) {
    if (isStale()) return false;
    try {
      const res = await fetch("/api/translate-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: lang, part }),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { entries?: Record<string, string> };
      if (!json.entries) return false;
      Object.assign(all, json.entries);
      applyUiTranslation(lang, json.entries);
      onProgress();
    } catch {
      return false;
    }
  }
  writeCache(lang, all);
  return true;
}
