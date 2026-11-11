-- =====================================================================================
-- STUDY HELPER — SQL DES PAIEMENTS (MTN MoMo, Orange Money, Visa / Mastercard, PayPal) À COPIER-COLLER DANS SUPABASE
-- Supabase > SQL Editor > New query > colle TOUT > Run.
-- Contient, dans l'ordre : v1.8, v1.9, v2.0, v2.1, v3.3. Chaque partie est rejouable sans erreur (déjà passée = sans effet).
-- Résultat : table payments complète (provider, provider_ref, provider_txn_id, meta…), activation Premium atomique et idempotente
-- (apply_payment_success), un seul paiement « en attente » par utilisateur, une transaction ne sert qu'une fois, historique conservé.
-- PRÉREQUIS : supabase/schema.sql (tables de base) déjà exécuté, et migrations v1.1 à v1.7 passées.
-- =====================================================================================


-- ===================== 1/5 — v1.8 — table payments alignée sur le code =====================
-- ============================================================
-- MIGRATION V1.8 — Table payments alignée sur le code Monetbil
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
--
-- Audit : schema.sql décrit `payments` avec owner_id / transaction_id /
-- amount_fcfa / metadata et un `type` limité à premium|tutoring, alors que
-- le code (initiate + webhook) lit/écrit user_id / provider_ref / amount /
-- meta / currency / updated_at et le type `group_access`. Cette migration
-- aligne la base sur le code, sans supprimer aucune donnée.

-- 1) Colonnes utilisées par le code (ajout seulement si absentes) ------------
alter table public.payments add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.payments add column if not exists provider text default 'monetbil';
alter table public.payments add column if not exists provider_ref text;
alter table public.payments add column if not exists plan text;
alter table public.payments add column if not exists amount integer;
alter table public.payments add column if not exists currency text not null default 'XAF';
alter table public.payments add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.payments add column if not exists updated_at timestamptz not null default now();

-- 2) Anciennes colonnes (schema.sql d'origine) : reprise des données puis
--    NOT NULL levé, pour ne pas bloquer les insertions du code actuel.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='owner_id') then
    execute 'update public.payments set user_id = owner_id where user_id is null';
    execute 'alter table public.payments alter column owner_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='transaction_id') then
    execute 'update public.payments set provider_ref = transaction_id where provider_ref is null';
    execute 'alter table public.payments alter column transaction_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='amount_fcfa') then
    execute 'update public.payments set amount = amount_fcfa where amount is null';
    execute 'alter table public.payments alter column amount_fcfa drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='metadata') then
    execute 'update public.payments set meta = metadata where metadata is not null and meta = ''{}''::jsonb';
  end if;
end $$;

-- 3) Types de paiement : ajout de group_access (sinon l'INSERT est refusé) ----
alter table public.payments drop constraint if exists payments_type_check;
alter table public.payments
  add constraint payments_type_check check (type in ('premium', 'tutoring', 'group_access')) not valid;

-- 4) Intégrité / anti-rejeu ---------------------------------------------------
-- Une référence de paiement (payment_ref envoyé à Monetbil) est unique…
create unique index if not exists payments_provider_ref_key
  on public.payments (provider_ref) where provider_ref is not null;
-- …et une transaction Monetbil ne peut créditer qu'UN seul paiement.
create unique index if not exists payments_monetbil_transaction_key
  on public.payments ((meta->>'monetbil_transaction_id'))
  where meta ? 'monetbil_transaction_id';

-- 5) Sécurité : lecture seule pour l'utilisateur, écriture serveur uniquement --
-- (le webhook et l'initiation utilisent la clé service_role)
alter table public.payments enable row level security;
drop policy if exists "Un utilisateur voit ses propres paiements" on public.payments;
create policy "Un utilisateur voit ses propres paiements"
  on public.payments for select using (auth.uid() = user_id);
revoke insert, update, delete on public.payments from anon, authenticated;

-- 6) Recharge le cache de schéma PostgREST
notify pgrst, 'reload schema';


