-- ============================================================
-- MIGRATION V1.1 — Durcissement sécurité (suite audit externe)
-- ============================================================
-- À exécuter dans le SQL Editor Supabase si ta base a déjà été créée
-- avec une version antérieure de schema.sql. Contrairement à
-- schema.sql (pensé pour une base neuve), ce script est écrit pour
-- être rejouable sans erreur sur une base existante (drop/create,
-- if not exists, create or replace).

-- 1) Verrouiller les colonnes sensibles de profiles ---------------------
-- Empêche un utilisateur de s'auto-attribuer role='admin' ou
-- subscription_status='premium' via un appel direct à l'API Supabase.
revoke update on profiles from authenticated;
grant update (full_name, account_type) on profiles to authenticated;

drop policy if exists "Un utilisateur modifie son propre profil" on profiles;
create policy "Un utilisateur modifie son propre profil"
  on profiles for update using (auth.uid() = id);

-- 2) Fonctions security definer anti-récursion RLS -----------------------
create or replace function public.is_admin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer stable;

create or replace function public.is_moderator_or_admin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('moderator', 'admin'));
$$ language sql security definer stable;

drop policy if exists "Les admins voient tous les profils" on profiles;
create policy "Les admins voient tous les profils"
  on profiles for select using (public.is_admin());

-- Supprime l'ancienne policy d'update directe pour les admins si elle
-- existe encore chez toi (remplacée par la fonction ci-dessous) :
drop policy if exists "Les admins modifient tous les profils" on profiles;

-- 3) Fonction dédiée pour les changements de rôle/abonnement -------------
-- Seule façon de changer le rôle ou l'abonnement d'un autre utilisateur.
create or replace function public.admin_update_user(
  p_target_id uuid,
  p_role user_role default null,
  p_subscription_status subscription_status default null
)
returns void as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs.';
  end if;

  update profiles set
    role = coalesce(p_role, role),
    subscription_status = coalesce(p_subscription_status, subscription_status)
  where id = p_target_id;
end;
$$ language plpgsql security definer;

-- 4) Bucket "documents" en privé -----------------------------------------
update storage.buckets set
  public = false,
  file_size_limit = 15728640, -- 15 Mo
  allowed_mime_types = array[
    'application/pdf', 'text/plain',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
where id = 'documents';
-- ⚠️ Si ça ne suffit pas selon ta version de Supabase : Storage >
-- documents > Settings > désactive "Public bucket" manuellement.

-- 5) Résultats d'examen : plus d'écriture cliente ------------------------
-- Supprime l'ancienne policy permissive si elle existe encore chez toi :
drop policy if exists "Un utilisateur gère ses propres résultats" on exam_results;
drop policy if exists "Un utilisateur lit ses propres résultats" on exam_results;
create policy "Un utilisateur lit ses propres résultats"
  on exam_results for select using (auth.uid() = owner_id);
-- Plus aucune policy insert/update/delete pour "authenticated" : seule
-- la clé service_role (routes /api/exams/submit, /api/quizzes/submit)
-- peut désormais écrire dans cette table.

-- 6) Table des examens générés (bonnes réponses gardées côté serveur) ----
create table if not exists generated_exams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  subject text,
  questions jsonb not null,
  weak_subjects jsonb,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
alter table generated_exams enable row level security;
-- Aucune policy : le client n'a accès à cette table d'aucune façon.

-- 7) ai_usage_log : lecture seule pour le client, écriture atomique ------
drop policy if exists "Un utilisateur gère son propre historique d'usage IA" on ai_usage_log;
drop policy if exists "Un utilisateur consulte son propre historique d'usage IA" on ai_usage_log;
create policy "Un utilisateur consulte son propre historique d'usage IA"
  on ai_usage_log for select using (auth.uid() = owner_id);

create or replace function public.check_and_log_usage(
  p_owner_id uuid,
  p_action text,
  p_free_limit int,
  p_premium_limit int
)
returns table(allowed boolean, is_premium boolean, usage_limit int) as $$
declare
  v_is_premium boolean;
  v_limit int;
  v_count int;
begin
  select subscription_status = 'premium'
    and (subscription_expires_at is null or subscription_expires_at > now())
    into v_is_premium
  from profiles where id = p_owner_id;

  v_limit := case when v_is_premium then p_premium_limit else p_free_limit end;

  select count(*) into v_count
  from ai_usage_log
  where owner_id = p_owner_id
    and action = p_action
    and created_at > now() - interval '24 hours';

  if v_count >= v_limit then
    return query select false, v_is_premium, v_limit;
    return;
  end if;

  insert into ai_usage_log (owner_id, action) values (p_owner_id, p_action);
  return query select true, v_is_premium, v_limit;
end;
$$ language plpgsql security definer;

-- 8) Groupes : lecture réservée aux utilisateurs connectés ---------------
drop policy if exists "Tout utilisateur connecté peut lister les groupes" on groups;
create policy "Tout utilisateur connecté peut lister les groupes"
  on groups for select using (auth.uid() is not null);

