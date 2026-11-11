// Accès aux groupes d'étude — INCLUS dans l'abonnement Premium (V1.9).
//
// Il n'existe plus de paiement individuel pour rejoindre un groupe :
//   * utilisateur gratuit  → pas d'accès aux groupes ;
//   * Premium actif        → accès aux groupes, sans aucun paiement supplémentaire.
//
// La règle est appliquée CÔTÉ BASE (politiques RLS + fonction join_group, cf.
// supabase/migration-v1.9-*.sql) : ce fichier ne sert qu'à l'affichage du
// navigateur, qui ne peut jamais l'outrepasser.

export { isPremiumActive } from "./premium";

export const GROUPS_PREMIUM_MESSAGE =
  "Les groupes d'étude sont réservés aux abonnés Premium : l'accès est inclus dans ton abonnement, sans paiement supplémentaire.";
