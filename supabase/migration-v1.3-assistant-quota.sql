-- ============================================================
-- MIGRATION V1.3 — Quota IA fiable + durcissement des fonctions RPC
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
-- Fonctionne sur une base existante (V1.1 / V1.2 déjà appliquées).
--
-- Ce que ça corrige :
--   1) Le quota est compté par JOUR LOCAL de l'utilisateur (fuseau de
--      profiles.timezone, remise à zéro à minuit local) au lieu d'une
--      fenêtre glissante de 24 h.
--   2) Une requête IA qui échoue techniquement (API IA en panne, réponse
--      illisible…) peut être REMBOURSÉE : release_usage() retire la ligne
--      comptabilisée — l'utilisateur ne perd pas une question à cause
--      d'une panne.
--   3) get_usage_status() permet d'afficher « 8/10 » sans consommer de
--      quota (lecture seule, calculée côté serveur).
--   4) Les fonctions security definer ci-dessous n'étaient exécutables
--      QUE par la clé service_role dans l'intention du code, mais Supabase
--      donne par défaut EXECUTE à anon/authenticated : n'importe quel
--      utilisateur pouvait appeler add_xp(), award_badge(),
--      check_and_log_usage() ou record_login_result() directement depuis
--      son navigateur (XP infinis, quota d'un autre utilisateur brûlé,
--      compteur anti-brute-force remis à zéro…). On retire ce droit.

-- 0) Colonnes / index nécessaires -------------------------------------------
alter table profiles add column if not exists timezone text not null default 'Africa/Douala';
-- NOTE : la table utilisée pour le quota s'appelle quota_usage sur ta
-- base (colonnes owner_id, action, created_at) — pas ai_usage_log, qui
-- est une AUTRE table (colonne user_id, sans rapport avec le quota).
-- Table du compteur (absente des versions précédentes de ce dépôt : sans elle,
-- les fonctions ci-dessous échouaient sur une base neuve).
create table if not exists quota_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  action text not null default 'assistant',
  created_at timestamptz not null default now()
);
alter table quota_usage add column if not exists action text not null default 'assistant';
create index if not exists quota_usage_owner_action_created_idx
  on quota_usage (owner_id, action, created_at desc);

-- 1) Fonctions utilitaires ---------------------------------------------------
create or replace function public.user_is_premium(p_owner_id uuid)
returns boolean as $$
  select coalesce(
    (select subscription_status = 'premium'
            and (subscription_expires_at is null or subscription_expires_at > now())
     from profiles where id = p_owner_id),
    false
  );
$$ language sql stable security definer set search_path = public;

-- Début du jour LOCAL de l'utilisateur (minuit dans son fuseau), en timestamptz.
-- Un fuseau invalide en base retombe sur Africa/Douala au lieu de planter.
create or replace function public.user_day_start(p_owner_id uuid)
returns timestamptz as $$
declare
  v_tz text;
begin
  select coalesce(timezone, 'Africa/Douala') into v_tz from profiles where id = p_owner_id;
  v_tz := coalesce(v_tz, 'Africa/Douala');
  begin
    return date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  exception when others then
    return date_trunc('day', now() at time zone 'Africa/Douala') at time zone 'Africa/Douala';
  end;
end;
$$ language plpgsql stable security definer set search_path = public;

-- 2) Vérifier ET comptabiliser (atomique) -------------------------------------
-- Le type de retour change (colonnes used + usage_id ajoutées) : on doit
-- d'abord supprimer l'ancienne version.
drop function if exists public.check_and_log_usage(uuid, text, int, int);

create function public.check_and_log_usage(
  p_owner_id uuid,
  p_action text,
  p_free_limit int,
  p_premium_limit int
)
returns table(allowed boolean, is_premium boolean, usage_limit int, used int, usage_id uuid) as $$
declare
  v_is_premium boolean;
  v_limit int;
  v_count int;
  v_new_id uuid;
