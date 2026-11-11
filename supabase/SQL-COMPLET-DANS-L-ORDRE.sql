-- =====================================================================================
-- STUDY HELPER — SQL COMPLET DANS L'ORDRE (v1.1 → v3.3) — À COPIER-COLLER DANS SUPABASE
-- Supabase > SQL Editor > New query > colle TOUT > Run.
--
-- Contient les 22 migrations dans l'ordre exact. Chacune est rejouable sans erreur : celles que tu as déjà
-- exécutées sont sans effet, celles qui manquent sont appliquées. Aucune donnée n'est supprimée.
-- PRÉREQUIS : le fichier supabase/schema.sql (tables de base) doit avoir été exécuté une fois.
-- (Le fichier est long : si l'éditeur s'arrête, exécute-le en 2 parties en coupant à une ligne « ===== ».)
-- =====================================================================================


-- ===================== migration-v1.1-security =====================
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


-- ===================== migration-v1.3-assistant-quota =====================
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


-- ===================== migration-v1.4-schema-alignment =====================
-- ============================================================
-- MIGRATION V1.4 — Alignement schéma / base réelle (audit du 22/09/2026)
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
--
-- Contexte : l'audit complet des tables de production a révélé que
-- `groups` n'a pas de colonne `subject`, alors que la création de
-- groupe (app/groups/page.tsx) en envoie une — ce qui faisait échouer
-- TOUTE création de groupe ("column groups.subject does not exist").
-- Ajout additif, sans risque : ne touche à aucune donnée existante.

alter table public.groups add column if not exists subject text;

-- tutoring_offers.format ("en_ligne" / "présentiel") : le code l'utilise
-- pour distinguer les offres de répétition, la colonne n'existait pas.
alter table public.tutoring_offers
  add column if not exists format text not null default 'en_ligne';

-- Champs utilisés par les formulaires opportunités/activités, absents
-- des tables réelles (organisation et contact d'une opportunité,
-- organisateur d'une activité). Ajout additif, sans risque.
alter table public.opportunities add column if not exists organization text;
alter table public.opportunities add column if not exists contact text;
alter table public.activities add column if not exists organizer text;

-- ----------------------------------------------------------------------
-- Gamification (award_badge / trigger sur exam_results) : award_badge()
-- insérait dans user_badges avec la colonne owner_id, qui n'existe pas
-- sur ta table réelle (elle a user_id). Comme ce trigger se déclenche
-- APRÈS CHAQUE soumission d'examen ou de quiz (y compris le tout premier
-- de chaque utilisateur, cas très fréquent), l'erreur SQL faisait
-- échouer l'insertion complète du résultat — l'élève voyait son examen
-- corrigé, mais le résultat ne s'enregistrait jamais.
create or replace function public.award_badge(p_owner_id uuid, p_badge_key text)
returns void as $$
begin
  insert into user_badges (user_id, badge_key)
  values (p_owner_id, p_badge_key)
  on conflict do nothing;
end;
$$ language plpgsql security definer set search_path = public;

-- Filet de sécurité supplémentaire : même si un futur souci apparaît
-- dans le calcul des badges/XP, il ne doit JAMAIS empêcher l'examen
-- de l'élève d'être enregistré.
create or replace function public.handle_exam_result_inserted()
returns trigger as $$
declare
  exam_count int;
  high_score_count int;
begin
  begin
    perform public.add_xp(new.owner_id, greatest(round(new.score_percent / 5.0)::int, 1));

    select count(*) into exam_count from exam_results where owner_id = new.owner_id;
    if exam_count = 1 then
      perform public.award_badge(new.owner_id, 'first_exam');
    end if;

    if new.score_percent = 100 then
      perform public.award_badge(new.owner_id, 'perfect_score');
    end if;

    select count(*) into high_score_count
    from exam_results where owner_id = new.owner_id and score_percent >= 80;
    if high_score_count >= 5 then
      perform public.award_badge(new.owner_id, 'high_achiever');
    end if;
  exception when others then
    raise warning 'handle_exam_result_inserted: %', sqlerrm;
  end;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Même bug, même correctif : ce trigger se déclenche à CHAQUE import de
-- cours (dont le tout premier de chaque utilisateur, cas très fréquent).
-- Sans ce correctif, l'insertion de la ligne "courses" échouait
-- silencieusement — c'est une cause probable des échecs d'import de
-- cours que tu observais, même après la correction des colonnes.
create or replace function public.handle_course_inserted()
returns trigger as $$
declare
  course_count int;
begin
  begin
    perform public.add_xp(new.owner_id, 5);
    select count(*) into course_count from courses where owner_id = new.owner_id;
    if course_count = 1 then
      perform public.award_badge(new.owner_id, 'first_course');
    end if;
  exception when others then
    raise warning 'handle_course_inserted: %', sqlerrm;
  end;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Même bug, même correctif : bloquait aussi la création d'un groupe et
-- le fait d'en rejoindre un (la ligne group_members n'était jamais créée).
create or replace function public.handle_group_member_inserted()
returns trigger as $$
declare
  membership_count int;
begin
  begin
    perform public.add_xp(new.user_id, 5);
    select count(*) into membership_count from group_members where user_id = new.user_id;
    if membership_count = 1 then
      perform public.award_badge(new.user_id, 'group_joiner');
    end if;
  exception when others then
    raise warning 'handle_group_member_inserted: %', sqlerrm;
  end;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ----------------------------------------------------------------------
