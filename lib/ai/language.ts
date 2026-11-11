// Langue de sortie de l'IA : UNE seule source de vérité, preferredLanguage. SERVEUR UNIQUEMENT.
//
// Ordre de résolution :
//   1. le champ « language » du corps de la requête (langue actuellement sélectionnée dans l'application) ;
//   2. l'en-tête « x-app-language » (même valeur, envoyée sur TOUTES les requêtes) ;
//   3. profiles.preferred_language (choix enregistré dans le compte) ;
//   4. le français, uniquement si l'application n'a transmis AUCUNE langue et que le profil n'en a pas.
//
// JAMAIS utilisés : Accept-Language, navigator.language, locale du système ou du serveur, langue détectée
// dans la question. (Le test « tests/ai-language.test.ts » échoue si une telle logique réapparaît.)

import { DEFAULT_LANGUAGE, isLangCode, type LangCode } from "../i18n/languages";

export const LANGUAGE_HEADER = "x-app-language";

export async function resolveLanguage(req: Request, userId: string, bodyLanguage?: unknown): Promise<LangCode> {
  const fromBody = typeof bodyLanguage === "string" ? bodyLanguage.trim().toLowerCase() : "";
  if (isLangCode(fromBody)) return fromBody;
  const header = req.headers.get(LANGUAGE_HEADER)?.trim().toLowerCase();
  if (isLangCode(header)) return header;
  try {
    // Import différé : la base n'est touchée que si l'en-tête est absent.
    const { supabaseAdmin } = await import("../supabase-admin");
    const { data } = await supabaseAdmin.from("profiles").select("preferred_language").eq("id", userId).maybeSingle();
    const stored = (data as { preferred_language?: string | null } | null)?.preferred_language;
    if (isLangCode(stored)) return stored;
  } catch {
    /* profil illisible : repli ci-dessous */
  }
  console.warn("[lang] aucune langue transmise par l'application ni enregistrée dans le profil : repli sur le français.");
  return DEFAULT_LANGUAGE;
}
