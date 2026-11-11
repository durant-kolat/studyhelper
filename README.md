# Study Helper — V1 Web

Socle web (Next.js 14 + TypeScript + Tailwind) pour la V1 responsive de
Study Helper : accueil, connexion/inscription, dashboard, cours, examen,
résultat/correction, quiz, planning, progression, groupes, assistant,
bibliothèque, profil, calculatrice flottante.

Les données affichées sont pour l'instant statiques (voir `lib/api.ts`) :
c'est le squelette d'interface décrit dans le planning, prêt à être
branché à Supabase et à l'IA.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvrir http://localhost:3000

## Structure

```
app/            → une route par page (App Router)
components/     → Sidebar, Header, FloatingCalculator, CourseCard,
                  ExamTimer, ProgressCard, Notification, AppShell
lib/            → supabase.ts (client Supabase), api.ts (appels
                  backend/IA — actuellement simulés), utils.ts
```

## Authentification (Supabase) — déjà branchée

1. Crée un projet sur https://supabase.com.
2. Dans l'éditeur SQL du projet, exécute le contenu de `supabase/schema.sql`
   (table `profiles` avec le type de compte, `courses`, `exam_results`,
   création automatique du profil à l'inscription, sécurité RLS).
3. Copie `.env.local.example` vers `.env.local` et renseigne
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Project Settings > API dans Supabase).
4. `npm install && npm run dev` — l'inscription (`/register`) et la
   connexion (`/login`) utilisent déjà `supabase.auth`. Toutes les pages
   du dashboard vérifient la session et redirigent vers `/login` si
   l'utilisateur n'est pas connecté (voir `components/AppShell.tsx`).
   Le bouton de déconnexion est dans le Header.
