# Study Helper — Paiements : état, configuration et mise en service

## 1. Moyens de paiement (après nettoyage)

| Moyen | Prestataire | Parcours | Statut du code |
|---|---|---|---|
| **MTN Mobile Money** | API MTN « Collection » directe (`providers/mtn.ts`) | demande sur le téléphone du client | prêt, **attend tes identifiants MTN** |
| **Orange Money** | API Orange « Web Payment » directe (`providers/orange.ts`) | page officielle Orange, code USSD | prêt, **attend ton compte marchand Orange** |
| **Visa / Mastercard** | PayPal (formulaire carte de la page PayPal) | page sécurisée PayPal | prêt, **attend ton compte PayPal Business** |
| **PayPal** | PayPal (`providers/paypal.ts`) | connexion PayPal | idem |

**Supprimés du circuit** : CamPay, Lygos (code, routes de notification et variables retirés), Monetbil et CinetPay (déjà hors circuit). Leurs transactions restent dans la table `payments` et s'affichent encore (« Mobile Money », « Mastercard »). Les paiements CamPay / Lygos encore « en attente » ne seront plus traités : ils expirent (jamais activés par erreur).

## 2. Garanties (inchangées et testées)
Montant et durée décidés par le serveur · transaction enregistrée avant l'appel au prestataire · une notification, une redirection ou une demande acceptée ne prouvent **jamais** un paiement : le serveur interroge le prestataire, compare montant / devise / utilisateur, puis active via `apply_payment_success()` (atomique, idempotente) · PayPal : capture seulement après approbation, idempotente (`PayPal-Request-Id`) · aucune donnée de carte, aucun PIN : tout est saisi chez le prestataire · aucune clé dans le navigateur.

## 3. Pays et langue
- Registre central `lib/payment-countries.ts` : 19 pays (couverture Orange officielle + MTN) avec indicatif, devise et format de numéro, plus « ZZ » = autre pays (carte / PayPal). **Seul le Cameroun est activé par défaut** ; active les autres avec `NEXT_PUBLIC_PAYMENT_COUNTRIES` (ex. `CM,CI,SN,ZZ`).
- Un pays n'est jamais « disponible » sans ses propres identifiants : variables suffixées par pays (`MTN_MOMO_GH_*`, `ORANGE_MONEY_CI_*`). `/api/payments/methods` n'annonce que les moyens réellement configurés.
- Noms de pays, prix et textes dans **la langue de l'interface** (14 langues). Pays proposé d'après la langue du navigateur, toujours modifiable ; jamais déduit de l'IP.
- **Tarifs** : francs CFA (XAF / XOF) = tarif de base ; **autres devises (dont l'EUR de PayPal) = tableau `NEXT_PUBLIC_PREMIUM_PRICES_JSON` que TU renseignes** (exemple dans `.env.local.example`). Sans tarif, le moyen affiche « tarif non défini » : aucun prix inventé ni converti.
- Les cours particuliers restent en francs CFA : Mobile Money uniquement.

## 4. Ce qu'il faut obtenir (blocages externes)
- **MTN** : compte de collecte entreprise (MoMoCorporate.CM@mtn.com pour le Cameroun) ; clé « Collection », API User / Key, URL de production et `X-Target-Environment` du pays.
- **Orange** : inscription marchande Orange Money (KYA) ; en-tête d'autorisation, clé marchand, segment d'URL du pays.
- **PayPal** : compte Business + application REST (client id / secret) + webhook (`PAYPAL_WEBHOOK_ID`). **À confirmer auprès de PayPal** : que ton compte peut recevoir des paiements depuis ton pays, les frais, les délais de retrait. L'API REST liste le Cameroun parmi les pays pris en charge, mais l'éligibilité d'un compte précis n'est pas garantie.
- **Visa** : acceptée via la page PayPal (pas d'intégration carte séparée) ; la disponibilité réelle de la saisie de carte dépend de l'éligibilité de ton compte PayPal.
- Formats de numéro des pays autres que le Cameroun : marqués « non vérifiés » dans le registre, à confirmer avec chaque opérateur à l'activation.

## 5. Mise en service
1. Exécuter `supabase/SQL-A-COPIER-COLLER.sql` (inclut v3.3 : index uniquement).
2. Renseigner les variables d'un moyen à la fois ; tester en **bac à sable** (MTN : devise EUR ; Orange : `ORANGE_MONEY_COUNTRY=dev` ; PayPal : `PAYPAL_ENV=sandbox`).
3. Vérifier : Premium activé une seule fois, paiement refusé / annulé / expiré, même notification rejouée (sans effet), coupure réseau (reste « en attente »).
4. Production : `PAYPAL_ENV=live`, URL MTN / Orange de production ; paiement test avec ton propre compte **et ton autorisation**, montant minimal.
5. Activer d'autres pays un par un.

## 6. Reste à faire
renouvellement automatique (aucun prélèvement récurrent implémenté ; PayPal propose des abonnements mais ils ne sont pas intégrés) · tests réels en bac à sable (impossibles sans identifiants) · remboursements (à traiter depuis les tableaux de bord des prestataires).