-- ===================== 2/5 — v1.9 — Premium, cartes, avatars (prérequis de v2.0) =====================
-- ============================================================
-- MIGRATION V1.9 — Premium (Mobile Money + carte), groupes inclus
--                  dans Premium, photo de profil, quota IA
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor, APRÈS V1.8
-- (rejouable sans erreur, ne supprime aucune donnée).
--
-- Ce que fait cette migration :
--   1) payments : moyen de paiement + activation ATOMIQUE et IDEMPOTENTE
--      (fonction complete_payment) ; plus aucun NOUVEAU paiement de groupe.
--   2) Groupes : l'accès est inclus dans Premium, vérifié en base (RLS) ;
--      rejoindre un groupe = gratuit pour un Premium actif (join_group).
--   3) Photo de profil : profiles.avatar_url + bucket public « avatars ».
--   4) Quota IA : crée la table quota_usage si elle n'existe pas (les
--      fonctions SQL de la V1.3 en dépendent, mais aucun fichier ne la créait).

-- ============================================================
-- 0) Fonctions Premium (filet si la V1.3 n'a pas été passée)
-- ============================================================
create or replace function public.user_is_premium(p_owner_id uuid)
returns boolean as $$
  select coalesce(
    (select subscription_status = 'premium'
            and (subscription_expires_at is null or subscription_expires_at > now())
     from public.profiles where id = p_owner_id),
    false
  );
$$ language sql stable security definer set search_path = public;

revoke all on function public.user_is_premium(uuid) from public, anon, authenticated;
grant execute on function public.user_is_premium(uuid) to service_role;

-- Version « utilisateur connecté » pour les politiques RLS (une politique
-- s'exécute avec les droits de l'appelant, qui n'a pas accès à la fonction
-- ci-dessus). Ne révèle que SON propre statut.
create or replace function public.current_user_is_premium()
returns boolean as $$
  select public.user_is_premium(auth.uid());
$$ language sql stable security definer set search_path = public;

revoke all on function public.current_user_is_premium() from public, anon;
grant execute on function public.current_user_is_premium() to authenticated, service_role;

-- ============================================================
-- 1) PAIEMENTS
-- ============================================================
alter table public.payments add column if not exists method text;          -- mtn | orange | visa | mastercard
alter table public.payments add column if not exists activated_at timestamptz;

-- Les paiements déjà « completed » ont été activés par l'ancien webhook :
-- on les marque, pour qu'un rappel tardif du prestataire ne les réactive pas.
update public.payments
   set activated_at = coalesce(updated_at, now())
 where status = 'completed' and activated_at is null;

create index if not exists payments_user_status_created_idx
  on public.payments (user_id, status, created_at desc);

