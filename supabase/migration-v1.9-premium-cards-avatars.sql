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
