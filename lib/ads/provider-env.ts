// Lecture des variables d'environnement publicitaires. Next.js n'injecte NEXT_PUBLIC_* dans le navigateur
// que pour des accès LITTÉRAUX (process.env.NEXT_PUBLIC_X) : pas de lecture dynamique ici.
// Ces valeurs ne sont pas des secrets (identifiant d'éditeur et de blocs, visibles dans le code de toute page avec pub).
import type { ProviderEnv } from "./config";

export const providerEnv: ProviderEnv = {
  client: process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
  units: {
    home_banner: process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME_BANNER,
    dashboard_inline: process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD_INLINE,
    courses_between: process.env.NEXT_PUBLIC_ADSENSE_SLOT_COURSES_BETWEEN,
    library_between: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIBRARY_BETWEEN,
    marketplace_inline: process.env.NEXT_PUBLIC_ADSENSE_SLOT_MARKETPLACE_INLINE,
    groups_inline: process.env.NEXT_PUBLIC_ADSENSE_SLOT_GROUPS_INLINE,
    opportunities_inline: process.env.NEXT_PUBLIC_ADSENSE_SLOT_OPPORTUNITIES_INLINE,
    activities_inline: process.env.NEXT_PUBLIC_ADSENSE_SLOT_ACTIVITIES_INLINE,
  },
};

/** Aperçu « emplacement de remplacement » : développement, ou activé explicitement. Jamais par défaut en production. */
export const placeholderAllowed: boolean =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ADS_PLACEHOLDER === "true";