-- Anti-brute-force (login_attempts) : les fonctions check_login_allowed
-- et record_login_result référençaient des colonnes qui n'existent pas
-- sur ta table réelle (identifier, locked_until, attempt_count) — elle
-- n'a que (id, email, success, created_at), un simple journal. Résultat :
-- ces fonctions échouaient silencieusement à chaque connexion (l'erreur
-- est ignorée côté route), donc AUCUNE protection anti-brute-force
-- n'était réellement appliquée. Réécrites pour calculer le verrouillage
-- directement à partir du journal, sans changer la table.
create or replace function public.check_login_allowed(p_email text)
returns table(allowed boolean, seconds_left int) as $$
declare
  v_count int;
  v_oldest timestamptz;
begin
  select count(*), min(created_at) into v_count, v_oldest
  from login_attempts
  where email = p_email
    and success = false
    and created_at > now() - interval '2 minutes';

  if v_count >= 5 then
    return query select
      false,
      greatest(0, ceil(extract(epoch from (v_oldest + interval '2 minutes' - now())))::int);
    return;
  end if;

  return query select true, 0;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.record_login_result(p_email text, p_success boolean)
returns void as $$
begin
  insert into login_attempts (email, success) values (p_email, p_success);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.check_login_allowed(text) to service_role;
grant execute on function public.record_login_result(text, boolean) to service_role;
revoke all on function public.check_login_allowed(text) from public, anon, authenticated;
revoke all on function public.record_login_result(text, boolean) from public, anon, authenticated;


-- ===================== migration-v1.5-group-planning =====================
-- ============================================================
-- MIGRATION V1.5 — Planning partagé des groupes d'étude
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
--
-- Ajoute la table utilisée par le nouvel onglet « Planning » d'un groupe :
-- une séance de révision partagée (date, heure, matière), visible et
-- modifiable par tous les membres du groupe.

create table if not exists public.group_schedule_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  subject text,
  item_date date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists group_schedule_items_group_date_idx
  on public.group_schedule_items (group_id, item_date, start_time);

alter table public.group_schedule_items enable row level security;

-- ----------------------------------------------------------------------
-- Ajout direct d'un membre par le propriétaire du groupe.
-- Jusqu'ici, la règle de sécurité (RLS) sur group_members n'autorisait
-- que "je m'ajoute moi-même" — un propriétaire ne pouvait pas ajouter
-- quelqu'un d'autre, quelle que soit l'interface construite dessus.
drop policy if exists "Un utilisateur rejoint un groupe pour lui-même" on public.group_members;
create policy "Rejoindre soi-même ou être ajouté par le propriétaire"
  on public.group_members for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.groups g
      where g.id = group_members.group_id and g.owner_id = auth.uid()
    )
  );

-- Recherche d'un utilisateur par son nom, pour l'inviter dans un groupe.
-- Chaque profil n'étant lisible que par son propre propriétaire (RLS),
-- une recherche directe sur "profiles" ne renverrait jamais personne
-- d'autre. Cette fonction expose UNIQUEMENT id + nom (rien de sensible :
-- ni l'abonnement, ni l'e-mail, ni le rôle), pour les membres connectés.
create or replace function public.search_profiles(query text)
returns table(id uuid, full_name text) as $$
  select id, full_name from public.profiles
  where full_name ilike '%' || query || '%'
  order by full_name
  limit 10;
$$ language sql stable security definer set search_path = public;

revoke all on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;


drop policy if exists "Membres du groupe lisent le planning" on public.group_schedule_items;
create policy "Membres du groupe lisent le planning"
  on public.group_schedule_items for select
  using (
    exists (
      select 1 from public.group_members m
      where m.group_id = group_schedule_items.group_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Membres du groupe ajoutent une séance" on public.group_schedule_items;
create policy "Membres du groupe ajoutent une séance"
  on public.group_schedule_items for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.group_members m
      where m.group_id = group_schedule_items.group_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Auteur ou owner supprime une séance" on public.group_schedule_items;
create policy "Auteur ou owner supprime une séance"
  on public.group_schedule_items for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.groups g
      where g.id = group_schedule_items.group_id and g.owner_id = auth.uid()
    )
  );