-- Plus de NOUVEAU paiement de groupe (l'historique des anciens reste intact).
create or replace function public.block_group_access_payments()
returns trigger as $$
begin
  if new.type = 'group_access' then
    raise exception 'Le paiement individuel des groupes est supprimé : l''accès aux groupes est inclus dans Premium.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists payments_block_group_access on public.payments;
create trigger payments_block_group_access
  before insert on public.payments
  for each row execute function public.block_group_access_payments();

-- Activation d'un paiement confirmé (appelée UNIQUEMENT par les webhooks /
-- la vérification serveur, avec la clé service_role).
--   * verrouille la ligne de paiement (deux webhooks simultanés passent l'un après l'autre) ;
--   * si `activated_at` est déjà renseigné → ne fait RIEN (activation idempotente) ;
--   * sinon active + marque « completed » dans la MÊME transaction : tout ou rien.
create or replace function public.complete_payment(p_payment_id uuid, p_meta jsonb default '{}'::jsonb)
returns table(activated boolean, payment_type text)
language plpgsql security definer set search_path = public as $$
declare
  v_pay     public.payments%rowtype;
  v_term    text;
  v_months  int;
  v_base    timestamptz;
  v_booking uuid;
  v_meta    jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- Déjà activé : rien à refaire.
  if v_pay.activated_at is not null then
    return query select false, v_pay.type;
    return;
  end if;

  if v_pay.type = 'premium' then
    v_term := coalesce(nullif(v_pay.plan, ''), v_pay.meta->>'term', 'mensuel');
    if v_term not in ('mensuel', 'trimestriel', 'annuel') then
      v_term := 'mensuel';
    end if;
    v_months := case v_term when 'annuel' then 12 when 'trimestriel' then 3 else 1 end;

    -- On prolonge depuis l'expiration actuelle si elle est future : aucun jour payé n'est perdu.
    select greatest(now(), coalesce(subscription_expires_at, now()))
      into v_base
      from public.profiles
     where id = v_pay.user_id
       for update;
    if not found then
      raise exception 'profile_not_found';
    end if;

    update public.profiles
       set subscription_status     = 'premium',
           subscription_term       = v_term,
           subscription_expires_at = v_base + make_interval(months => v_months)
     where id = v_pay.user_id;

  elsif v_pay.type = 'tutoring' then
    begin
      v_booking := (v_pay.meta->>'booking_id')::uuid;
    exception when others then
      v_booking := null;
    end;
    if v_booking is not null then
      update public.tutoring_bookings set status = 'paid' where id = v_booking;
    end if;

  elsif v_pay.type = 'group_access' then
    -- Ancien paiement de groupe (avant la V1.9) arrivé après coup : l'argent est
    -- encaissé mais AUCUN accès n'est accordé (le paiement individuel n'existe plus).
    -- On le signale pour un traitement manuel (remboursement ou geste commercial).
    v_meta := v_meta || jsonb_build_object('legacy_group_access', true, 'needs_review', true);
  end if;

  update public.payments
     set status       = 'completed',
         activated_at = now(),
         updated_at   = now(),
         meta         = coalesce(meta, '{}'::jsonb) || v_meta
   where id = v_pay.id;

  return query select true, v_pay.type;
end;
$$;

revoke all on function public.complete_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_payment(uuid, jsonb) to service_role;

-- ============================================================
-- 2) GROUPES INCLUS DANS PREMIUM
-- ============================================================
-- Règle : l'accès aux groupes (lecture/écriture de leurs contenus) exige un
-- Premium ACTIF, vérifié ici, en base — jamais seulement dans le navigateur.
-- Un abonnement expiré referme l'accès ; le renouveler le rouvre aussitôt
-- (les adhésions ne sont jamais supprimées).
-- group_members.role ('owner' | 'member') est utilisée par l'application (création de groupe,
-- liste des membres) mais n'était définie dans aucun fichier SQL : on la garantit ici.
alter table public.group_members add column if not exists role text not null default 'member';
-- (group_members.expires_at, ajoutée par la V1.6, n'est plus utilisée : conservée pour l'historique.)

create or replace function public.is_active_group_member(p_group_id uuid)
returns boolean as $$
  select public.user_is_premium(auth.uid())
     and exists (
       select 1 from public.group_members m
       where m.group_id = p_group_id
         and m.user_id = auth.uid()
     );
$$ language sql stable security definer set search_path = public;

revoke all on function public.is_active_group_member(uuid) from public, anon;
grant execute on function public.is_active_group_member(uuid) to authenticated;

-- L'ancien modèle faisait démarrer les membres « expirés » jusqu'au paiement : obsolète.
drop trigger if exists group_members_force_expired on public.group_members;
drop function if exists public.force_expired_membership();

