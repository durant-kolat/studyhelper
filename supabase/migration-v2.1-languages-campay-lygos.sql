-- Study Helper V2.1 — langue de l'utilisateur + paiements CamPay / Lygos.
-- À exécuter APRÈS migration-v2.0-premium-billing.sql (Supabase > SQL Editor). Idempotent.

-- 1) Langue préférée (preferredLanguage) -------------------------------------------------------
-- NULL = l'utilisateur n'a encore jamais choisi de langue (aucun français « par défaut » imposé).
alter table public.profiles add column if not exists preferred_language text;
alter table public.profiles alter column preferred_language drop not null;
alter table public.profiles alter column preferred_language drop default;

alter table public.profiles drop constraint if exists profiles_preferred_language_check;
alter table public.profiles
  add constraint profiles_preferred_language_check
  check (preferred_language is null or preferred_language in ('fr', 'en', 'de', 'es', 'it', 'pt', 'ar', 'zh'));

-- L'utilisateur peut changer SA langue (comme son fuseau horaire). Les autres colonnes sensibles
-- (abonnement, rôle…) restent non modifiables depuis le navigateur.
grant update (preferred_language) on public.profiles to authenticated;

-- 2) Paiements ----------------------------------------------------------------------------------
-- La table `payments` (v2.0) contient déjà : provider, provider_ref (unique), provider_txn_id
-- (unique par prestataire), user_id, amount, currency, status, created_at, updated_at, meta.
-- CamPay et Lygos réutilisent ces colonnes : provider = 'campay' | 'lygos'.
-- La référence CamPay (nécessaire pour interroger le statut) est stockée dans meta->>'campay_reference'.
-- Aucune colonne à ajouter. Les anciens paiements (monetbil, mtn_momo, orange_money, cinetpay)
-- restent dans la table pour l'historique : ils ne sont plus vérifiés par l'application.

-- Anti double activation : les index uniques ci-dessous existent depuis la v2.0 ; on les (re)crée
-- au besoin pour garantir qu'une même transaction ne peut jamais être enregistrée deux fois.
create unique index if not exists payments_provider_ref_key
  on public.payments (provider_ref) where provider_ref is not null;
create unique index if not exists payments_provider_txn_key
  on public.payments (provider, provider_txn_id) where provider_txn_id is not null;