-- ===================== migration-v1.6-group-access =====================
-- ============================================================
-- MIGRATION V1.6 — Accès annuel payant aux groupes d'étude
-- ============================================================
-- À exécuter APRÈS les migrations V1.4 et V1.5 (rejouable sans risque).
--
-- Règles :
--   * Créer un groupe reste GRATUIT (le créateur est membre "owner").
--   * Entrer dans un groupe (en tant que membre) = un paiement, valable
--     un an, renouvelable.
--   * Les membres déjà présents avant cette migration gardent leur accès
--     (expires_at reste NULL = pas d'expiration).
--   * Une personne ajoutée par le propriétaire doit aussi payer avant
--     d'entrer (son accès démarre expiré).
--   * Le paiement confirmé par Monetbil (webhook, clé service) est le
--     seul moyen d'obtenir un accès actif.
--
-- Cette migration ne fait pas confiance aux noms de politiques de ta
-- base : ils ont divergé du schéma d'origine. Elle supprime par boucle
-- les politiques d'écriture/lecture existantes des tables de groupe et
-- les recrée proprement.

alter table public.group_members add column if not exists expires_at timestamptz;

-- Accès actif = membre, et (pas d'expiration OU expiration future).
create or replace function public.is_active_group_member(p_group_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
      and (m.expires_at is null or m.expires_at > now())
  );
$$ language sql stable security definer set search_path = public;

revoke all on function public.is_active_group_member(uuid) from public, anon;
grant execute on function public.is_active_group_member(uuid) to authenticated;

-- Un membre ajouté depuis un navigateur (auth.uid() non nul) autre que
-- "owner" démarre TOUJOURS expiré : impossible de s'offrir un accès
-- gratuit (ni au propriétaire d'en offrir). Le webhook (clé service,
-- auth.uid() nul) fixe la vraie date d'expiration après paiement.
create or replace function public.force_expired_membership()
returns trigger as $$
begin
  if auth.uid() is not null and new.role <> 'owner' then
    new.expires_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists group_members_force_expired on public.group_members;
create trigger group_members_force_expired
  before insert on public.group_members
  for each row execute procedure public.force_expired_membership();

-- Suppression par boucle des anciennes politiques (quel que soit leur nom).
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'group_members' and cmd in ('INSERT', 'UPDATE', 'ALL'))
        or (tablename in ('group_messages', 'group_documents', 'group_questions',
                          'group_answers', 'group_schedule_items')
            and cmd in ('SELECT', 'INSERT', 'ALL'))
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- group_members : seul le propriétaire du groupe peut insérer (soi-même
-- comme owner à la création, ou une autre personne). Les adhésions payées
-- passent par le webhook (clé service, qui contourne RLS).
create policy "Le propriétaire ajoute des membres"
  on public.group_members for insert
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_members.group_id and g.owner_id = auth.uid()
    )
  );

drop policy if exists "Lecture des membres" on public.group_members;
create policy "Lecture des membres"
  on public.group_members for select using (auth.uid() is not null);

drop policy if exists "Un utilisateur quitte un groupe" on public.group_members;
create policy "Un utilisateur quitte un groupe"
  on public.group_members for delete using (auth.uid() = user_id);

-- Contenus du groupe : réservés aux membres à accès ACTIF.
create policy "Membres actifs lisent les messages"
  on public.group_messages for select using (public.is_active_group_member(group_id));
create policy "Membres actifs envoient des messages"
  on public.group_messages for insert
  with check (user_id = auth.uid() and public.is_active_group_member(group_id));

create policy "Membres actifs voient les documents"
  on public.group_documents for select using (public.is_active_group_member(group_id));
create policy "Membres actifs partagent un de leurs cours"
  on public.group_documents for insert
  with check (
    shared_by = auth.uid()
    and public.is_active_group_member(group_id)
    and course_id in (select id from public.courses where owner_id = auth.uid())
  );

create policy "Membres actifs voient les questions"
  on public.group_questions for select using (public.is_active_group_member(group_id));
create policy "Membres actifs posent une question"
  on public.group_questions for insert
  with check (author_id = auth.uid() and public.is_active_group_member(group_id));

create policy "Membres actifs voient les réponses"
  on public.group_answers for select using (public.is_active_group_member(group_id));
create policy "Membres actifs répondent"
  on public.group_answers for insert
  with check (
    author_id = auth.uid()
    and public.is_active_group_member(group_id)
    and question_id in (
      select gq.id from public.group_questions gq where gq.group_id = group_answers.group_id
    )
  );

create policy "Membres actifs lisent le planning"
  on public.group_schedule_items for select using (public.is_active_group_member(group_id));
create policy "Membres actifs ajoutent une séance"
  on public.group_schedule_items for insert
  with check (created_by = auth.uid() and public.is_active_group_member(group_id));


-- ===================== migration-v1.7-exams-fix =====================
-- ============================================================
-- MIGRATION V1.7 — Correctifs generated_exams / exam_results / courses
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
--
-- Erreur A : « Could not find the 'weak_subjects' column of 'generated_exams'
--            in the schema cache » (Grand Quiz de la semaine)
-- Erreur B : « record "new" has no field "percent" » (fin d'un examen :
--            un trigger/une fonction de ta base réelle lit NEW.percent alors
--            que la colonne s'appelle score_percent sur exam_results)
-- Nouveau  : courses.content_text — texte ORIGINAL extrait du document
--            (affiché tel quel dans la Bibliothèque, et donné à l'IA).

-- 1) generated_exams : colonnes manquantes --------------------------------
-- weak_subjects en jsonb (comme dans schema.sql) : PostgREST y écrit
-- directement le tableau JS de matières ; null est géré côté code (?? []).
alter table public.generated_exams add column if not exists weak_subjects jsonb;
alter table public.generated_exams add column if not exists percent integer;

-- 2) exam_results : colonne `percent` de compatibilité ---------------------
-- Colonne calculée = score_percent. Toute ancienne fonction qui lit
-- NEW.percent fonctionne à nouveau, sans rien dupliquer ni désynchroniser.
alter table public.exam_results
  add column if not exists percent integer generated always as (score_percent) stored;

-- 3) Trigger XP/badges : réécrit avec score_percent, jamais bloquant -------
create or replace function public.handle_exam_result_inserted()
returns trigger as $$
declare
  exam_count int;
  high_score_count int;
  v_score int := coalesce(new.score_percent, 0);
