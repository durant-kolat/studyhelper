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