drop policy if exists "Lecture des membres" on group_members;
create policy "Lecture des membres"
  on group_members for select using (auth.uid() is not null);

-- 9) Colonne d'expiration Premium (si absente) ---------------------------
alter table profiles add column if not exists subscription_expires_at timestamptz;

-- ============================================================
-- Fin de la migration V1.1
-- ============================================================
-- Après ça : redémarre l'app (`npm install` d'abord si tu récupères le
-- nouveau code), et vérifie dans Table Editor que `documents` (Storage)
-- est bien marqué privé.

-- 10) Fuseau horaire par utilisateur --------------------------------------
alter table profiles add column if not exists timezone text not null default 'Africa/Douala';
grant update (full_name, account_type, timezone) on profiles to authenticated;

-- 11) Anti-brute-force serveur sur /login ---------------------------------
create table if not exists login_attempts (
  identifier text primary key,
  attempt_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table login_attempts enable row level security;

create or replace function public.check_login_allowed(p_email text)
returns table(allowed boolean, seconds_left int) as $$
declare
  v_locked_until timestamptz;
begin
  select locked_until into v_locked_until
  from login_attempts where identifier = p_email;

  if v_locked_until is not null and v_locked_until > now() then
    return query select false, ceil(extract(epoch from (v_locked_until - now())))::int;
    return;
  end if;

  return query select true, 0;
end;
$$ language plpgsql security definer;

create or replace function public.record_login_result(p_email text, p_success boolean)
returns void as $$
declare
  v_count int;
begin
  if p_success then
    delete from login_attempts where identifier = p_email;
    return;
  end if;

  insert into login_attempts (identifier, attempt_count, updated_at)
  values (p_email, 1, now())
  on conflict (identifier) do update
    set attempt_count = login_attempts.attempt_count + 1,
        updated_at = now()
  returning attempt_count into v_count;

  if v_count >= 5 then
    update login_attempts
      set locked_until = now() + interval '2 minutes'
      where identifier = p_email;
  end if;
end;
$$ language plpgsql security definer;

-- 12) Durcissement des fonctions security definer (search_path) -----------
-- Applique la même protection à toutes les fonctions déjà créées plus
-- haut dans ce fichier ou dans schema.sql — sans search_path explicite,
-- une fonction SECURITY DEFINER peut être trompée par un rôle qui
-- redéfinit temporairement une fonction du même nom dans un schéma
-- placé avant "public" dans le search_path de la session appelante.
alter function public.is_admin() set search_path = public;
alter function public.is_moderator_or_admin() set search_path = public;
alter function public.admin_update_user(uuid, user_role, subscription_status) set search_path = public;
alter function public.check_and_log_usage(uuid, text, int, int) set search_path = public;
alter function public.check_login_allowed(text) set search_path = public;
alter function public.record_login_result(text, boolean) set search_path = public;

-- 13) Verrou consultatif pour la vraie atomicité du rate-limit ------------
create or replace function public.check_and_log_usage(
  p_owner_id uuid,
  p_action text,
  p_free_limit int,
  p_premium_limit int
)
returns table(allowed boolean, is_premium boolean, usage_limit int) as $$
declare
  v_is_premium boolean;
  v_limit int;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_owner_id::text || ':' || p_action));

  select subscription_status = 'premium'
    and (subscription_expires_at is null or subscription_expires_at > now())
    into v_is_premium
  from profiles where id = p_owner_id;

  v_limit := case when v_is_premium then p_premium_limit else p_free_limit end;

  select count(*) into v_count
  from ai_usage_log
  where owner_id = p_owner_id
    and action = p_action
    and created_at > now() - interval '24 hours';

  if v_count >= v_limit then
    return query select false, v_is_premium, v_limit;
    return;
  end if;

  insert into ai_usage_log (owner_id, action) values (p_owner_id, p_action);
  return query select true, v_is_premium, v_limit;
end;
$$ language plpgsql security definer set search_path = public;

-- 14) 2FA réellement imposée pour les actions admin sensibles -------------
create or replace function public.admin_update_user(
  p_target_id uuid,
  p_role user_role default null,
  p_subscription_status subscription_status default null
)
returns void as $$
declare
  v_has_mfa boolean;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs.';
  end if;

  select exists(
    select 1 from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified'
  ) into v_has_mfa;

  if v_has_mfa and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Cette action nécessite la vérification en 2 étapes (2FA) pour cette session. Reconnecte-toi en saisissant ton code.';
  end if;

  update profiles set
    role = coalesce(p_role, role),
    subscription_status = coalesce(p_subscription_status, subscription_status)
  where id = p_target_id;
end;
$$ language plpgsql security definer set search_path = public;

-- 15) Contraintes sur payments ---------------------------------------------
alter table payments add constraint payments_amount_positive check (amount_fcfa > 0);
alter table payments add constraint payments_type_check check (type in ('premium', 'tutoring'));
alter table payments add constraint payments_status_check check (status in ('pending', 'completed', 'failed'));
-- Si ces contraintes existent déjà (base créée avec le nouveau
-- schema.sql directement), ignore l'erreur "already exists".
