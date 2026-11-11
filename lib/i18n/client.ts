// Langue choisie, lisible hors React (fonctions d'appel API). NAVIGATEUR UNIQUEMENT.
// I18nProvider écrit la clé de façon synchrone à chaque changement de langue : c'est donc toujours
// le choix le plus récent de l'utilisateur, même avant la fin de l'enregistrement dans son profil.
import { isLangCode, type LangCode } from "./languages";

export const LANGUAGE_STORAGE_KEY = "sh_lang";
/** « 1 » = un choix de langue local pas encore enregistré dans le profil. */
export const LANGUAGE_DIRTY_KEY = "sh_lang_dirty";
export const LANGUAGE_HEADER = "x-app-language";

export function getStoredLanguage(): LangCode | null {
  try {
    const v = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLangCode(v) ? v : null;
  } catch {
    return null;
  }
}

/** En-tête à joindre à chaque requête vers l'API : la langue cible de l'IA (preferredLanguage). */
export function languageHeader(): Record<string, string> {
  const lang = getStoredLanguage();
  return lang ? { [LANGUAGE_HEADER]: lang } : {};
}