begin
  begin
    perform public.add_xp(new.owner_id, greatest(round(v_score / 5.0)::int, 1));

    select count(*) into exam_count from exam_results where owner_id = new.owner_id;
    if exam_count = 1 then
      perform public.award_badge(new.owner_id, 'first_exam');
    end if;

    if v_score = 100 then
      perform public.award_badge(new.owner_id, 'perfect_score');
    end if;

    select count(*) into high_score_count
    from exam_results where owner_id = new.owner_id and score_percent >= 80;
    if high_score_count >= 5 then
      perform public.award_badge(new.owner_id, 'high_achiever');
    end if;
  exception when others then
    raise warning 'handle_exam_result_inserted: %', sqlerrm;
  end;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_exam_result_inserted on public.exam_results;
create trigger on_exam_result_inserted
  after insert on public.exam_results
  for each row execute procedure public.handle_exam_result_inserted();

-- 4) courses : contenu original du document ---------------------------------
alter table public.courses add column if not exists content_text text;

-- 5) Diagnostic (optionnel) : autres fonctions qui lisent encore NEW.percent
--    → si cette requête renvoie des lignes, corrige-les avec score_percent.
-- select p.proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and pg_get_functiondef(p.oid) ilike '%new.percent%';

-- 6) Recharge le cache de schéma PostgREST (sinon l'erreur A persiste)
notify pgrst, 'reload schema';


-- ===================== migration-v1.8-monetbil-payments =====================
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


-- ===================== migration-v1.9-premium-cards-avatars =====================
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


-- ===================== migration-v2.0-premium-billing =====================
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


-- ===================== migration-v2.1-languages-campay-lygos =====================
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


-- ===================== migration-v2.2-full-languages-translation =====================
-- v2.2 — Langues complètes + traduction du contenu importé.
--
-- 1) La migration v2.1 limitait preferred_language à 8 codes ('fr','en','de',
--    'es','it','pt','ar','zh') via une contrainte CHECK. L'application
--    propose maintenant 14 langues (ajout de nl, ru, tr, ja, ko, hi) : sans
--    cette migration, choisir l'une de ces nouvelles langues dans les
--    Paramètres échoue silencieusement à l'enregistrement (la contrainte
--    rejette la mise à jour), même si l'interface affiche déjà l'option.
--
-- 2) Ajoute deux colonnes à `courses` pour mettre en cache la traduction du
--    texte original d'un document (content_text) dans la langue actuellement
--    choisie par l'utilisateur. Le texte ORIGINAL n'est jamais modifié ; la
--    traduction est un cache à part, régénéré si l'utilisateur change de
--    langue d'application.

alter table public.profiles drop constraint if exists profiles_preferred_language_check;

alter table public.profiles
  add constraint profiles_preferred_language_check
  check (preferred_language is null or preferred_language in
    ('fr', 'en', 'de', 'es', 'it', 'pt', 'ar', 'zh', 'nl', 'ru', 'tr', 'ja', 'ko', 'hi'));

alter table public.courses add column if not exists content_translated text;
alter table public.courses add column if not exists content_translated_lang text;

comment on column public.courses.content_translated is
  'Traduction mise en cache de content_text dans content_translated_lang ; régénérée à la demande (voir /api/translate-course). Le document original (content_text, file_path) n''est jamais modifié.';
comment on column public.courses.content_translated_lang is
  'Code de langue (voir lib/i18n/languages.ts) de content_translated ; null tant qu''aucune traduction n''a été demandée.';


-- ===================== migration-v2.3-ai-tutor =====================
-- ============================================================
-- MIGRATION V2.3 — Professeur IA + suivi de consommation Gemini
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur, additive :
-- ne modifie, ne supprime et ne réinitialise AUCUNE donnée existante).
-- Prérequis : tables profiles et courses (déjà présentes). Aucune autre fonction requise.
--
-- Les quotas de séances (tutor, voice-session, summary) réutilisent le mécanisme EXISTANT
-- check_and_log_usage / quota_usage : aucune nouvelle fonction de quota n'est nécessaire.

-- 1) Progression pédagogique ---------------------------------------------------
-- Pas de copie du cours : seul l'index du paragraphe est conservé (le découpage est déterministe).
create table if not exists tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped', 'completed')),
  paragraph_index int not null default 0 check (paragraph_index >= 0),
  max_index int not null default 0 check (max_index >= 0),       -- plus loin atteint (retours en arrière autorisés jusque-là)
  paragraph_count int not null default 0,
  attempts int not null default 0,                                -- tentatives non réussies sur le paragraphe courant
  current_question text,                                          -- question posée (conservée côté serveur : non falsifiable)
  turns int not null default 0,                                   -- appels IA de la séance (plafonné côté serveur)
  voice_counted boolean not null default false,                   -- séance vocale déjà comptée (une fois par séance)
  summary_used boolean not null default false,
  weak_notions jsonb not null default '[]'::jsonb,                -- notions à revoir (courtes)
  final_result jsonb,                                             -- résumé / notions / mini-test (mis en cache)
  language text,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists tutor_sessions_owner_course_idx on tutor_sessions (owner_id, course_id, last_activity_at desc);
