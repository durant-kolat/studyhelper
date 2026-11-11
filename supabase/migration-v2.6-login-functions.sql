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
