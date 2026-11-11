import { LANGUAGES, type LangCode } from "../languages";
import type { Dictionary } from "./fr";
import { fr } from "./fr";
import { en } from "./en";
import { de } from "./de";
import { es } from "./es";
import { it } from "./it";
import { pt } from "./pt";
import { ar } from "./ar";
import { zh } from "./zh";
import { nl } from "./nl";
import { ru } from "./ru";
import { tr } from "./tr";
import { ja } from "./ja";
import { ko } from "./ko";
import { hi } from "./hi";

export type { Dictionary, DictKey } from "./fr";

const HANDWRITTEN = { fr, en, de, es, it, pt, ar, zh, nl, ru, tr, ja, ko, hi };

// Langues ajoutées : on part d'une copie de l'anglais ; la traduction automatique (lib/i18n/ui-translation.ts)
// la complète dans le navigateur dès qu'elle est disponible. Jamais de texte vide.
export const DICTIONARIES = { ...HANDWRITTEN } as Record<LangCode, Dictionary>;
for (const l of LANGUAGES) {
  if (!(l.code in DICTIONARIES)) DICTIONARIES[l.code] = { ...en };
}