-- Rejoindre un groupe : gratuit pour un Premium actif, refusé sinon.
create or replace function public.join_group(p_group_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;
  if not public.user_is_premium(auth.uid()) then
    raise exception 'premium_required' using hint = 'Les groupes d''étude sont réservés aux abonnés Premium.';
  end if;
  if not exists (select 1 from public.groups where id = p_group_id) then
    raise exception 'Groupe introuvable.';
  end if;

  insert into public.group_members (group_id, user_id)
  values (p_group_id, auth.uid())
  on conflict (group_id, user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.join_group(uuid) from public, anon;
grant execute on function public.join_group(uuid) to authenticated;

-- Création d'un groupe = fonctionnalité Premium. On remplace UNIQUEMENT les
-- politiques d'INSERT (quel que soit leur nom : elles ont divergé du schéma d'origine).
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'groups' and cmd = 'INSERT')
        or (tablename = 'group_members' and cmd = 'INSERT')
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "Un Premium actif crée un groupe en tant que propriétaire"
  on public.groups for insert
  with check (auth.uid() = owner_id and public.current_user_is_premium());

-- group_members : seul le propriétaire (Premium actif) ajoute des membres (lui-même
-- à la création, ou une autre personne) ; les autres rejoignent via join_group().
create policy "Le propriétaire Premium ajoute des membres"
  on public.group_members for insert
  with check (
    public.current_user_is_premium()
    and exists (
      select 1 from public.groups g
      where g.id = group_members.group_id and g.owner_id = auth.uid()
    )
  );

-- ============================================================
-- 3) PHOTO DE PROFIL
-- ============================================================
alter table public.profiles add column if not exists avatar_url text;
-- Volontairement PAS de « grant update (avatar_url) » : seule la route serveur
-- /api/profile/avatar (clé service_role) écrit cette colonne, après avoir vérifié
-- le fichier — le navigateur ne peut pas y mettre une URL arbitraire.

-- Bucket PUBLIC « avatars » (des photos de profil, faites pour être vues), limité aux
-- images ≤ 2 Mo. Aucune politique d'écriture client : seul le serveur y dépose des fichiers.
-- Le bucket privé « documents » (cours) n'est pas touché. La route serveur sait aussi
-- créer ce bucket au premier envoi : cette étape n'est donc pas bloquante.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = true,
        file_size_limit = 2097152,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
exception when others then
  raise notice 'Bucket avatars non créé par SQL (%). Il sera créé automatiquement au premier envoi de photo.', sqlerrm;
end $$;

-- ============================================================
-- 4) QUOTA IA : la table utilisée par check_and_log_usage() & co
-- ============================================================
-- (V1.3 la suppose existante sous le nom quota_usage ; schema.sql ne créait que
--  ai_usage_log. Sur une base neuve, le compteur IA restait donc « indisponible ».)
create table if not exists public.quota_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  action text not null default 'assistant',   -- 'assistant' | 'analyze' | 'exam' | 'quiz' | …
  created_at timestamptz not null default now()
);
alter table public.quota_usage add column if not exists action text not null default 'assistant';
create index if not exists quota_usage_owner_action_created_idx
  on public.quota_usage (owner_id, action, created_at desc);

alter table public.quota_usage enable row level security;
drop policy if exists "Un utilisateur consulte son propre usage IA" on public.quota_usage;
create policy "Un utilisateur consulte son propre usage IA"
  on public.quota_usage for select using (auth.uid() = owner_id);
-- Le client ne peut ni insérer ni supprimer : ce serait réinitialiser sa propre limite.
revoke insert, update, delete on public.quota_usage from anon, authenticated;

-- ============================================================
-- 5) Recharge le cache de schéma PostgREST
-- ============================================================
notify pgrst, 'reload schema';

-- Vérifications rapides (à lancer après la migration) :
--   select proname from pg_proc where proname in ('complete_payment','join_group','current_user_is_premium');
--   select id, public, file_size_limit from storage.buckets where id = 'avatars';
--   select column_name from information_schema.columns
--    where table_name = 'payments' and column_name in ('method','activated_at');


