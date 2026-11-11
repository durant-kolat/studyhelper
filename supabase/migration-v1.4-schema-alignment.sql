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
