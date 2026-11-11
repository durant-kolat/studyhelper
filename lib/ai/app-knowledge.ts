// Base de connaissances INTERNE de Study Helper : ce que l'application fait réellement.
// Injectée dans l'instruction système quand l'utilisateur pose une question sur l'application
// (« Comment changer la langue ? », « Comment payer Premium ? »…). SERVEUR UNIQUEMENT.
//
// RÈGLE : ne décrire QUE des fonctions qui existent dans le code. À mettre à jour quand une
// fonction est ajoutée, retirée ou modifiée (prix : lib/premium.ts ; quotas : lib/quota-limits.ts ;
// moyens de paiement : lib/payment-methods.ts ; langues : lib/i18n/languages.ts).

import { FREE_LIMITS, PREMIUM_LIMITS } from "../quota-limits";
import { PREMIUM_PRICES, DEFAULT_PLAN_DAYS } from "../premium";
import { LANGUAGES, type LangCode } from "../i18n/languages";
import { detectDomain } from "./router";

/** Vrai si le message porte sur l'application elle-même (et non sur une matière scolaire). */
export function shouldInjectAppKnowledge(message: string): boolean {
  return detectDomain({ mode: "chat", message }) === "app_help";
}

export function appKnowledgeBlock(_lang?: LangCode): string {
  const std = PREMIUM_PRICES.etudiant;
  const langs = LANGUAGES.map((l) => l.label).join(", ");
  return `CONNAISSANCES SUR L'APPLICATION STUDY HELPER (source officielle — à utiliser pour répondre aux questions sur l'application) :

RÈGLES : réponds uniquement à partir de ces informations. Si une fonction n'est pas listée ici, dis que tu n'as pas cette information ou que la fonction n'existe pas à ta connaissance — N'INVENTE JAMAIS une fonction, un bouton, un prix ou un moyen de paiement. Réponds dans la langue de l'utilisateur et décris les chemins avec les noms de menus de cette langue.

NAVIGATION (menu latéral sur ordinateur ; bouton menu ☰ en haut à gauche sur téléphone) : Accueil, Mes cours, Examens, Quiz, Planning, Progression, Groupes, Opportunités, Activités, Assistant, Espace Carrière, Marketplace, Progression & Badges, Bibliothèque, Outils. « Paramètres » (en bas du menu) ouvre le profil. L'administration et la modération n'apparaissent que pour les comptes autorisés.

COMPTE ET PROFIL (menu Paramètres / photo en haut à droite) : photo de profil, sécurité (double authentification 2FA par application d'authentification), notifications de rappel, fuseau horaire (rappels de révision et d'examen), langue de l'application, abonnement Premium. Connexion par e-mail et mot de passe ; « Mot de passe oublié ? » envoie un lien de réinitialisation.

LANGUE : Paramètres → « Langue de l'application ». Langues disponibles : ${langs}. Le choix change toute l'interface immédiatement, est enregistré dans le compte (retrouvé à la reconnexion) et sert aussi à l'assistant IA, à la lecture audio et aux textes des schémas. On peut aussi la changer depuis la page de connexion.

MES COURS : on importe un document (PDF, image, texte, Word .docx, PowerPoint .pptx) ; l'IA l'analyse (résumé, notions clés, questions). Limite quotidienne d'analyses : ${FREE_LIMITS.analyze}/jour en gratuit, ${PREMIUM_LIMITS.analyze}/jour en Premium.

BIBLIOTHÈQUE : montre les documents importés dans leur format d'origine (jamais un résumé IA). Toucher un document l'ouvre en PLEIN ÉCRAN : PDF (zoom, page précédente/suivante, numéro de page), images (zoom et déplacement), texte original pour les documents texte/Word/PowerPoint. Bouton ✕ (ou Échap) pour revenir ; bouton « Ouvrir dans un nouvel onglet » pour le fichier brut. Les fichiers sont personnels : chaque utilisateur ne voit que les siens.

ASSISTANT (Study Helper AI) : discussion libre sur les cours et matières, avec des actions guidées : poser une question, donner un exercice, une série d'exercices, un quiz, ou expliquer un cours en entier. Il adapte la difficulté d'après les résultats. Limite quotidienne : ${FREE_LIMITS.assistant} questions/jour en gratuit, ${PREMIUM_LIMITS.assistant}/jour en Premium. Micro pour dicter (navigateurs compatibles) et lecture audio de chaque réponse.

PRATIQUE : questions, exercices, séries, quiz, correction de ta réponse, entraînement et mises en situation sont traités par le moteur IA dédié à la pratique ; les explications et les autres fonctions par l'autre moteur IA. Le choix est automatique.

EXPLICATIONS VISUELLES : pour un phénomène difficile à comprendre avec du texte (physique, biologie, chimie, mathématiques, astronomie, géographie…), demande « Montre-moi… », « Fais un schéma… » ou « Explique avec une image… » : l'assistant crée un schéma annoté (flèches, numéros, légendes) dans ta langue.

LECTURE AUDIO : sous chaque réponse de l'assistant : Écouter, Pause, Reprendre, Arrêter. La voix suit la langue choisie (selon les voix disponibles sur l'appareil).

EXAMENS ET QUIZ : examens générés par l'IA (${FREE_LIMITS["generate-exam"]}/jour en gratuit, ${PREMIUM_LIMITS["generate-exam"]} en Premium) avec minuterie ; quiz générés (${FREE_LIMITS["generate-quiz"]}/jour en gratuit, ${PREMIUM_LIMITS["generate-quiz"]} en Premium) ; résultats et progression par matière ; badges, XP et niveaux.

PLANNING : planning d'étude et rappels (notifications) selon le fuseau horaire du profil.

ESPACE CARRIÈRE : CV (aperçu, export PDF et Word), lettre de motivation, simulation d'entretien, portfolio, orientation.

OUTILS : calculatrice flottante (calcul, équations, analyse, statistiques) et horloge flottante.

GROUPES D'ÉTUDE : inclus dans Premium (aucun paiement séparé) ; sans Premium actif, la liste est visible mais sans accès.

MARKETPLACE : réservation de cours de répétition auprès d'enseignants, avec paiement.

PREMIUM : paliers selon le profil. Élève, étudiant, formation professionnelle : ${std?.mensuel} FCFA (${DEFAULT_PLAN_DAYS.mensuel} jours), ${std?.trimestriel} FCFA (${DEFAULT_PLAN_DAYS.trimestriel} jours), ${std?.annuel} FCFA (${DEFAULT_PLAN_DAYS.annuel} jours). Enseignant : ${PREMIUM_PRICES.enseignant.mensuel} FCFA/mois. Entreprise : sur devis. Premium augmente les limites quotidiennes de l'IA et inclut les groupes. Où payer : Paramètres → bouton « S'abonner à Premium » ou « Renouveler ». Renouveler avant l'expiration prolonge la durée restante. Rappels avant expiration. Le renouvellement est MANUEL (pas de prélèvement automatique).

MOYENS DE PAIEMENT : MTN Mobile Money (numéro de mobile du pays choisi ; une demande de paiement arrive sur ton téléphone, tu la confirmes toi-même avec ton code chez l'opérateur), Orange Money (tu es redirigé vers la page officielle Orange Money) et carte Visa / Mastercard ou PayPal (tu es redirigé vers la page sécurisée de PayPal). Selon ton pays et la configuration, certains moyens peuvent ne pas être encore disponibles : seuls ceux affichés dans la fiche de paiement le sont. Premium n'est activé qu'après confirmation réelle du paiement par nos serveurs : revenir sur la page de succès ne suffit pas. Study Helper ne demande jamais ton code secret (PIN) et n'enregistre aucune donnée de carte. Statuts possibles : en cours de vérification, confirmé, échoué, annulé, expiré. Si un paiement reste « en cours de vérification », attendre quelques minutes ; si tu as confirmé chez l'opérateur, il sera activé automatiquement après vérification.

LIMITES : l'IA peut se tromper (vérifie les résultats importants) ; les quotas quotidiens dépendent du compte gratuit ou Premium ; la lecture audio dépend des voix installées sur l'appareil ; l'assistant ne répond qu'aux sujets liés aux études et à l'apprentissage.`;
}
