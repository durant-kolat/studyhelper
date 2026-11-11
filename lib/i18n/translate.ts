// Fonction de traduction PURE (serveur + navigateur). Une clé absente retombe sur le français,
// puis sur la clé elle-même : jamais de texte vide ni d'erreur à l'écran.
import { DICTIONARIES, type DictKey } from "./dictionaries";
import { DEFAULT_LANGUAGE, type LangCode } from "./languages";

export function translate(lang: LangCode, key: DictKey, vars?: Record<string, string | number>): string {
  const raw = DICTIONARIES[lang]?.[key] ?? DICTIONARIES[DEFAULT_LANGUAGE][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Traduit un code d'erreur de paiement renvoyé par le serveur (« phone_invalid »…), ou null s'il est inconnu. */
export function paymentErrorMessage(lang: LangCode, code: string | null | undefined): string | null {
  if (!code) return null;
  const key = `pay.err.${code}` as DictKey;
  return DICTIONARIES[DEFAULT_LANGUAGE][key] ? translate(lang, key) : null;
}