alter table tutor_sessions enable row level security;
drop policy if exists "Un utilisateur consulte ses séances" on tutor_sessions;
create policy "Un utilisateur consulte ses séances" on tutor_sessions for select using (auth.uid() = owner_id);
-- Aucune policy d'écriture : seules les routes serveur (service_role) écrivent — le client ne peut pas
-- se donner du « paragraphe suivant » ni réinitialiser ses tentatives.

-- 2) Journal de consommation Gemini --------------------------------------------
create table if not exists ai_cost_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  feature text not null,                       -- ex. tutor-teach, tutor-answer, tutor-ask, tutor-final
  model text,
  prompt_tokens int,                           -- null si l'API ne l'a pas fourni
  output_tokens int,
  total_tokens int,
  est_cost numeric(14,8),                      -- null si les tarifs ne sont pas configurés
  status text not null default 'ok' check (status in ('ok', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists ai_cost_log_owner_created_idx on ai_cost_log (owner_id, created_at desc);
alter table ai_cost_log enable row level security;
drop policy if exists "Un utilisateur consulte sa consommation" on ai_cost_log;
create policy "Un utilisateur consulte sa consommation" on ai_cost_log for select using (auth.uid() = owner_id);

-- 3) Consommation du jour local et des 30 derniers jours (lecture seule) --------
-- AUTONOME : ne dépend d'aucune autre fonction (user_is_premium / user_day_start de la V1.3 ne sont pas requises).
-- Même règle que l'existant : Premium = statut 'premium' ET non expiré ; jour local = minuit dans le fuseau du profil
-- (repli Africa/Douala si le fuseau est absent ou invalide).
create or replace function public.ai_budget_usage(p_owner_id uuid)
returns table(is_premium boolean, day_tokens bigint, month_tokens bigint) as $$
declare
  v_tz text := 'Africa/Douala';
  v_day timestamptz;
  v_prem boolean := false;
begin
  begin
    select coalesce(p.timezone, 'Africa/Douala') into v_tz from profiles p where p.id = p_owner_id;
  exception when others then
    v_tz := 'Africa/Douala';
  end;
  v_tz := coalesce(v_tz, 'Africa/Douala');
  begin
    v_day := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  exception when others then
    v_day := date_trunc('day', now() at time zone 'Africa/Douala') at time zone 'Africa/Douala';
  end;
  begin
    select coalesce(p.subscription_status = 'premium' and (p.subscription_expires_at is null or p.subscription_expires_at > now()), false)
      into v_prem from profiles p where p.id = p_owner_id;
  exception when others then
    v_prem := false;
  end;
  return query
    select coalesce(v_prem, false),
           coalesce(sum(l.total_tokens) filter (where l.created_at >= v_day), 0)::bigint,
           coalesce(sum(l.total_tokens), 0)::bigint
    from ai_cost_log l
    where l.owner_id = p_owner_id and l.created_at >= now() - interval '30 days';
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function public.ai_budget_usage(uuid) from public, anon, authenticated;
grant execute on function public.ai_budget_usage(uuid) to service_role;


-- ===================== migration-v2.4-content-text =====================
-- Ajoute la colonne qui stocke le texte extrait d'un document (déjà prévue par la migration v1.7).
-- À exécuter dans Supabase > SQL Editor. Sans danger si la colonne existe déjà.
alter table public.courses add column if not exists content_text text;

-- Colonnes de traduction en cache (migration v2.2) : même précaution.
alter table public.courses add column if not exists content_translated text;
alter table public.courses add column if not exists content_translated_lang text;

-- Recharge le cache du schéma pour que l'API voie tout de suite les nouvelles colonnes.
notify pgrst, 'reload schema';


-- ===================== migration-v2.5-more-languages =====================
-- Autorise toutes les langues de l'application (53) dans le profil.
-- À exécuter dans Supabase > SQL Editor. Sans danger si déjà exécuté.
alter table public.profiles drop constraint if exists profiles_preferred_language_check;

alter table public.profiles
  add constraint profiles_preferred_language_check
  check (preferred_language is null or preferred_language in
    ('fr', 'en', 'de', 'es', 'it', 'pt', 'ar', 'zh', 'nl', 'ru', 'tr', 'ja', 'ko', 'hi', 'pl', 'uk', 'ro', 'el', 'cs', 'sv', 'da', 'fi', 'no', 'hu', 'bg', 'hr', 'sk', 'id', 'ms', 'vi', 'th', 'fil', 'bn', 'ur', 'fa', 'ta', 'te', 'mr', 'he', 'ne', 'sw', 'af', 'am', 'zu', 'ha', 'yo', 'ig', 'so', 'rw', 'mg', 'sn', 'ln', 'wo'));

notify pgrst, 'reload schema';


-- ===================== migration-v2.6-login-functions =====================
-- ============================================================
-- MIGRATION V2.6 — Anti-brute-force : définitions RÉELLES de la base
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable ; sur ta base actuelle les deux
-- fonctions sont déjà identiques : aucun changement de comportement, rien n'est supprimé).
--
-- Fonctions telles qu'elles existent en production :
--   check_login_allowed(p_email text)                 -> boolean  (vrai = connexion autorisée : moins de 5 échecs en 2 min)
--   record_login_result(p_email text, p_success bool) -> void     (succès = remise à zéro ; échec = +1 ; purge à 1 jour)
-- Le code (lib/login-guard.ts) accepte ce retour booléen.

-- Colonnes attendues (ajoutées seulement si absentes) + index de comptage.
alter table public.login_attempts add column if not exists email text;
alter table public.login_attempts add column if not exists success boolean not null default false;
alter table public.login_attempts add column if not exists created_at timestamptz not null default now();
create index if not exists login_attempts_email_created_idx
  on public.login_attempts (email, created_at desc);

create or replace function public.check_login_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*) < 5 from public.login_attempts
   where email = lower(p_email) and success = false and created_at > now() - interval '2 minutes';