begin
  -- Verrou propre à la transaction sur utilisateur+action : deux requêtes
  -- simultanées (double clic, deux onglets) passent l'une après l'autre.
  perform pg_advisory_xact_lock(hashtext(p_owner_id::text || ':' || p_action));

  v_is_premium := public.user_is_premium(p_owner_id);
  v_limit := case when v_is_premium then p_premium_limit else p_free_limit end;

  select count(*) into v_count
  from quota_usage l
  where l.owner_id = p_owner_id
    and l.action = p_action
    and l.created_at >= public.user_day_start(p_owner_id);

  if v_count >= v_limit then
    return query select false, v_is_premium, v_limit, v_count, null::uuid;
    return;
  end if;

  insert into quota_usage (owner_id, action) values (p_owner_id, p_action)
  returning id into v_new_id;

  return query select true, v_is_premium, v_limit, v_count + 1, v_new_id;
end;
$$ language plpgsql security definer set search_path = public;

-- 3) Lecture seule du compteur (pour afficher « 8/10 ») ------------------------
create or replace function public.get_usage_status(
  p_owner_id uuid,
  p_action text,
  p_free_limit int,
  p_premium_limit int
)
returns table(is_premium boolean, usage_limit int, used int) as $$
declare
  v_is_premium boolean;
  v_limit int;
  v_count int;
begin
  v_is_premium := public.user_is_premium(p_owner_id);
  v_limit := case when v_is_premium then p_premium_limit else p_free_limit end;

  select count(*) into v_count
  from quota_usage l
  where l.owner_id = p_owner_id
    and l.action = p_action
    and l.created_at >= public.user_day_start(p_owner_id);

  return query select v_is_premium, v_limit, v_count;
end;
$$ language plpgsql stable security definer set search_path = public;

-- 4) Remboursement d'une requête échouée ---------------------------------------
-- Ne rembourse que sa propre ligne, et seulement si elle est récente
-- (15 min) : impossible d'effacer l'historique ancien.
create or replace function public.release_usage(p_owner_id uuid, p_usage_id uuid)
returns boolean as $$
begin
  delete from quota_usage
  where id = p_usage_id
    and owner_id = p_owner_id
    and created_at > now() - interval '15 minutes';
  return found;
end;
$$ language plpgsql security definer set search_path = public;

-- 5) Droits d'exécution : service_role uniquement ------------------------------
revoke all on function public.user_is_premium(uuid) from public, anon, authenticated;
revoke all on function public.user_day_start(uuid) from public, anon, authenticated;
revoke all on function public.check_and_log_usage(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.get_usage_status(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.release_usage(uuid, uuid) from public, anon, authenticated;

grant execute on function public.user_is_premium(uuid) to service_role;
grant execute on function public.user_day_start(uuid) to service_role;
grant execute on function public.check_and_log_usage(uuid, text, int, int) to service_role;
grant execute on function public.get_usage_status(uuid, text, int, int) to service_role;
grant execute on function public.release_usage(uuid, uuid) to service_role;

-- 6) Même durcissement pour les fonctions déjà existantes -----------------------
-- (appelées uniquement par des triggers security definer ou par les routes
-- serveur avec la clé service_role — jamais directement par le navigateur).
-- Les triggers continuent de fonctionner : ils s'exécutent avec les droits
-- du propriétaire de la fonction, pas ceux de l'utilisateur.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.add_xp(uuid, int)',
    'public.award_badge(uuid, text)',
    'public.check_login_allowed(text)',
    'public.record_login_result(text, boolean)'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    exception when undefined_function then
      raise notice 'Fonction % absente de ta base — ignorée.', f;
    end;
  end loop;
end $$;

-- Vérification rapide (facultatif) : cette requête ne doit lister AUCUNE
-- des fonctions ci-dessus avec anon ou authenticated.
-- select routine_name, grantee from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name in ('add_xp','award_badge','check_and_log_usage',
--                        'get_usage_status','release_usage',
--                        'check_login_allowed','record_login_result')
--   and grantee in ('anon','authenticated','PUBLIC');