-- ===================== 3/5 — v2.0 — facturation Premium : statuts, activation atomique apply_payment_success(), anti double paiement =====================
-- ============================================================
-- MIGRATION V2.0 — Facturation Premium : MTN MoMo, Orange Money,
--                  Mastercard ; renouvellement ; historique
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor, APRÈS V1.9.
-- Rejouable sans erreur. NE SUPPRIME AUCUNE donnée : les colonnes sont
-- ajoutées, les anciens abonnements Premium sont recopiés, les anciens
-- paiements « completed » sont simplement renommés « success ».
--
--   1) profiles  : premium_started_at / premium_expires_at (+ miroir de
--                  subscription_expires_at : tout le code existant continue
--                  de fonctionner sans modification)
--   2) payments  : statuts pending|success|failed|cancelled|expired,
--                  période Premium achetée, identifiant de transaction du
--                  prestataire, montant réellement payé, expiration
--   3) Activation ATOMIQUE et IDEMPOTENTE : apply_payment_success()
--      (prolonge si Premium actif, repart de la confirmation si expiré)
--   4) Anti double paiement : un seul paiement Premium « pending » par
--      utilisateur ; une transaction prestataire ne sert qu'une fois
--   5) premium_autorenew / premium_notifications (réservées au serveur)
--   6) payments n'est plus lisible depuis le navigateur (jetons du
--      prestataire) : l'application passe par /api/premium/status

-- ============================================================
-- 0) Garde-fous (au cas où la V1.9 serait incomplète)
-- ============================================================
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists activated_at timestamptz;

-- ============================================================
-- 1) PROFILES : début / expiration du Premium
-- ============================================================
alter table public.profiles add column if not exists premium_started_at timestamptz;
alter table public.profiles add column if not exists premium_expires_at timestamptz;

-- Reprise des abonnements existants (aucune donnée perdue).
update public.profiles
   set premium_expires_at = subscription_expires_at
 where premium_expires_at is null and subscription_expires_at is not null;

update public.profiles p
   set premium_started_at = s.first_paid
  from (
    select user_id, min(coalesce(activated_at, updated_at, created_at)) as first_paid
      from public.payments
     where type = 'premium' and status in ('completed', 'success') and user_id is not null
     group by user_id
  ) s
 where p.id = s.user_id and p.premium_started_at is null and p.subscription_status = 'premium';

-- Miroir bidirectionnel : premium_expires_at (nouveau nom) <-> subscription_expires_at
-- (nom historique, lu par user_is_premium(), le quota IA, les groupes, le cron…).
-- Quel que soit celui qu'on modifie, l'autre suit : jamais de divergence.
create or replace function public.sync_premium_expiry()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.premium_expires_at is null then
      new.premium_expires_at := new.subscription_expires_at;
    elsif new.subscription_expires_at is null then
      new.subscription_expires_at := new.premium_expires_at;
    end if;
  else
    if new.premium_expires_at is distinct from old.premium_expires_at then
      new.subscription_expires_at := new.premium_expires_at;
    elsif new.subscription_expires_at is distinct from old.subscription_expires_at then
      new.premium_expires_at := new.subscription_expires_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_premium_expiry on public.profiles;
create trigger profiles_sync_premium_expiry
  before insert or update on public.profiles
  for each row execute function public.sync_premium_expiry();
-- Aucun « grant update » sur les nouvelles colonnes : seul le serveur les écrit.

-- ============================================================
-- 2) PAYMENTS : statuts et colonnes de la facturation
-- ============================================================
alter table public.payments add column if not exists provider_txn_id text;      -- identifiant de transaction du prestataire
alter table public.payments add column if not exists duration_days integer;     -- durée achetée (jours), figée à la création
alter table public.payments add column if not exists period_start timestamptz;  -- début de la période achetée
alter table public.payments add column if not exists period_end timestamptz;    -- fin de la période achetée (= nouvelle expiration)
alter table public.payments add column if not exists renewal boolean not null default false; -- true = prolongation d'un Premium actif
alter table public.payments add column if not exists paid_amount integer;       -- montant réellement payé (confirmé par le prestataire)
alter table public.payments add column if not exists expires_at timestamptz;    -- fin de validité d'un paiement « pending »
alter table public.payments add column if not exists failure_reason text;