5. **Récupération de mot de passe** — `/forgot-password` (demande de
   lien, message volontairement identique que l'e-mail existe ou non)
   et `/reset-password` (choix du nouveau mot de passe, arrivée via le
   lien reçu). ⚠️ Pour que ça marche, ajoute
   `${NEXT_PUBLIC_APP_URL}/reset-password` dans Supabase →
   Authentication → URL Configuration → **Redirect URLs** — sans ça,
   Supabase refuse la redirection après le lien envoyé par e-mail.
6. `/login` a aussi un anti-brute-force basique côté client (blocage
   temporaire après 5 échecs) et des messages d'erreur volontairement
   neutres ("email ou mot de passe incorrect" plutôt que de préciser
   lequel) — mieux que rien, mais un vrai anti-brute-force devrait
   aussi limiter côté serveur/IP (Supabase applique déjà ses propres
   limites par défaut sur les tentatives de connexion).

## Fournisseur IA : Google Gemini (changé depuis Anthropic)

Les 4 routes IA (`analyze`, `generate-exam`, `generate-quiz`, `assistant`)
appellent l'API Gemini via `lib/gemini.ts`, pas Anthropic — changement fait
pour utiliser le tier gratuit de Google AI Studio pendant la phase de
test. Clé à récupérer sur aistudio.google.com → "Get API key" (pas de
carte bancaire requise pour le tier gratuit, mais quotas limités).

## Analyse IA des documents — déjà branchée

1. Exécute les colonnes ajoutées à `courses` dans `supabase/schema.sql`
   (`key_points`, `questions`, `analyzed_at`) si ta base existe déjà.
2. Renseigne `SUPABASE_SERVICE_ROLE_KEY` (Project Settings > API, clé
   `service_role` — jamais exposée au client) et `GEMINI_API_KEY`
   dans `.env.local`.
3. Chaque document importé (PDF, image/photo via OCR, Word `.docx`,
   PowerPoint `.pptx`, ou texte brut) est automatiquement envoyé à
   `app/api/analyze/route.ts`, qui extrait le texte, appelle l'API IA,
   et enregistre résumé / notions clés / questions dans la table
   `courses`. La carte du document affiche ensuite "Voir l'analyse".
4. **OCR gratuit** (Tesseract.js, français + anglais) pour les photos de
   notes — aucune clé API supplémentaire requise, tourne dans la route
   serveur. Peut être lent (quelques secondes) sur de grandes images, et
   la qualité dépend de la netteté de la photo.
5. **Word/PowerPoint modernes** (`.docx` via `mammoth`, `.pptx` via
   extraction directe du XML des diapositives avec `jszip`) — gratuit,
   aucune dépendance externe payante. Les **anciens formats binaires**
   `.doc` / `.ppt` (pré-2007) ne sont **pas** pris en charge — le message
   d'erreur le précise à l'utilisateur.

## Examens générés par l'IA — déjà branchés

1. Exécute les colonnes ajoutées à `exam_results` dans
   `supabase/schema.sql` (`questions`, `answers`) si ta base existe déjà.
2. Sur `/exams`, l'utilisateur choisit une matière puis
   `app/api/generate-exam/route.ts` génère 8 questions à choix multiple
   à partir des notions clés déjà extraites de ses cours (ou un examen
   générique si aucun cours n'est encore analysé dans cette matière).
3. À la fin de l'examen, le score est calculé côté client, enregistré
   dans `exam_results` avec le détail question par question, puis
   `/results?id=...` affiche la vraie correction (réponse donnée, bonne
   réponse, méthode expliquée par l'IA) au lieu de données statiques.
4. Le minuteur (`ExamTimer`, prop `onExpire`) soumet automatiquement
   l'examen dès qu'il atteint 00:00 — impossible de dépasser les 30
   minutes prévues.

## Grand Quiz hebdomadaire — déjà branché

`app/api/generate-quiz/route.ts` génère 12 questions réparties sur toutes
les matières de l'utilisateur, en s'appuyant sur les notions clés de ses
cours, ses matières faibles (score moyen < 70 %) et ses anciennes erreurs
(questions ratées dans `exam_results`). À la fin du quiz, un résultat est
enregistré par matière dans `exam_results` (donc pris en compte dans la
progression), et la page affiche le score global, le score par matière et
des recommandations. Même auto-soumission à 00:00 que pour l'examen.

## Assistant IA — Study Helper AI (V1.3)

`/assistant` ouvre sur un écran d'actions (poser une question, commencer une
question, obtenir un exercice / série / quiz, réviser un cours, analyser un
document → `/mes cours`), puis passe en chat.

- **Cerveau pédagogique** : `lib/assistant-prompt.ts` (identité, domaine,
  correction, intégrité académique, sécurité, anti-détournement). Les cours
  de l'utilisateur sont injectés comme DONNÉES, jamais comme instructions ;
  le texte libre (matière, chapitre) est nettoyé avant d'entrer dans une
  consigne.
- **Modes** : `chat`, `question`, `exercise`, `series`, `quiz`, `revise`. Pour
  les modes guidés, la consigne est construite côté serveur à partir de
  champs validés (`lib/validate.ts`), pas recopiée depuis le navigateur.
- **Difficulté adaptative** (`lib/adaptive.ts`) : 2 réussites de suite → un
  cran au-dessus ; 1 échec → un cran en dessous + réexplication. L'IA termine
  une correction par un marqueur `[[RESULT:…]]` que le serveur retire avant
  l'affichage. « Type examen » est fixe.
- **Quota fiable** (`lib/rate-limit.ts` + migration V1.3) :
  - décidé côté serveur, par JOUR LOCAL (fuseau du profil), verrou SQL
    contre les doubles clics ;
  - trois états distincts : `ok`, `quota` (limite réellement atteinte →
    seul cas où Premium est proposé) et `error` (panne du compteur → 503
    neutre, jamais « limite atteinte ») ;
  - toute panne après comptage (API IA, réponse vide, réseau, erreur
    serveur) REMBOURSE la question (`release_usage`) ;
  - `GET /api/assistant` lit « 8/10 » sans rien consommer.
- **Si l'assistant répond « compteur momentanément indisponible »** : la
  migration V1.3 n'est probablement pas appliquée (fonction SQL absente) —
  voir le journal serveur (`[quota] …`).

## Outils flottants — calculatrice et horloge

`components/FloatingCalculator.tsx` (+ `components/calculator/`) et
`components/FloatingClock.tsx` sont deux outils indépendants, en
`position: fixed`, qui se ferment mutuellement (`lib/floating-tools.ts`) et
respectent la zone sûre des téléphones.

- **Calculatrice** : parseur sécurisé dans `lib/calc/engine.ts` — AUCUN
  `eval`, `Function` ni équivalent (un symbole inconnu est une erreur).
  DEG/RAD/GRAD, réels et complexes (mode ℂ), fractions, notation
  scientifique, %, n!, nCr/nPr, pgcd/ppcm/mod, statistiques, équations 1er /
  2nd degré, systèmes 2×2 / 3×3, développement / factorisation (racines
  rationnelles), dérivée et intégrale numériques, tableau de valeurs,
  historique réutilisable (stocké sur l'appareil).
  Décimales avec un point (1.5), arguments séparés par « ; ».
- **Horloge** : heure avec secondes et date complète dans le fuseau du
  profil (repli : fuseau du navigateur, puis Africa/Douala). Changer le
  fuseau dans Paramètres met l'horloge à jour immédiatement.

## Examens paramétrables

`/exams` : matière, chapitre, niveau d'étude, difficulté, nombre de
questions (5 à 20) et durée (10 à 120 min). Le minuteur se soumet
automatiquement à 00:00 ; les réponses ne quittent jamais le serveur avant
la soumission.

## Image du hero

`app/page.tsx` : dépose ton image dans `/public` et change `HERO_IMAGE`
(ou définis `NEXT_PUBLIC_HERO_IMAGE`). Le cadrage `cover` et le voile s'adaptent.

## Migrations à exécuter dans l'ordre (Supabase > SQL Editor)

1. `migration-v1.3-assistant-quota.sql` — quota IA fiable
2. `migration-v1.4-schema-alignment.sql` — aligne le code sur ta base réelle
   (colonnes manquantes, triggers badges/XP, anti-brute-force)
3. `migration-v1.5-group-planning.sql` — planning partagé des groupes,
   ajout d'un membre par le propriétaire, recherche d'utilisateurs par nom
4. `migration-v1.6-group-access.sql` — *(historique)* ancien accès annuel payant
   aux groupes ; **remplacé par la V1.9** (à exécuter quand même : les
   migrations suivantes se basent sur son état)
5. `migration-v1.7-exams-fix.sql`
6. `migration-v1.8-monetbil-payments.sql` — table `payments`, index anti-rejeu
7. `migration-v1.9-premium-cards-avatars.sql` — groupes inclus dans Premium, photo
   de profil, table `quota_usage`
8. **`migration-v2.0-premium-billing.sql`** — facturation Premium : statuts, périodes,
   renouvellement, historique, rappels (voir « Version 2.0 » ci-dessous)

Chaque fichier est rejouable sans risque.

## Groupes d'étude — inclus dans Premium (depuis la V1.9)

**Il n'existe plus de paiement individuel pour rejoindre un groupe.**

| Utilisateur | Groupes |
|---|---|
| Gratuit (ou Premium expiré) | voit la liste, **sans accès** (ni contenu, ni création, ni adhésion) |
| Premium actif | accès complet ; **rejoindre est gratuit** (aucun paiement supplémentaire) |

- La règle est appliquée **par la base**, pas seulement par l'interface :
  `is_active_group_member()` (utilisée par toutes les politiques RLS des
  contenus de groupe) exige un Premium **actif** ; `join_group()` refuse un
  utilisateur non Premium ; la création d'un groupe exige aussi un Premium actif.
- Un abonnement qui expire referme l'accès ; le renouveler le rouvre aussitôt.
  Aucune adhésion n'est supprimée.
- **Ancien code neutralisé** : `POST /api/payments/initiate` répond `410` pour
  `type: "group_access"` ; un trigger SQL refuse tout **nouveau** paiement de ce
  type ; `startGroupAccessPayment` et `NEXT_PUBLIC_GROUP_ACCESS_PRICE_FCFA` sont
  supprimés. **L'historique des anciennes transactions est conservé.** Un ancien
  paiement de groupe encore « en attente » qui se confirmerait après coup est
  marqué `legacy_group_access` + `needs_review` (aucun accès accordé) pour
  traitement manuel.
- Choix de conception : les propriétaires de groupes ont eux aussi besoin d'un
  Premium actif. Pour laisser un propriétaire gratuit accéder à son propre
  groupe, il suffit d'ajouter `or exists (select 1 from groups g where g.id = p_group_id and g.owner_id = auth.uid())`
  dans `is_active_group_member()`.

## Groupes d'étude (onglets)

Chat, Documents, Questions, **Membres** (le propriétaire cherche une
personne par son nom et l'ajoute), **Planning** (séances de révision
partagées), **Audio/vidéo** (appel de groupe via Jitsi Meet — gratuit,
sans compte ni clé, une salle par groupe), **Assistant** (l'assistant IA,
en conversation personnelle).

## Voix

Bouton micro (parler au lieu d'écrire) et bouton « Écouter » sur chaque
réponse de l'assistant : API vocales natives du navigateur, gratuites,
sans clé. Fonctionne sur Chrome/Edge ; Firefox ne gère pas la
reconnaissance vocale (le bouton micro est alors masqué).

## V1.3 — À faire à la mise à jour

1. Supabase > SQL Editor : exécuter `supabase/migration-v1.3-assistant-quota.sql`
   (rejouable). Elle change aussi les droits d'exécution de `add_xp`,
   `award_badge`, `check_login_allowed`, `record_login_result` : avant, un
   utilisateur pouvait les appeler depuis son navigateur (XP infinis,
   compteur anti-brute-force remis à zéro).
2. `npm run build` : je n'ai pas pu le lancer (pas d'accès réseau pour
   installer les dépendances) — le typage et le rendu ont été contrôlés avec
   des stubs, pas avec Next lui-même.

## Planning intelligent + rappels — déjà branchés

- `/schedule` génère un vrai planning (table `schedule_items`) selon la
  règle du cahier des charges : 1 matière = 1h, +30 min pour l'examen,
  les matières les plus faibles (via `fetchSubjectProgress`) passent en
  premier, dans le temps disponible entre le réveil et le départ.
- `components/NotificationScheduler.tsx`, monté globalement dans
  `AppShell`, demande la permission de notification du navigateur puis
  programme les rappels du jour : 10 minutes avant chaque session, au
  début (message différent pour un examen), et à la fin. Ces
  notifications ne fonctionnent que tant qu'un onglet Study Helper est
  ouvert (pas encore de push serveur — voir prochaines étapes).
- Le dashboard affiche désormais le vrai planning du jour au lieu de
  données statiques.

## Groupes d'étude — déjà branchés

`/groups` liste les groupes existants, permet d'en créer et de les
rejoindre gratuitement pour tous (tables `groups` + `group_members`,
insertion directe — pas de paiement). Chaque groupe a sa page
(`/groups/[id]`) avec 3 onglets :

- **Chat** — temps réel (`group_messages` + Supabase Realtime)
- **Documents** — partage d'un cours déjà importé/analysé par un membre
  (référence vers `courses`, pas un nouvel upload) — table
  `group_documents`
- **Questions** — mini forum du groupe : poser une question, plusieurs
  membres peuvent y répondre — tables `group_questions` +
  `group_answers`

**Pas encore construits** : planning partagé du groupe, et audio/vidéo
(demande une infrastructure WebRTC/signalisation, indiqué "bientôt" dans
l'interface plutôt que de faire semblant).

**Anti-spam sur le chat** — un déclencheur SQL (`enforce_message_rate_limit`)
bloque l'envoi si un utilisateur poste plus de 5 messages en 10 secondes,
appliqué côté serveur donc impossible à contourner depuis le client.

## Premium — déjà branché (sans rapport avec les groupes)

`profiles.subscription_status` (`free` / `premium`, 2 500 FCFA/mois)
supprime la publicité (à afficher) et augmente les limites quotidiennes
d'usage IA — suivies dans `ai_usage_log` et vérifiées côté serveur par
`lib/rate-limit.ts` pour chaque type d'action :

| Action | Gratuit / jour | Premium / jour |
|---|---|---|
| Questions à l'assistant | 10 | 100 |
| Analyses de document | 5 | 50 |
| Examens générés | 3 | 20 |
| Grands Quiz générés | 2 | 10 |

`/profile` a un bouton "Passer Premium" qui bascule le statut —
simulation en attendant le vrai paiement.

## Corrections de sécurité (revue du 10/09)

- **Authentification vérifiée côté serveur** — les routes
  `/api/analyze`, `/api/generate-exam`, `/api/generate-quiz` et
  `/api/assistant` ne font plus confiance à un `ownerId` envoyé dans le
  corps de la requête (falsifiable). `lib/auth-server.ts` vérifie le
  jeton Supabase envoyé dans l'en-tête `Authorization` et en déduit
  l'utilisateur réel ; `lib/api.ts` joint ce jeton à chaque appel.
  `/api/analyze` vérifie en plus que le `courseId` demandé appartient
  bien à l'appelant avant de l'analyser.
- **Suivi de complétion du planning** — le dashboard affichait une
  barre "Objectif du jour" toujours à 0 % ; chaque session du planning a
  maintenant une case à cocher (colonne `schedule_items.completed`) et
  le pourcentage reflète les sessions réellement marquées comme faites.

## Nouveau cahier des charges (V1→V4) — ce qui a changé

Un cahier des charges plus large a remplacé certains choix précédents :

- **Comptes** : 6 profils au lieu de 4 —
  `eleve_primaire`, `eleve_secondaire`, `etudiant`, `formation_pro`,
  `enseignant`, `entreprise`. ⚠️ Si ta base Supabase existait déjà avec
  l'ancien enum (`eleve`, `etudiant`, `enseignant`, `autre`), il faut la
  recréer (`drop type account_type cascade` puis réexécuter le schéma) —
  Postgres ne permet pas de renommer facilement les valeurs d'un enum.
  Comme le projet est encore en développement, c'est la voie la plus
  simple.
- **Groupes** *(obsolète depuis la V1.9 : groupes inclus dans Premium)* : la création redevenait **gratuite** pour tout le monde
  (l'ancien paiement par type de compte est abandonné — `create_group()`
  et `group_payments` ont été retirés du schéma).
- **Premium** : paliers par profil — Élève/Étudiant/Formation pro :
  2 500 FCFA/mois (ou 7 000/trimestre, 29 500/an) ; Enseignant :
  3 000 FCFA/mois ; Entreprise : sur devis (pas d'auto-souscription).
- **Opportunités** (`/opportunities`) et **Activités éducatives**
  (`/activities`) — nouvelles pages, accessibles gratuitement à tous,
  avec **modération avant publication** (statut `pending` → `approved`/
  `rejected`) et signalement (`opportunity_reports`). Il n'existe pas
  encore d'interface d'administration pour approuver — ça se fait pour
  l'instant directement dans Table Editor Supabase (changer `status` en
  `approved`) ou par une future route `/api/admin`.

## Panel de modération — déjà branché

`/admin/moderation` liste les opportunités et activités en attente
(`status = 'pending'`), avec boutons Approuver/Refuser, plus les
signalements reçus. Accès réservé aux comptes `role = 'moderator'` ou
`'admin'` (nouvelle colonne `profiles.role`), vérifié à la fois côté
interface et côté base de données (RLS) — un utilisateur normal qui
visite l'URL directement voit un message d'accès refusé, et même en
contournant l'interface, les policies RLS empêchent techniquement toute
modification du statut sans le bon rôle.

**Pour te donner ce rôle (ou à quelqu'un d'autre)** — aucune interface
volontairement, pour éviter qu'un utilisateur se l'attribue lui-même :
dans le SQL Editor Supabase,
```sql
update profiles set role = 'admin' where id = 'uuid-de-l-utilisateur';
```
(récupère l'UUID dans Table Editor → `profiles`, ou dans Authentication →
Users).

## Panel admin général — déjà branché

`/admin` (réservé au rôle `admin`, pas `moderator`) affiche :
- des compteurs (utilisateurs, Premium, cours importés, éléments en
  attente de modération, groupes)
- un raccourci vers `/admin/moderation` s'il y a des éléments en attente
- la liste de tous les utilisateurs, avec bascule Premium/Gratuit en un
  clic et changement de rôle (Utilisateur/Modérateur/Admin) via un menu
  déroulant — protégé par les mêmes policies RLS que la modération.

Le lien "Administration" n'apparaît dans le menu que pour les comptes
`admin` ; "Modération" apparaît pour `moderator` et `admin`.

## Espace Carrière — déjà branché

`/career` (3 onglets, tous via Gemini) :
- **CV** — formulaire (nom, poste visé, formation, expérience,
  compétences) → CV généré en Markdown, copiable
- **Lettre de motivation** — formulaire (poste, entreprise, points
  forts) → lettre générée, copiable
- **Simulation d'entretien** — chat où l'IA joue le recruteur : pose une
  question à la fois, donne un retour après chaque réponse, adaptée au
  poste visé

Quotas quotidiens dédiés (`career-cv`, `career-letter`,
`career-interview`) dans `lib/rate-limit.ts`, même logique gratuit/Premium
que le reste.

Export PDF et Word disponibles partout (boutons "PDF" et "Word" à côté
de "Copier"), via `jspdf` et `docx` côté client.

**Le CV a un vrai template graphique** (la lettre de motivation reste en
texte simple) : l'IA renvoie des données structurées (`fullName`,
`targetRole`, `tagline`, `education[]`, `experience[]`, `skills[]`)
plutôt qu'un Markdown libre, affichées dans un aperçu à deux colonnes
(bandeau sombre avec nom/compétences + colonne principale), avec export
PDF (`lib/cv-template.ts`) et Word (`lib/cv-template-docx.ts`) qui
reproduisent la même mise en page.
Pas de portfolio (liste de projets) encore construit non plus.

Deux onglets supplémentaires :
- **Portfolio** — CRUD simple (`portfolio_items`) : titre, description,
  lien, technologies. Personnel à chaque utilisateur (RLS).
- **Orientation** — formulaire (matières préférées, centres d'intérêt,
  compétences, contraintes) → 3 à 5 pistes de métiers/filières générées
  par l'IA, avec justification et prochaines étapes concrètes, adaptées
  au contexte camerounais/africain quand pertinent.

## Double authentification (2FA) — déjà branchée

Via l'API MFA native de Supabase (TOTP — Google Authenticator, Authy...),
gratuite, aucun fournisseur SMS payant requis :
- `/profile` a une section "Double authentification" pour activer/
  désactiver, avec QR code à scanner
- `/login` demande le code à 6 chiffres après le mot de passe si la 2FA
  est activée sur le compte
- `/admin` affiche un bandeau d'alerte si le compte admin connecté n'a
  pas encore activé la 2FA (recommandation, pas un blocage forcé pour
  l'instant)

**OTP par téléphone** (SMS) n'est pas branché — ça demande un fournisseur
SMS payant (Twilio, MessageBird...) configuré côté Supabase, contrairement
au TOTP qui est gratuit. À voir si le besoin se confirme.

## Gamification (XP, niveaux, badges) — déjà branchée

- **XP et niveaux** — `profiles.xp`, niveau = `floor(xp/100)+1` (voir
  `lib/badges.ts`). Affiché dans le Header ("Niv. X", cliquable) et en
  détail sur `/badges` (barre de progression vers le niveau suivant).
- **Badges** — table `user_badges` (juste la clé ; libellés/descriptions
  dans `lib/badges.ts`, pas de migration nécessaire pour en ajouter).
  5 badges de départ : premier examen, sans-faute (100%), 5 examens à
  80%+, premier cours importé, premier groupe rejoint.
- **Attribution automatique et impossible à truquer** — XP et badges
  sont accordés uniquement par des triggers SQL (`security definer`) sur
  l'insertion d'un résultat d'examen, d'un cours ou d'une adhésion à un
  groupe. Il n'existe aucune policy permettant à un utilisateur
  d'insérer directement dans `user_badges` ou de modifier `profiles.xp`
  lui-même.

## Paiement Premium — MTN MoMo, Orange Money, Visa / Mastercard et PayPal (V3.4)

Fiche de paiement ouverte par **« S’abonner à Premium » / « Renouveler mon Premium »** (`/profile`).
**CamPay, Lygos, Monetbil et CinetPay sont retirés du circuit** ; leurs transactions restent dans la base et s'affichent toujours.

| Moyen | Prestataire | Parcours client | Champ demandé |
|---|---|---|---|
| MTN Mobile Money | **API MTN directe** — `lib/billing/providers/mtn.ts` | La demande de paiement arrive **sur le téléphone**, confirmée par le client chez l'opérateur | Numéro mobile du pays choisi |
| Orange Money | **API Orange Web Payment directe** — `lib/billing/providers/orange.ts` | Redirection vers la **page officielle Orange** ; code à usage unique par USSD | aucun |
| Visa / Mastercard | **PayPal** — `lib/billing/providers/paypal.ts` | Formulaire carte sur la **page sécurisée PayPal** | aucun |
| PayPal | **PayPal** (même intégration) | Connexion au compte PayPal | aucun |

Le pays est **choisi par l'utilisateur** (jamais déduit de l'IP) ; le registre est `lib/payment-countries.ts` et les noms de pays / prix s'affichent
dans la langue de l'interface. `/api/payments/methods?country=XX` n'indique « disponible » que les moyens dont les identifiants serveur sont configurés.

Notifications (déclencheurs uniquement, jamais une preuve) : `/api/payments/mtn/webhook`, `/api/payments/orange/webhook`,
`/api/payments/paypal/webhook` (signature vérifiée auprès de PayPal). Le statut réel est TOUJOURS relu auprès du prestataire (`settlePayment`) ;
PayPal : la commande est **capturée** seulement après approbation du client, de façon idempotente.

**Study Helper ne demande, ne reçoit et n'enregistre jamais** : PIN, CVV, numéro ou date d'expiration de carte.

### Sécurité du paiement (toutes obligatoires)
1. **Transaction créée côté serveur AVANT le paiement** (`payments`, statut `pending`, référence unique).
2. **Montant et durée décidés par le serveur** (`lib/premium.ts`, `lib/billing/config.ts`) : le navigateur
   ne les envoie jamais. Ils sont **figés** sur la transaction (`amount`, `duration_days`).
3. **Une redirection ou un callback n'est jamais une preuve** : seule la réponse du prestataire à
   **notre** interrogation (`GET requesttopay/{ref}` MTN, `transactionstatus` Orange, `/payment/check`
   CinetPay) compte, avec **montant, devise, référence et utilisateur concordants**.
4. **Activation atomique et idempotente** : la fonction SQL `apply_payment_success()` verrouille la
   transaction, active en une seule transaction et mémorise `activated_at` — un même paiement ne peut
   **jamais** prolonger Premium deux fois (rappels, requêtes simultanées).
5. **Anti double paiement** : un seul paiement Premium `pending` par utilisateur (index unique) ;
   une transaction opérateur ne sert qu'à **un** paiement (index unique `(provider, provider_txn_id)`).
6. **Callbacks sécurisés** : MTN (aucune signature → simple déclencheur, vérifié par interrogation),
   Orange (`notif_token` comparé à temps constant + vérification), CinetPay (HMAC `x-token` + vérification).
7. Aucune clé secrète côté navigateur ; `payments` n'est plus lisible depuis le navigateur
   (l'application passe par `/api/premium/status`, qui n'expose que des champs sûrs).

### Statuts
- **Transaction** : `pending` · `success` · `failed` · `cancelled` · `expired`
  (un paiement `expired`/`cancelled` reste revérifiable : si le client a finalement confirmé chez
  l'opérateur, Premium est activé — aucun argent encaissé n'est perdu).
- **Abonnement** : `active` · `expiring_soon` (≤ 7 jours) · `expired` · `pending` · `failed` · `cancelled`
  (+ `none`). `pending/failed/cancelled` n'apparaissent que si Premium n'est pas actif.

### Durée et renouvellement
- Durée **configurable** : 30 / 90 / 365 jours par défaut ; variables `PREMIUM_DAYS_MENSUEL`,
  `PREMIUM_DAYS_TRIMESTRIEL`, `PREMIUM_DAYS_ANNUEL`.
- Après paiement confirmé : `premium_started_at`, `premium_expires_at`, plan, **montant réellement payé**
  (`paid_amount`), moyen de paiement, référence et identifiant de transaction opérateur sont enregistrés.
- **Premium encore actif** → la nouvelle période **prolonge** : nouvelle expiration = expiration actuelle + durée
  (aucun jour perdu). **Expiré** → nouvelle période à partir de la **confirmation** du paiement.
- Chaque renouvellement reste dans l'historique (`payments.renewal`, `period_start`, `period_end`),
  affiché dans le profil. `profiles.subscription_expires_at` est tenu en miroir de `premium_expires_at`
  par un trigger : tout le code existant (quota IA, groupes, cron…) continue de fonctionner.
- **Rappels** (notification push + bandeau dans le profil) : 7 jours, 3 jours, le jour de l'expiration,
  et après l'expiration — **une seule fois chacun** (`premium_notifications`).
- **Page de confirmation** `/payments/return` : statut, référence, nouveau statut Premium, date de début,
  nouvelle expiration, jours restants. Si le paiement est en attente : « Paiement en cours de vérification »
  (vérification serveur toutes les 3 s, sans jamais activer prématurément).

### Renouvellement automatique : honnête, jamais simulé
| Moyen | Prélèvement récurrent officiel | Renouvellement |
|---|---|---|
| MTN MoMo | l'API propose une « pré-approbation », mais sa disponibilité en production au Cameroun n'est pas établie | **manuel** |
| Orange Money | le Web Payment n'a pas de prélèvement récurrent | **manuel** |
| Mastercard (CinetPay) | ni récurrent ni tokenisation de carte | **manuel** |

L'architecture est prête (`premium_autorenew`, `capabilities.autoRenew` et `chargeRecurring()` dans
`lib/billing/providers/types.ts`, tâche `lib/billing/recurring.ts`, désactivation
`POST /api/premium/auto-renew`) mais **aucun prestataire ne la déclare** : personne n'est prélevé
automatiquement, le client renouvelle à la main avec rappels. Pour activer un jour un prestataire :
implémenter son consentement/mandat, `chargeRecurring()` et passer `capabilities.autoRenew` à `true`.

### Variables d'environnement (serveur uniquement)
- **MTN MoMo** : `MTN_MOMO_SUBSCRIPTION_KEY`, `MTN_MOMO_API_USER`, `MTN_MOMO_API_KEY`, `MTN_MOMO_TARGET_ENVIRONMENT`, `MTN_MOMO_BASE_URL`, `MTN_MOMO_CURRENCY`
  (autres pays : suffixe `_<CC>`, ex. `MTN_MOMO_GH_API_KEY`).
- **Orange Money** : `ORANGE_MONEY_AUTH_HEADER`, `ORANGE_MONEY_MERCHANT_KEY`, `ORANGE_MONEY_COUNTRY`, `ORANGE_MONEY_CURRENCY` (autres pays : suffixe `_<CC>`).
- **PayPal** : `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` (`sandbox` / `live`), `PAYPAL_CURRENCY`, `PAYPAL_WEBHOOK_ID`.
- **Pays et tarifs (non secrets)** : `NEXT_PUBLIC_PAYMENT_COUNTRIES`, `NEXT_PUBLIC_PREMIUM_PRICES_JSON` (prix dans les devises autres que le franc CFA).
- `NEXT_PUBLIC_APP_URL` (**https public**), `CRON_SECRET`, `PREMIUM_DAYS_*` (facultatives).

### À faire côté prestataires
- **MTN** : compte de collecte entreprise (portail partenaire MTN MoMo) ; identifiants API et valeur `X-Target-Environment` de ton pays.
- **Orange** : marchand Orange Money enregistré (KYA) ; en-tête d'autorisation et clé marchand.
- **PayPal** : compte Business, application REST, webhook `https://<domaine>/api/payments/paypal/webhook`
  (événements `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`) ; confirmer que le compte peut RECEVOIR depuis ton pays.
- Sans ces accès, le moyen concerné reste désactivé proprement (message clair) ; l'autre fonctionne.

### Tâche planifiée
`/api/cron/premium` (toutes les heures, `vercel.json`, protégée par `CRON_SECRET`) : expire les paiements
périmés, **rapproche** les paiements ouverts (filet si un callback n'arrive jamais), envoie les rappels
d'expiration, traite les renouvellements automatiques (aucun aujourd'hui).

⚠️ Sans domaine public, les notifications ne peuvent pas être reçues — la page de retour et la tâche
planifiée vérifient quand même les paiements par interrogation. Les anciens paiements (Monetbil, MTN, Orange,
CinetPay) restent dans la table pour l'historique mais ne sont plus vérifiés.

## V2.1 — IA double moteur, langues, visuel, audio, bibliothèque
- **Routeur IA** (`lib/ai/router.ts`) : pratique → Gemini n°2 (`lib/ai/gemini2.ts`) ; fonctions existantes → Gemini n°1
  (`lib/gemini.ts`, inchangé) ; demande « explique puis entraîne-moi » → les deux, en complément. Si Gemini n°2
  échoue, la pratique retombe sur Gemini n°1.
- **Connaissances de l'app** (`lib/ai/app-knowledge.ts`) : injectées quand on interroge l'IA sur l'application.
- **Explications visuelles** : `/api/visual` (schéma SVG annoté, vérifié côté serveur, affiché via `<img>`).
- **Images** : `/api/vision` (exercice / schéma / graphique photographié).
- **i18n** : 14 langues — fr, en, de, es, it, pt, ar, zh, nl, ru, tr, ja, ko, hi (`lib/i18n`), `profiles.preferred_language` (voir migration v2.2 pour la contrainte CHECK), sélecteur dans Paramètres et sur la connexion.
- **Audio** : Lire / Pause / Reprendre / Arrêter, voix selon la langue (`components/AudioControls.tsx`).
- **Bibliothèque** : visionneuse plein écran (`components/FullscreenViewer.tsx`, pdf.js).
- Migrations : `supabase/migration-v2.1-languages-campay-lygos.sql` (historique) et `supabase/migration-v3.3-direct-payments.sql`.

## V2.2 — Langue unique (preferredLanguage) pour toute la chaîne IA + page Pratique
- **Une seule source de vérité** : `preferredLanguage` (`profiles.preferred_language`, NULL tant que l'utilisateur n'a rien choisi).
  L'application envoie le choix en direct dans l'en-tête `x-app-language` ; le serveur le valide (`lib/ai/language.ts`),
  sinon lit le profil. Le français n'est utilisé que si l'utilisateur n'a encore jamais choisi de langue.
- **Chaque requête Gemini n°1 et Gemini n°2** reçoit `TARGET LANGUAGE: <langue>` + la `RULE` (instructions système) et un rappel
  final dans le message. `callGemini` / `callGemini2` exigent `lang` : le compilateur refuse un appel qui l'oublie.
  Routes concernées : assistant, Pratique, analyse de cours, examens, quiz, carrière (CV, lettre, entretien, orientation),
  schémas, analyse d'images. Le cours original n'est jamais réécrit.
- **Pratique** (`/practice`, menu « Pratique ») : exercice, résolution guidée, correction, exemples, explication, progression.
  Appelle Gemini n°2 **sans repli silencieux** (message clair si `GEMINI_API_KEY` manque).
- **Voix** : toujours la langue choisie ; pause/reprise gérées par l'application (fiables sur Android/iOS).
- Tests : `npm run test:ai` (réseau simulé : vérifie le contenu exact envoyé à chaque IA).

## V2.3 — La langue de l'application l'emporte sur celle du système
- Aucune détection (navigateur, système, clavier, question) : la langue vient UNIQUEMENT de l'application. Résolution serveur : champ `language` du corps > en-tête `x-app-language` > profil > français (seulement si rien n'a jamais été transmis).
- Prompt système dynamique écrit dans la langue cible, tout en haut des instructions, en plus de `TARGET LANGUAGE` et du rappel final.
- Un choix de langue non enregistré (hors ligne, déconnecté) est conservé et ré-enregistré : jamais de retour à une autre langue.
- `npm run test:ai` : tests A–D (navigateur français/chinois), changement en temps réel, garde anti-régression.

## V2.5 — Deux Gemini distincts (OpenAI retiré) + langue de l'application prioritaire
- **Gemini n°1** (`lib/gemini.ts`) : explications, cours, examens, quiz, carrière, schémas, description d'images.
  Modèle `GEMINI_MODEL`, défaut `gemini-3.5-flash-lite` (OBJECTIF 3 — réglable sans redéploiement).
- **Gemini n°2** (`lib/ai/gemini2.ts`) : la fonction qui était assurée par OpenAI — Pratique (`/api/practice`), modes
  exercice / série / quiz / question de l'assistant, demande « explique puis entraîne-moi » (partie pratique) et exercices
  photographiés (`/api/vision`, images conservées). Modèle `gemini-3.5-flash-lite` (réglable : `GEMINI_PRACTICE_MODEL`).
  Même clé `GEMINI_API_KEY` : rien d'autre à configurer.
- **OpenAI supprimé** : `lib/ai/openai.ts`, `lib/ai/engine.ts`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `PRACTICE_ENGINE`.
- **Langue** : règle unique dans `STUDY_HELPER_RULES` (n°10) et dans la directive `TARGET LANGUAGE` : « Always respond in the
  language currently selected in the application… » ; l'ancienne règle « langue utilisée par l'utilisateur » est supprimée.
  `I18nProvider` ne laisse plus une ancienne valeur du profil (Supabase) écraser un choix récent.

## Version 2.0 — ce qui a changé

- **Nouveau système Premium** : fiche de paiement (MTN MoMo, Orange Money, Mastercard), API officielles,
  statuts, historique, rappels, renouvellement — voir « Paiement Premium » ci-dessus.
- **Base de données** (`migration-v2.0-premium-billing.sql`, rejouable, **sans suppression de données**) :
  `profiles.premium_started_at` / `premium_expires_at` (anciens abonnements recopiés, miroir de
  `subscription_expires_at`) ; `payments` : `provider_txn_id`, `duration_days`, `period_start`, `period_end`,
  `renewal`, `paid_amount`, `expires_at`, `failure_reason`, statuts `pending|success|failed|cancelled|expired`
  (l'ancien `completed` devient `success`) ; fonctions `apply_payment_success`, `expire_stale_payments` ;
  tables `premium_autorenew`, `premium_notifications` (serveur uniquement).
- **Routes** : `POST /api/payments/initiate|verify|cancel`, `POST /api/payments/mtn/callback`,
  `POST /api/payments/orange/notify/[ref]` (+ `return`, `cancel`), `POST /api/payments/cinetpay/webhook`,
  `GET /api/premium/status`, `POST /api/premium/auto-renew`, `GET /api/cron/premium`.
- **Interface** : `PremiumCheckoutSheet`, `PremiumStatusCard`, `PaymentMethodSelector`,
  page `/payments/return`. La réservation de cours de répétition utilise le même circuit.
- Groupes, quota IA, photo de profil, prompt IA : inchangés depuis la V1.9.

## Version 1.9 — ce qui a changé

- **Paiements** : MTN/Orange (Monetbil, numéro + opérateur) et Visa/Mastercard
  (CinetPay) ; activation **atomique et idempotente** (`complete_payment`).
- **Groupes** : inclus dans Premium, plus aucun paiement séparé (voir plus haut).
- **Photo de profil** : `POST/DELETE /api/profile/avatar` (JPG, JPEG, PNG, WebP,
  2 Mo max ; vrai type contrôlé sur les octets ; réduction/recadrage carré côté
  navigateur pour accepter les photos de téléphone). Bucket **public** `avatars`
  (créé automatiquement au besoin), URL enregistrée dans `profiles.avatar_url`.
  Nouveau nom de fichier à chaque envoi → aucun problème de cache. Image par
  défaut : initiales. Affichée sur `/profile` et dans l'en-tête. Le navigateur ne
  peut pas écrire `avatar_url` lui-même. Le bucket privé `documents` n'est pas
  touché.
- **Quota IA** : affichage « Questions IA : 8 / 10 utilisées · 2 restantes »
  + statut (Gratuit / Premium) ; `quota_usage` est désormais **créée** par les
  migrations (elle n'existait dans aucun fichier SQL : sur une base neuve le
  compteur restait « indisponible »). Un 429 sans code `quota_exceeded` venant
  de notre serveur n'est plus présenté comme « limite atteinte ».
- **Prompt IA** : les règles pédagogiques obligatoires (`lib/study-helper-rules.ts`)
  sont injectées dans `systemInstruction` à **chaque** appel Gemini (point
  d'entrée unique `callGemini`). Le contenu des cours/documents n'est **plus**
  dans les instructions système : il est envoyé dans le message utilisateur,
  dans des blocs « DONNÉES NON FIABLES » aux délimiteurs aléatoires.
- **Racines** : `lib/math-normalize.ts` convertit `sqrt(2)` / `\sqrt{2}` en `√2`
  (et `sqrt(x+1)` en `√(x+1)`) dans les réponses, **sans toucher** aux blocs de
  code, au code inline ni à `math.sqrt(2)` / `Math.sqrt(2)`.
- **Lecture vocale** : `√2` est lu « racine carrée de 2 », `x²` « x au carré » ;
  les blocs de code ne sont pas épelés ; lecture par morceaux (évite l'arrêt des
  longues lectures dans Chrome).

## Marketplace enseignants — déjà branché

`/marketplace` (cours de répétition, **séparé de l'abonnement Premium**
comme prévu dans le cahier des charges) :

- **Parcourir** — tous les utilisateurs voient les offres actives
  (filtrables par matière) et peuvent réserver ; le paiement passe par
  le même circuit Monetbil que Premium (`app/api/payments/initiate` et
  `webhook`, type `tutoring`), avec vérification réelle avant de
  confirmer la réservation.
- **Mes réservations** — historique de ses propres réservations et leur
  statut (paiement en attente / confirmée / annulée).
- **Mes offres** (comptes `enseignant` uniquement, vérifié par RLS —
  pas juste côté interface) — créer, activer/désactiver, supprimer ses
  offres, et voir le nom des étudiants ayant payé pour organiser la
  session (règle RLS dédiée sur `profiles`, limitée aux réservations
  payées de ses propres offres).

**Ce qui manque encore** : pas de créneau horaire précis à la réservation
(l'enseignant et l'étudiant s'organisent hors app pour l'instant), pas de
messagerie dédiée entre eux (à faire via un futur canal, ou en réutilisant
le contact affiché), pas de système d'avis/notation.

## Notifications push réelles — déjà branchées

Fonctionnent même app/onglet fermé, contrairement aux notifications
précédentes (`NotificationScheduler`, qui restent actives en complément
tant qu'un onglet est ouvert) :

1. **Génère tes clés VAPID** (une seule fois) :
   ```bash
   npx web-push generate-vapid-keys
   ```
   Renseigne `NEXT_PUBLIC_VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` dans
   `.env.local` avec les deux clés obtenues, et `VAPID_SUBJECT` (un
   `mailto:` ou une URL — exigé par la norme Web Push).
2. **`/profile`** → section "Notifications push" → "Activer" : enregistre
   `public/sw.js` (service worker) et envoie l'abonnement à
   `app/api/push/subscribe` (table `push_subscriptions`).
3. **`app/api/push/send-reminders`** vérifie, chaque minute, les
   sessions du planning du jour (`schedule_items`) et envoie une
   notification (10 min avant, au début, à la fin) via `web-push` à
   tous les abonnements de l'utilisateur concerné.
4. **`vercel.json`** déclenche cette route toutes les minutes en
   production (Vercel Cron) — protégée par `CRON_SECRET` (Vercel ajoute
   automatiquement l'en-tête `Authorization: Bearer $CRON_SECRET` si
   cette variable est définie dans le projet Vercel).

⚠️ **Limites à connaître** :
- Le plan **Vercel Hobby (gratuit) ne permet qu'un cron par jour**, pas
  par minute — il faut soit un plan payant (Pro), soit héberger le
  déclenchement ailleurs (un service de cron externe gratuit comme
  cron-job.org qui appelle l'URL avec le bon header, par exemple).
- Ajoute une icône réelle à `public/icon-192.png` (référencée par le
  service worker) — absente pour l'instant, les notifications
  s'afficheront simplement sans icône en attendant.
- Les fuseaux horaires sont calculés en `Africa/Douala` (WAT, UTC+1,
  sans heure d'été) — à ajuster dans
  `app/api/push/send-reminders/route.ts` si les utilisateurs sont
  ailleurs.

## Publicités (v2.8) — emplacements, administration, AdSense

**Où** : 8 emplacements, uniquement dans le flux de pages de contenu — accueil (`/`), tableau de bord (sous les
cartes principales), mes cours (entre deux documents), bibliothèque (entre deux documents), marketplace (hors liste
d'offres, libellé « Publicité »), groupes, opportunités, activités. **Jamais** sur examens, quiz, pratique, assistant,
carrière, planning, paiement, profil, connexion, ni pendant la lecture d'un document, une séance du professeur IA ou
une discussion vocale : ces pages n'ont tout simplement pas de clé dans `lib/ads/config.ts` (`AD_PAGES`).

**Qui voit quoi** (`decideAd`, `lib/ads/config.ts`, couvert par `npm run test:ads`) :
- compte Premium actif ou statut Premium illisible → rien, aucun script chargé (le statut est lu en base avec la
  session de l'utilisateur, jamais dans le stockage du navigateur) ;
- compte gratuit / visiteur : réseau AdSense **seulement si** identifiant d'éditeur + identifiant de bloc valides,
  réglages lus en base ET consentement accepté ; sinon promotion Study Helper (si activée par l'admin) ; sinon rien.
  L'emplacement de remplacement n'existe qu'en développement (ou `NEXT_PUBLIC_ADS_PLACEHOLDER=true`).
- fournisseur en panne, bloqué ou sans publicité à servir : l'emplacement se referme (délai 8 s), l'appli n'est jamais bloquée.

**Administration** : `/admin/ads` (admin uniquement ; écriture protégée par RLS `public.is_admin()`). Interrupteur général,
pages, formats, emplacements, état du fournisseur. **Aucune statistique de revenu/clic/impression n'est affichée** : Study
Helper n'en collecte pas ; les vrais chiffres sont dans AdSense.

**À faire pour une diffusion réelle** (rien de tout cela n'est fait par le code) :
1. Exécuter `supabase/migration-v2.8-ad-settings.sql` (1 table, 1 ligne, RLS activée), puis ouvrir `/admin/ads` et enregistrer.
2. Compte AdSense approuvé pour ton domaine ; créer un bloc par emplacement ; renseigner `NEXT_PUBLIC_ADSENSE_CLIENT` et
   les `NEXT_PUBLIC_ADSENSE_SLOT_*` (voir `.env.local.example`), puis redéployer (variables inlinées au build).
3. Publier `public/ads.txt` avec **ta** ligne éditeur fournie par AdSense (non créé : identifiant requis).
4. Consentement : le bandeau intégré (accepter/refuser, mémorisé sur l'appareil) est basique. Si tu diffuses à des
   utilisateurs de l'EEE/Royaume-Uni/Suisse, Google exige un CMP certifié — à vérifier dans les règles AdSense en vigueur.
5. Vérifier les conditions du programme AdSense (contenu, emplacement, incitation au clic interdite — rien dans l'appli n'en demande).

La « publicité maison » (promotion Premium, `components/ads/HouseAd.tsx`) reste affichée aux comptes gratuits comme avant ;
désactivable dans `/admin/ads`. Ses chiffres viennent de `lib/quota-limits.ts` (l'ancienne version annonçait 10 questions
gratuites au lieu de 5).

## V1.1 — Durcissement sécurité (suite à un audit externe)

⚠️ **Si ta base Supabase existe déjà** (créée avant cette passe),
n'exécute pas tout `schema.sql` d'un coup — plusieurs `create table`
échoueraient sur des tables déjà existantes. Exécute plutôt
**`supabase/migration-v1.1-security.sql`** dans le SQL Editor : il ne
contient que les changements de cette section, écrit pour être
rejouable sans erreur sur une base existante. Pour un tout nouveau
projet Supabase, `schema.sql` seul suffit toujours (il contient déjà
tout, migration incluse).

Un audit externe a passé le code en revue et remonté plusieurs failles
réelles, dont deux critiques. Voici ce qui a été corrigé dans cette
passe — **côté base de données et routes serveur d'abord**, comme
l'audit le recommandait, pas page par page :

**🔴 Critique — un utilisateur pouvait s'auto-promouvoir admin/Premium**
`profiles for update using (auth.uid() = id)` vérifiait la ligne mais
pas les colonnes : rien n'empêchait un utilisateur d'appeler l'API
Supabase directement pour se mettre `role = 'admin'` ou
`subscription_status = 'premium'`. Corrigé par un verrou de colonnes
(`revoke/grant` PostgreSQL) : le client ne peut modifier que
`full_name` et `account_type` sur son propre profil. Les changements de
rôle/abonnement ne passent plus que par la fonction
`admin_update_user()`, qui vérifie elle-même que l'appelant est admin.
`app/admin/page.tsx` a été mis à jour pour appeler cette fonction (RPC)
au lieu d'un `update()` direct, qui aurait sinon simplement échoué avec
le nouveau schéma.

**🔴 Critique — les résultats d'examen étaient falsifiables**
Le client calculait son propre score et l'insérait directement dans
`exam_results` — un utilisateur pouvait s'inventer 100%, ce qui
déclenchait aussi XP/badges à tort. Corrigé par une refonte complète du
flux :
1. `generate-exam` / `generate-quiz` génèrent les questions,
   **gardent les bonnes réponses en base** (table `generated_exams`,
   inaccessible au client) et n'envoient au navigateur que
   `{question, options}` — jamais `correctIndex` ni `method`.
2. Les nouvelles routes `app/api/exams/submit` et
   `app/api/quizzes/submit` reçoivent uniquement les réponses cochées,
   calculent le score **côté serveur** à partir des vraies bonnes
   réponses, et sont les seules à pouvoir écrire dans `exam_results`
   (plus de policy d'insertion cliente sur cette table).
3. `app/exams/page.tsx` et `app/quizzes/page.tsx` ont été réécrites
   pour ce nouveau contrat — elles ne voient jamais les bonnes réponses
   avant la correction.

**🔴 Documents privés** — le bucket `documents` est passé en
`public: false`. Les fichiers sont lus côté serveur avec la clé
`service_role` (`supabaseAdmin.storage.download()`), jamais via une URL
publique.

**🔴 Récursion RLS sur `profiles`** — remplacé les `EXISTS(select ...
from profiles ...)` répétés dans les policies par deux fonctions
`security definer` dédiées (`is_admin()`, `is_moderator_or_admin()`),
comme recommandé.

**🟠 Rate limit non atomique** — `checkAndLogUsage()` faisait un
`SELECT` puis un `INSERT` en deux appels JS séparés : deux requêtes
simultanées pouvaient toutes les deux passer sous la limite. Remplacé
par une fonction SQL unique (`check_and_log_usage`), atomique par
construction (transaction implicite d'une fonction PL/pgSQL).

**🟠 `ai_usage_log` modifiable par le client** — la policy était
`for all`, ce qui permettait à un utilisateur de supprimer ses propres
lignes pour réinitialiser sa limite. Restreint à `select` uniquement ;
l'écriture ne passe plus que par la fonction ci-dessus (`service_role`).

**🟠 Premium sans expiration réelle** — `subscription_expires_at`
n'était jamais calculé après un paiement. Le webhook calcule maintenant
la vraie date (+1/+3/+12 mois selon le terme, en prolongeant depuis la
date d'expiration existante si l'abonnement est encore actif), et la
route cron (`send-reminders`, déjà déclenchée chaque minute) déclasse
les comptes Premium expirés vers `free`.

**🟠 Validation des entrées** — ajout de `zod` (`lib/validate.ts`) sur
toutes les routes qui reçoivent du texte libre ou un historique de
conversation (assistant, les 4 routes carrière, génération d'examen,
soumission d'examen/quiz) : longueurs maximales, types stricts, plus de
payload arbitrairement gros envoyé à l'IA.

**🟡 `eval()` dans la calculatrice** — remplacé par un calcul contrôlé
à deux opérandes (regex + switch), sans exécution de code arbitraire.

**🟡 Next.js 14.2.5 → 14.2.25** — corrige notamment un contournement
d'autorisation dans le middleware (CVE-2024-51479). Pour référence : la
faille critique RCE de décembre 2025 (CVE-2025-66478) ne touche **pas**
la branche 14.x stable, seulement 15.x/16.x et les canaris 14.3+ — donc
pas d'urgence absolue sur ce point précis, mais une mise à jour reste
recommandée. Lance `npm install` après avoir récupéré ce zip.

**🟡 Dossier parasite retiré** — un dossier vide
`app/{login,register,...}` (résidu d'une commande mal interprétée)
a été supprimé.

**Ce que l'audit a soulevé et qui reste à faire** (moins critique,
listé aussi dans "Prochaines étapes") :
- `package-lock.json` absent — lance `npm install` et commite-le pour
  des installations reproductibles.
- Modération : la policy `for update` sur `opportunities`/`activities`
  est maintenant restreinte par colonnes (`status`, `moderated_by`,
  etc. — voir `revoke/grant` dans le schéma), mais une vraie fonction
  RPC dédiée serait encore plus propre.

**Fuseau horaire par utilisateur** — `profiles.timezone` (choix dans
`/profile`, 6 fuseaux courants), utilisé par `send-reminders` pour
calculer "maintenant" séparément pour chaque groupe d'utilisateurs
plutôt qu'un seul fuseau (`Africa/Douala`) codé en dur pour tout le
monde.

**Anti-brute-force serveur sur `/login`** — la connexion passe
maintenant par `app/api/auth/login`, qui vérifie un compteur d'échecs
en base (`login_attempts`, fonctions `check_login_allowed` /
`record_login_result`) avant même de tenter l'authentification :
blocage de 2 minutes après 5 échecs sur un même email, avec un message
d'erreur volontairement générique. Contrairement à l'ancien blocage
purement côté client (facilement contourné en rechargeant la page), un
script ne peut plus le contourner. Limite assumée : le compteur est par
email, pas par IP — un script qui viserait beaucoup de comptes
différents depuis la même IP ne serait pas ralenti par ce mécanisme.

**Analyse de documents** : bucket Supabase limité à 15 Mo et à une
liste précise de types MIME (bloqué par Supabase lui-même, avant même
que le code ne s'exécute) ; même limite vérifiée côté client pour un
retour immédiat ; OCR avec timeout de 45s (une image très complexe ne
peut plus bloquer la route indéfiniment) ; texte extrait plafonné à
200 000 caractères en mémoire, quel que soit le format.

## V1.2 — Deuxième passe (suite à un second audit externe)

Le premier audit a été suivi d'un second, sur le code déjà corrigé —
il a confirmé les points tenus et soulevé une nouvelle série de
problèmes plus fins (races conditions restantes, validation des
réponses IA, dates UTC). Voici ce qui a été corrigé :

**🔴 Rate-limit pas vraiment atomique** — `check_and_log_usage` faisait
bien SELECT+INSERT dans une seule fonction, mais rien n'empêchait deux
appels **concurrents** de tous les deux lire le compteur avant que l'un
des deux n'insère (la fonction ne bloquait personne). Corrigé avec
`pg_advisory_xact_lock(hashtext(owner_id || action))` en tout début de
fonction : deux appels pour le même utilisateur/la même action
s'exécutent maintenant en séquence, jamais en parallèle.

**🔴 Double soumission d'examen/quiz possible** — même famille de
problème : `generated_exams.used` était lu, puis mis à jour dans une
requête séparée. Remplacé par une réclamation atomique
(`UPDATE generated_exams SET used = true WHERE id = ... AND used = false
RETURNING ...`) : une seule requête concurrente peut réussir, l'autre
reçoit 0 ligne et est rejetée immédiatement. `/api/quizzes/submit`
vérifie aussi maintenant l'erreur de **chaque** insertion par matière
au lieu de continuer silencieusement si l'une échoue.

**🔴 Webhook CinetPay — montant jamais vérifié** — le webhook faisait
confiance au statut "ACCEPTED" de CinetPay sans comparer le montant
réellement confirmé à celui attendu. Corrigé : le montant est comparé,
et tout écart marque le paiement `failed` avec le détail en
`metadata` plutôt que d'activer Premium. Le webhook distingue aussi
maintenant un statut définitivement refusé (`REFUSED`/`CANCELLED`,
marqué `failed`) d'un statut intermédiaire/inconnu (laissé `pending`,
en attendant le prochain rappel du webhook) — avant, tout ce qui
n'était pas "ACCEPTED" devenait `failed` définitivement, y compris un
paiement encore en cours de traitement côté opérateur mobile money.

**🔴 2FA affichée mais jamais vraiment imposée** — `AppShell.tsx` ne
vérifiait que la présence d'une session, pas son niveau (AAL1 vs
AAL2). La vraie protection est maintenant dans la fonction SQL
`admin_update_user()` elle-même : si le compte admin a un facteur 2FA
vérifié, la session doit être de niveau AAL2 (code réellement saisi)
pour changer le rôle ou l'abonnement d'un utilisateur — sinon l'action
est refusée par la base de données, pas juste par l'interface.
`AppShell` fait aussi un contrôle côté client sur `/admin` et
`/admin/moderation` pour rediriger proactivement vers `/login` si la
2FA n'a pas été complétée, plutôt que de laisser l'utilisateur
découvrir le refus après coup.

**🟠 Validation Zod des réponses IA, pas seulement des requêtes** —
`generate-exam`, `generate-quiz`, `analyze`, `career-cv` et
`career-orientation` valident maintenant la structure de ce que Gemini
renvoie (nombre d'options, `correctIndex` dans les bornes, champs
non vides...) avant de l'enregistrer ou de le servir — une réponse
IA malformée est rejetée proprement (`502`) plutôt que de se propager
telle quelle.

**🟠 Dates calculées en UTC au lieu de l'heure locale** —
`new Date().toISOString().slice(0, 10)` donne la date **UTC**, pas la
date locale de l'utilisateur — autour de minuit, ça pouvait afficher
le mauvais jour selon le fuseau. Remplacé par
`lib/utils.ts` → `todayLocalISO()` (basé sur `getFullYear()`/
`getMonth()`/`getDate()`, qui utilisent le fuseau du navigateur) dans
`dashboard/page.tsx`, `schedule/page.tsx` et `NotificationScheduler.tsx`.

**🟡 Fonctions SECURITY DEFINER sans `search_path` explicite** —
toutes durcies avec `set search_path = public`, comme recommandé :
sans ça, une fonction `SECURITY DEFINER` peut potentiellement être
trompée par un rôle qui redéfinit une fonction de même nom dans un
schéma placé avant `public` dans son `search_path`.

**🟡 `.doc`/`.ppt` acceptés par l'interface mais pas traités** — le
champ d'upload proposait ces extensions alors que seuls `.docx`/`.pptx`
(formats modernes) sont réellement extraits côté serveur. Retiré de
la liste acceptée pour éviter la confusion.

**🟡 Icône PWA manquante** — `public/sw.js` référençait
`/icon-192.png`, absente du projet. Ajoutée (icône simple aux couleurs
de la marque).

**🟡 Contraintes sur `payments`** — `amount_fcfa > 0`, `type` et
`status` limités aux valeurs attendues, directement en base.

**⚠️ Migration** — tous ces changements SQL sont aussi dans
`supabase/migration-v1.1-security.sql` (sections 10 à 15), à exécuter
si ta base existe déjà.

**Ce qui reste, moins critique** :
- Rate-limit **par IP** en plus du par-email sur `/login`.
- Logs d'audit des actions admin (qui a changé quoi, quand).
- Tests automatisés — inexistants pour l'instant (le projet n'a aucun
  répertoire de tests). Pour une app avec authentification, paiements
  et examens, ça reste la lacune la plus sérieuse à combler avant une
  vraie mise en production à grande échelle.
- `npm run build` n'a encore jamais été validé dans un vrai
  environnement — je n'ai pas d'accès réseau ici pour installer les
  dépendances et le vérifier moi-même. À faire avant tout déploiement.
- `package-lock.json` toujours absent (même limite : pas d'accès
  réseau ici pour le générer).

## Prochaines étapes

1. Plus de badges (série de jours consécutifs, matière maîtrisée à
   100%, premier Grand Quiz...) et un affichage "nouveau badge débloqué"
   au moment où il est gagné (actuellement visible seulement sur
   `/badges`).
2. Rendre la 2FA obligatoire (pas juste recommandée) pour les comptes
   Modérateur et Admin.
3. OTP par téléphone (SMS) si un budget fournisseur SMS est prévu.
4. Planning partagé et audio/vidéo dans les groupes (documents et
   questions sont faits).
5. Appli mobile React Native + Expo (V3-V4).

## Design

- Couleurs : `ink` (#1B1F3B), `paper` (#FBF7F0), `gold` (#E8A33D),
  `clay` (#C1542E), `forest` (#3F7A5D) — définies dans `tailwind.config.ts`.
- Typographies : Fraunces (titres) + Inter (interface), chargées via
  `next/font/google` dans `app/layout.tsx`.
- Photo de fond de la page d'accueil : `public/hero-background.jpg`,
  avec un dégradé sombre (`from-ink via-ink/90 to-ink/60`) par-dessus
  pour garder le texte lisible.


---

## Professeur IA dans la bibliothèque (v2.9)

**Activation (obligatoire, une seule fois)** : exécuter `supabase/migration-v2.3-ai-tutor.sql` dans Supabase > SQL Editor.
Elle est additive (2 tables : `tutor_sessions`, `ai_cost_log` ; 1 fonction : `ai_budget_usage`) et ne touche à aucune donnée existante.
Sans elle : le professeur ne peut pas créer de séance ; le suivi de coût échoue silencieusement (le budget est alors ignoré).

- **Pédagogie** : `app/api/tutor/route.ts` découpe `courses.content_text` en paragraphes (`lib/tutor/paragraphs.ts`, déterministe),
  explique, pose une question, évalue (correct / partiel / incorrect / ambigu) et n'avance QUE si la réponse est correcte
  (ou si l'élève choisit explicitement « Passer », la notion est alors marquée « à revoir »). Après 2 échecs, l'IA reformule autrement.
- **Même Gemini** : appels via `callGemini` (même clé, même modèle). Pas de second service. La voix = reconnaissance du navigateur
  (repli `/api/transcribe`) → Gemini → synthèse vocale du navigateur. Aucune API vocale native de Gemini n'est supposée.
- **Quotas** (mécanisme existant `check_and_log_usage`, `lib/quota-limits.ts`) : `tutor`, `voice-session`, `summary` = 2/jour gratuit
  (essai, valeur proposée), 10/jour Premium. Une séance = 1 essai ; reprendre une séance = 0 ; séance vocale comptée une fois par séance.
- **Budget** (`lib/ai-cost.ts`, `lib/tutor/budget.ts`) : tokens réels par utilisateur et par période, variables `AI_TOKEN_BUDGET_*`.
- **Tests** : `npm run test:tutor` (logique pure). Voir le rapport de livraison pour ce qui n'a PAS pu être testé automatiquement :
  parcours réel avec Gemini, audio du navigateur, base Supabase réelle.

**Écouter / professeur / appel en direct sur tous les documents** : un document jamais analysé n'avait pas de texte
(`content_text`), donc ni « Écouter » ni professeur. `/api/course-text` extrait désormais le texte à la demande (PDF, Word,
PowerPoint, texte, OCR des images) — sans Gemini et sans quota d'analyse — et l'enregistre dans `content_text`. Les boutons
sont dans la bibliothèque ET dans le lecteur plein écran. Limite : un PDF **scanné** (pages-images) ou une image illisible
n'a pas de texte extractible → message clair.

**Appel en direct** : mains libres. Le micro ne s'ouvre qu'après la fin de la voix du professeur ; 2 silences d'affilée = raccroché ;
permission refusée / réseau = retour à l'écrit. Une question parlée (« pourquoi… ? ») part comme question libre.
Aucun appel IA sans parole de l'élève.