$function$;

create or replace function public.record_login_result(p_email text, p_success boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_success then
    delete from public.login_attempts where email = lower(p_email);
  else
    insert into public.login_attempts (email, success) values (lower(p_email), false);
  end if;
  delete from public.login_attempts where created_at < now() - interval '1 day';
end $function$;

-- Réservées au serveur (clé service_role) : jamais exposées à anon / authenticated.
grant execute on function public.check_login_allowed(text) to service_role;
grant execute on function public.record_login_result(text, boolean) to service_role;
revoke all on function public.check_login_allowed(text) from public, anon, authenticated;
revoke all on function public.record_login_result(text, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';


-- ===================== migration-v2.7-smart-planning =====================
-- v2.7 — Planning intelligent : alignement de schedule_items + mémorisation du questionnaire.
-- À EXÉCUTER MANUELLEMENT (SQL Editor Supabase). Idempotent : peut être rejoué sans risque.
-- Raison : le code (page, tableau de bord, rappels push) lit start_time/end_time/title/subject/is_exam
-- alors que schema.sql ne définit que time/label/item_type. Aucune migration n'ajoutait les premières,
-- donc les insertions pouvaient échouer silencieusement et le planning se perdait à l'actualisation.
-- Aucune donnée n'est supprimée ; aucune politique RLS n'est désactivée.

alter table public.schedule_items add column if not exists start_time text;
alter table public.schedule_items add column if not exists end_time text;
alter table public.schedule_items add column if not exists title text;
alter table public.schedule_items add column if not exists subject text;
alter table public.schedule_items add column if not exists is_exam boolean not null default false;
alter table public.schedule_items add column if not exists completed boolean not null default false;
alter table public.schedule_items add column if not exists kind text;
alter table public.schedule_items add column if not exists priority text;
alter table public.schedule_items add column if not exists objective text;
alter table public.schedule_items add column if not exists objective_kind text;
alter table public.schedule_items add column if not exists is_study boolean not null default false;
alter table public.schedule_items add column if not exists status text not null default 'todo';
alter table public.schedule_items add column if not exists started_at timestamptz;
alter table public.schedule_items add column if not exists completed_at timestamptz;
alter table public.schedule_items add column if not exists actual_minutes int;
alter table public.schedule_items add column if not exists batch_id uuid;

-- Anciennes colonnes : on les garde (données existantes) mais elles ne doivent plus bloquer les insertions.
do $$
declare c text;
begin
  foreach c in array array['time','label','item_type'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'schedule_items' and column_name = c) then
      execute format('alter table public.schedule_items alter column %I drop not null', c);
    end if;
  end loop;
end $$;

-- Rattrapage des anciennes lignes (uniquement là où la nouvelle colonne est vide).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='schedule_items' and column_name='time') then
    update public.schedule_items set start_time = "time" where start_time is null and "time" is not null;
    update public.schedule_items set end_time = start_time where end_time is null and start_time is not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='schedule_items' and column_name='label') then
    update public.schedule_items set title = label where title is null and label is not null;
  end if;
  update public.schedule_items set status = 'done' where completed = true and status = 'todo';
end $$;

create index if not exists idx_schedule_items_owner_date_start
  on public.schedule_items (owner_id, item_date, start_time);

-- RLS déjà active sur schedule_items (voir schema.sql) : on la réaffirme sans la modifier.
alter table public.schedule_items enable row level security;