-- Statuts : pending | success | failed | cancelled | expired.
-- (l'ancienne valeur « completed » devient « success » ; l'historique est conservé)
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.payments'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.payments drop constraint %I', r.conname);
  end loop;
end $$;

update public.payments set status = 'success' where status = 'completed';
-- Un éventuel statut inconnu d'une ancienne version ne doit pas bloquer la migration :
-- il devient « failed » et l'ancienne valeur est conservée dans failure_reason.
update public.payments
   set failure_reason = coalesce(failure_reason, 'legacy_status:' || status), status = 'failed'
 where status not in ('pending', 'success', 'failed', 'cancelled', 'expired');

alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'success', 'failed', 'cancelled', 'expired'));

-- Historique : on recopie le montant déjà confirmé et l'identifiant Monetbil.
update public.payments set paid_amount = amount where status = 'success' and paid_amount is null;
update public.payments
   set provider_txn_id = meta->>'monetbil_transaction_id'
 where provider_txn_id is null and meta->>'monetbil_transaction_id' is not null;

-- Anti double paiement (1/2) : une transaction du prestataire ne sert qu'à UN paiement.
create unique index if not exists payments_provider_txn_key
  on public.payments (provider, provider_txn_id) where provider_txn_id is not null;

-- Anti double paiement (2/2) : un seul paiement Premium « pending » par utilisateur.
-- On commence par ranger d'éventuels doublons déjà en base (on garde le plus récent).
update public.payments
   set status = 'expired', failure_reason = coalesce(failure_reason, 'superseded'), updated_at = now()
 where status = 'pending' and type = 'premium'
   and id not in (
     select distinct on (user_id) id from public.payments
      where status = 'pending' and type = 'premium'
      order by user_id, created_at desc
   );

create unique index if not exists payments_one_pending_premium_per_user
  on public.payments (user_id) where status = 'pending' and type = 'premium';

create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);
create index if not exists payments_pending_expiry_idx on public.payments (expires_at) where status = 'pending';

-- ============================================================
-- 3) ACTIVATION ATOMIQUE ET IDEMPOTENTE
-- ============================================================
-- Appelée UNIQUEMENT par le serveur (clé service_role) après vérification du
-- paiement auprès du prestataire. Dans une seule transaction :
--   * verrouille la ligne de paiement (deux appels simultanés passent l'un après l'autre) ;
--   * si le paiement est déjà activé → ne fait RIEN (aucune double prolongation) ;
--   * Premium encore actif  → PROLONGE : nouvelle expiration = expiration actuelle + durée ;
--   * Premium absent/expiré → nouvelle période : début = confirmation du paiement ;
--   * enregistre période, montant réellement payé, identifiant de transaction.
create or replace function public.apply_payment_success(
  p_payment_id uuid,
  p_meta jsonb default '{}'::jsonb,
  p_paid_amount integer default null,
  p_provider_txn_id text default null
)
returns table(
  out_applied boolean,
  out_type text,
  out_period_start timestamptz,
  out_period_end timestamptz,
  out_renewal boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_pay       public.payments%rowtype;
  v_now       timestamptz := now();
  v_term      text;
  v_cur_exp   timestamptz;
  v_cur_start timestamptz;
  v_cur_stat  text;
  v_start     timestamptz;
  v_end       timestamptz;
  v_renewal   boolean := false;
  v_booking   uuid;
  v_meta      jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- Déjà activé : idempotent, on renvoie l'état existant sans rien modifier.
  if v_pay.activated_at is not null or v_pay.status = 'success' then
    return query select false, v_pay.type, v_pay.period_start, v_pay.period_end, v_pay.renewal;
    return;
  end if;

  if v_pay.type = 'premium' then
    v_term := coalesce(nullif(v_pay.plan, ''), v_pay.meta->>'term', 'mensuel');
    if v_term not in ('mensuel', 'trimestriel', 'annuel') then
      v_term := 'mensuel';
    end if;

    select coalesce(premium_expires_at, subscription_expires_at), premium_started_at, subscription_status::text
      into v_cur_exp, v_cur_start, v_cur_stat
      from public.profiles
     where id = v_pay.user_id
       for update;
    if not found then
      raise exception 'profile_not_found';
    end if;

    if v_cur_stat = 'premium' and v_cur_exp is not null and v_cur_exp > v_now then
      v_renewal := true;          -- Premium actif : on prolonge, aucun jour payé n'est perdu
      v_start   := v_cur_exp;
    else
      v_renewal   := false;       -- absent ou expiré : nouvelle période dès la confirmation
      v_start     := v_now;
      v_cur_start := v_now;
    end if;

    if v_pay.duration_days is not null and v_pay.duration_days > 0 then
      v_end := v_start + make_interval(days => v_pay.duration_days);
    else
      -- Ancien paiement (avant V2.0) sans durée en jours : mois calendaires.
      v_end := v_start + make_interval(months => case v_term when 'annuel' then 12 when 'trimestriel' then 3 else 1 end);
    end if;

    update public.profiles
       set subscription_status     = 'premium',
           subscription_term       = v_term,
           premium_started_at      = coalesce(v_cur_start, v_now),
           premium_expires_at      = v_end,
           subscription_expires_at = v_end
     where id = v_pay.user_id;

  elsif v_pay.type = 'tutoring' then
    begin
      v_booking := (v_pay.meta->>'booking_id')::uuid;
    exception when others then
      v_booking := null;
    end;
    if v_booking is not null then
      update public.tutoring_bookings set status = 'paid' where id = v_booking;
    end if;

  elsif v_pay.type = 'group_access' then
    -- Ancien paiement de groupe (avant la V1.9) confirmé après coup : argent encaissé,
    -- AUCUN accès accordé ; signalé pour traitement manuel.
    v_meta := v_meta || jsonb_build_object('legacy_group_access', true, 'needs_review', true);
  end if;

  update public.payments
     set status          = 'success',
         activated_at    = v_now,
         updated_at      = v_now,
         period_start    = case when v_pay.type = 'premium' then v_start end,
         period_end      = case when v_pay.type = 'premium' then v_end end,
         renewal         = v_renewal,
         paid_amount     = coalesce(p_paid_amount, amount),
         provider_txn_id = coalesce(p_provider_txn_id, provider_txn_id),
         failure_reason  = null,
         meta            = coalesce(meta, '{}'::jsonb) || v_meta
   where id = v_pay.id;

  return query select true, v_pay.type, v_start, v_end, v_renewal;
end;
$$;

revoke all on function public.apply_payment_success(uuid, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.apply_payment_success(uuid, jsonb, integer, text) to service_role;

-- Compatibilité : l'ancien nom (V1.9) reste appelable et passe par la même fonction.
create or replace function public.complete_payment(p_payment_id uuid, p_meta jsonb default '{}'::jsonb)
returns table(activated boolean, payment_type text)
language sql security definer set search_path = public as $$
  select r.out_applied, r.out_type from public.apply_payment_success(p_payment_id, p_meta) r;
$$;

revoke all on function public.complete_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_payment(uuid, jsonb) to service_role;

-- Les paiements « pending » dont la validité est dépassée passent à « expired »
-- (un paiement expiré reste revérifiable : si le client confirme tardivement chez
-- l'opérateur, le serveur l'active quand même — aucun argent encaissé n'est perdu).
create or replace function public.expire_stale_payments(p_user_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.payments
     set status = 'expired',
         failure_reason = coalesce(failure_reason, 'timeout'),
         updated_at = now()
   where status = 'pending'
     and expires_at is not null
     and expires_at < now()
     and (p_user_id is null or user_id = p_user_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_payments(uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_payments(uuid) to service_role;

-- ============================================================
-- 4) RENOUVELLEMENT AUTOMATIQUE + NOTIFICATIONS (serveur uniquement)
-- ============================================================
-- Aucune donnée sensible : jamais de PIN, de CVV ni de numéro de carte. `mandate_ref`
-- n'est qu'une référence opaque fournie PAR LE PRESTATAIRE (accord de prélèvement /
-- jeton) — et seulement si le prestataire propose officiellement ce mécanisme.
create table if not exists public.premium_autorenew (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  provider text,
  method text,
  plan text,
  mandate_ref text,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.premium_autorenew enable row level security;
revoke all on public.premium_autorenew from anon, authenticated;

-- Une notification n'est envoyée qu'UNE fois par échéance (user, période, type).
create table if not exists public.premium_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_end timestamptz not null,
  kind text not null check (kind in ('expiring_7d', 'expiring_3d', 'expires_today', 'expired', 'autorenew_failed')),
  channel text not null default 'push',
  delivered integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, period_end, kind)
);
alter table public.premium_notifications enable row level security;
revoke all on public.premium_notifications from anon, authenticated;

-- ============================================================
-- 5) SÉCURITÉ : les paiements ne sont plus lisibles depuis le navigateur
-- ============================================================
-- (jetons de notification du prestataire, références…). L'application lit
-- l'historique via /api/premium/status, qui n'expose que des champs sûrs.
alter table public.payments enable row level security;
revoke select on public.payments from anon, authenticated;

notify pgrst, 'reload schema';

-- Vérifications rapides (à lancer après la migration) :
--   select proname from pg_proc where proname in ('apply_payment_success','expire_stale_payments','sync_premium_expiry');
--   select status, count(*) from payments group by 1;
--   select count(*) from profiles where subscription_status = 'premium' and premium_expires_at is distinct from subscription_expires_at; -- doit être 0


-- ===================== 4/5 — v2.1 — langue de l'utilisateur + colonnes de paiement (provider_ref, provider_txn_id) =====================
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


-- ===================== 5/5 — v3.3 — paiements MTN / Orange / PayPal (index) =====================
-- Study Helper v3.3 — Paiements directs MTN / Orange et PayPal (en plus de l'historique CamPay / Lygos / Monetbil).
-- ADDITIVE et sans risque : aucune table recréée, aucune donnée modifiée. La colonne payments.provider est un texte libre :
-- 'mtn', 'orange' et 'paypal' s'y ajoutent sans modification de schéma. apply_payment_success() reste LA référence d'activation Premium.
-- PRÉREQUIS : migrations v1.8 à v2.1 (colonnes provider, provider_ref, provider_txn_id, meta). Défensif : si une colonne manque, l'index
-- correspondant est simplement ignoré (aucune erreur) ; rejoue cette migration après avoir exécuté les migrations manquantes.

do $$
begin
  -- Rapprochement des notifications Orange (elles ne contiennent que notif_token) : index d'expression sur le jeton.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'meta')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'provider') then
    execute 'create index if not exists payments_orange_notif_token_idx on public.payments ((meta->>''orange_notif_token'')) where provider = ''orange''';
  else
    raise notice 'v3.3 : colonnes meta/provider absentes de payments — exécute d''abord les migrations v1.8 à v2.1, puis rejoue celle-ci.';
  end if;

  -- Un même identifiant de transaction ne sert jamais deux paiements du même prestataire (créé par v2.0 / v2.1 ; rappel idempotent).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'provider_txn_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'provider') then
    execute 'create unique index if not exists payments_provider_txn_key on public.payments (provider, provider_txn_id) where provider_txn_id is not null';
  else
    raise notice 'v3.3 : provider_txn_id absente — la migration v2.0 (facturation Premium) n''a pas encore été exécutée.';
  end if;
end $$;