-- Réponses du questionnaire, une ligne par utilisateur.
create table if not exists public.schedule_profiles (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.schedule_profiles enable row level security;

drop policy if exists "schedule_profiles_select_own" on public.schedule_profiles;
create policy "schedule_profiles_select_own" on public.schedule_profiles
  for select using (auth.uid() = owner_id);
drop policy if exists "schedule_profiles_insert_own" on public.schedule_profiles;
create policy "schedule_profiles_insert_own" on public.schedule_profiles
  for insert with check (auth.uid() = owner_id);
drop policy if exists "schedule_profiles_update_own" on public.schedule_profiles;
create policy "schedule_profiles_update_own" on public.schedule_profiles
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "schedule_profiles_delete_own" on public.schedule_profiles;
create policy "schedule_profiles_delete_own" on public.schedule_profiles
  for delete using (auth.uid() = owner_id);

-- Recharge du cache de schéma PostgREST (évite « column not found in the schema cache »).
notify pgrst, 'reload schema';


-- ===================== migration-v2.8-ad-settings =====================
-- v2.8 — Réglages publicitaires (page /admin/ads).
-- À EXÉCUTER MANUELLEMENT (SQL Editor Supabase). Idempotent : peut être rejoué sans risque.
-- Pourquoi UNE table : les interrupteurs de l'administrateur (emplacements, pages, formats) doivent survivre
-- aux rechargements et s'appliquer à tous les visiteurs ; les variables d'environnement ne sont pas modifiables
-- depuis l'application. Une seule ligne (id = 'global'), un seul objet JSON : aucune colonne par réglage.
-- Aucune donnée existante n'est modifiée ni supprimée ; aucune politique RLS existante n'est touchée.
-- Contenu NON secret : lecture publique (la page d'accueil est visible sans connexion) ; écriture réservée
-- aux administrateurs par RLS (public.is_admin()). Aucune politique de suppression : la ligne ne peut pas être effacée.
-- Aucun identifiant publicitaire n'est stocké ici : ils vivent dans les variables d'environnement.

create table if not exists public.ad_settings (
  id text primary key default 'global' check (id = 'global'),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 20000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.ad_settings enable row level security;

drop policy if exists ad_settings_read on public.ad_settings;
create policy ad_settings_read on public.ad_settings
  for select to anon, authenticated using (true);

drop policy if exists ad_settings_admin_insert on public.ad_settings;
create policy ad_settings_admin_insert on public.ad_settings
  for insert to authenticated with check (public.is_admin());

drop policy if exists ad_settings_admin_update on public.ad_settings;
create policy ad_settings_admin_update on public.ad_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Ligne par défaut : {} = « valeurs par défaut du code » (tout activé, promotion maison). Ne remplace jamais une ligne existante.
insert into public.ad_settings (id) values ('global') on conflict (id) do nothing;

-- Vérification rapide (facultatif) : avec un compte NON admin, cette requête doit échouer / mettre 0 ligne à jour :
--   update public.ad_settings set config = '{"globalEnabled": false}' where id = 'global';


-- ===================== migration-v2.9-exam-analysis =====================
-- Study Helper v2.9 — Analyse pédagogique IA des examens + chat contextuel par question.
-- ADDITIVE : ne touche à aucune donnée existante. À exécuter dans Supabase > SQL Editor.
-- Écriture réservée au serveur (clé service_role) : le navigateur ne peut que LIRE ses propres lignes (RLS).

create table if not exists public.exam_analyses (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null unique references public.exam_results(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  analysis jsonb,                       -- [{index, errorExplanation, steps[], example, similarExercise, uncertainty}]
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_question_chats (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.exam_results(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  question_index int not null check (question_index >= 0),
  messages jsonb not null default '[]'::jsonb,   -- [{role: 'user'|'assistant', content}]
  updated_at timestamptz not null default now(),
  unique (result_id, question_index)
);

create index if not exists exam_analyses_owner_idx on public.exam_analyses (owner_id);
create index if not exists exam_question_chats_owner_idx on public.exam_question_chats (owner_id);

alter table public.exam_analyses enable row level security;
alter table public.exam_question_chats enable row level security;

drop policy if exists "Lecture de ses analyses d'examen" on public.exam_analyses;
create policy "Lecture de ses analyses d'examen"
  on public.exam_analyses for select using (auth.uid() = owner_id);

drop policy if exists "Lecture de ses conversations de correction" on public.exam_question_chats;
create policy "Lecture de ses conversations de correction"
  on public.exam_question_chats for select using (auth.uid() = owner_id);

-- Aucune policy insert/update/delete : seules les routes serveur (service_role) écrivent.


-- ===================== migration-v3.0-assistant-memory =====================
-- Study Helper v3.0 — Historique des conversations du chat global + mémoire pédagogique CONTRÔLÉE par l'élève.
-- ADDITIVE. À exécuter dans Supabase > SQL Editor. Chaque élève ne voit/modifie QUE ses propres lignes (RLS).

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Conversation' check (char_length(title) <= 120),
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 200 and pg_column_size(messages) <= 600000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_conversations_owner_idx on public.assistant_conversations (owner_id, updated_at desc);

create table if not exists public.learner_memory (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  personalization_enabled boolean not null default true,   -- false = l'IA n'utilise AUCUNE information de cette fiche
  history_enabled boolean not null default true,           -- false = les conversations ne sont plus enregistrées
  display_name text check (display_name is null or char_length(display_name) <= 60),
  study_level text check (study_level is null or char_length(study_level) <= 80),
  subjects text check (subjects is null or char_length(subjects) <= 200),
  goals text check (goals is null or char_length(goals) <= 300),
  learning_prefs text check (learning_prefs is null or char_length(learning_prefs) <= 300),
  updated_at timestamptz not null default now()
);

alter table public.assistant_conversations enable row level security;
alter table public.learner_memory enable row level security;

drop policy if exists "Ses conversations : lecture" on public.assistant_conversations;
drop policy if exists "Ses conversations : création" on public.assistant_conversations;
drop policy if exists "Ses conversations : mise à jour" on public.assistant_conversations;
drop policy if exists "Ses conversations : suppression" on public.assistant_conversations;
create policy "Ses conversations : lecture" on public.assistant_conversations for select using (auth.uid() = owner_id);
create policy "Ses conversations : création" on public.assistant_conversations for insert with check (auth.uid() = owner_id);
create policy "Ses conversations : mise à jour" on public.assistant_conversations for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Ses conversations : suppression" on public.assistant_conversations for delete using (auth.uid() = owner_id);

drop policy if exists "Sa mémoire : lecture" on public.learner_memory;
drop policy if exists "Sa mémoire : création" on public.learner_memory;
drop policy if exists "Sa mémoire : mise à jour" on public.learner_memory;
drop policy if exists "Sa mémoire : suppression" on public.learner_memory;
create policy "Sa mémoire : lecture" on public.learner_memory for select using (auth.uid() = owner_id);
create policy "Sa mémoire : création" on public.learner_memory for insert with check (auth.uid() = owner_id);
create policy "Sa mémoire : mise à jour" on public.learner_memory for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Sa mémoire : suppression" on public.learner_memory for delete using (auth.uid() = owner_id);


-- ===================== migration-v3.1-celebrations =====================
-- Study Helper v3.1 — Anniversaires, fêtes et notifications de célébration (FACULTATIF, désactivé par défaut)
-- + correction d'un écart de schéma des notifications push. ADDITIVE / idempotente. À exécuter dans Supabase > SQL Editor.

-- 1) Correctif push : le code (subscribe + send-reminders) utilise user_id et auth ; schema.sql définissait owner_id et auth_key.
--    Sur une base déjà alignée, ce bloc ne fait rien.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_subscriptions' and column_name = 'owner_id') then
    alter table public.push_subscriptions rename column owner_id to user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_subscriptions' and column_name = 'auth_key') then
    alter table public.push_subscriptions rename column auth_key to auth;
  end if;
end $$;

-- 2) Préférences de célébration (opt-in). On ne stocke que le JOUR et le MOIS de naissance (jamais l'année), saisis volontairement.
create table if not exists public.celebration_prefs (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  celebrations_enabled boolean not null default false,        -- interrupteur général
  birthday_enabled boolean not null default false,
  birth_month int check (birth_month between 1 and 12),
  birth_day int check (birth_day between 1 and 31),
  feast_enabled boolean not null default false,               -- fête personnelle (jour choisi par l'élève)
  feast_label text check (feast_label is null or char_length(feast_label) <= 60),
  feast_month int check (feast_month between 1 and 12),
  feast_day int check (feast_day between 1 and 31),
  holidays text[] not null default '{}' check (cardinality(holidays) <= 12),   -- clés de lib/celebrations.ts (dates FIXES uniquement)
  updated_at timestamptz not null default now(),
  check ((birth_month is null) = (birth_day is null)),
  check ((feast_month is null) = (feast_day is null)),
  check (birth_day is null or birth_day <= case birth_month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end),
  check (feast_day is null or feast_day <= case feast_month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)
);

-- 3) Journal anti-doublon : une célébration = une ligne par utilisateur, par clé et par année (contrainte UNIQUE).
create table if not exists public.celebration_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  celebration_key text not null,
  year int not null,
  sent_at timestamptz not null default now(),
  unique (owner_id, celebration_key, year)
);

alter table public.celebration_prefs enable row level security;
alter table public.celebration_log enable row level security;

drop policy if exists "Ses préférences de célébration" on public.celebration_prefs;
create policy "Ses préférences de célébration" on public.celebration_prefs for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Lecture de son journal de célébrations" on public.celebration_log;
create policy "Lecture de son journal de célébrations" on public.celebration_log for select using (auth.uid() = owner_id);
-- Aucune policy d'écriture sur celebration_log : seul le serveur (service_role) y inscrit.


-- ===================== migration-v3.2-exam-open-questions =====================
-- Study Helper v3.2 — Partie B des examens : questions rédigées (texte) et questions à schéma (photo de la solution),
-- notées par l'IA selon un BARÈME explicite. ADDITIVE. À exécuter dans Supabase > SQL Editor (après v3.1).

-- 1) Questions de la Partie B d'un examen généré (barème et corrigé de référence : jamais lisibles par le client avant la soumission).
alter table public.generated_exams add column if not exists open_questions jsonb;

-- 2) Réponses de l'élève et correction, une ligne par question de la Partie B.
create table if not exists public.exam_open_answers (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.exam_results(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  question_index int not null check (question_index between 0 and 9),
  kind text not null check (kind in ('text', 'diagram')),
  question text not null,
  expected_answer text,                                   -- corrigé de référence (affiché APRÈS la soumission)
  rubric jsonb not null default '[]'::jsonb,              -- [{criterion, points}]
  max_points numeric(4,1) not null check (max_points > 0 and max_points <= 10),
  answer_text text check (answer_text is null or char_length(answer_text) <= 6000),
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 3),   -- photos dans le bucket privé « documents »
  status text not null default 'pending' check (status in ('pending', 'grading', 'graded', 'failed')),
  points numeric(4,1) check (points is null or (points >= 0 and points <= 10)),
  feedback jsonb,                                         -- {criteria:[{criterion, awarded, max, comment}], summary, uncertainty}
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (result_id, question_index)
);
create index if not exists exam_open_answers_owner_idx on public.exam_open_answers (owner_id);

alter table public.exam_open_answers enable row level security;
drop policy if exists "Lecture de ses réponses de Partie B" on public.exam_open_answers;
create policy "Lecture de ses réponses de Partie B" on public.exam_open_answers for select using (auth.uid() = owner_id);
-- Aucune policy d'écriture : seules les routes serveur (service_role) créent et corrigent ces lignes.


-- ===================== migration-v3.3-direct-payments =====================
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

