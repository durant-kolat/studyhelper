-- À exécuter dans l'éditeur SQL de ton projet Supabase (Database > SQL Editor)

-- Types de compte
-- Types de compte (élargi au nouveau cahier des charges V1→V4)
create type account_type as enum (
  'eleve_primaire', 'eleve_secondaire', 'etudiant',
  'formation_pro', 'enseignant', 'entreprise'
);
create type subscription_status as enum ('free', 'premium');

-- Profil, lié à l'utilisateur Supabase Auth (auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  account_type account_type not null default 'eleve_secondaire',
  subscription_status subscription_status not null default 'free',
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Un profil est créé automatiquement à l'inscription
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, account_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'account_type')::account_type, 'eleve_secondaire')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Documents / cours importés
create table courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  subject text not null,
  file_url text, -- déprécié : ne plus écrire dedans, gardé pour compat.
                 -- Le bucket "documents" est désormais privé — utiliser
                 -- file_path + une URL signée à la demande (voir plus bas).
  file_path text,
  summary text,
  key_points jsonb,
  questions jsonb,
  analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Résultats d'examens et de quiz
create table exam_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  subject text not null,
  score_percent int not null check (score_percent between 0 and 100),
  questions jsonb,
  answers jsonb,
  taken_at timestamptz not null default now()
);

-- Sécurité : chacun ne voit que ses propres données
alter table profiles enable row level security;
alter table courses enable row level security;
alter table exam_results enable row level security;

create policy "Un utilisateur lit son propre profil"
  on profiles for select using (auth.uid() = id);
create policy "Un utilisateur modifie son propre profil"
  on profiles for update using (auth.uid() = id);

-- SÉCURITÉ CRITIQUE : la policy ci-dessus vérifie la LIGNE (auth.uid() = id)
-- mais pas les COLONNES modifiables — sans ce qui suit, un utilisateur
-- pourrait s'auto-attribuer role='admin' ou subscription_status='premium'
-- en appelant directement l'API PostgREST. Les privilèges de colonne
-- Postgres s'appliquent en plus de la RLS, pas à sa place :
revoke update on profiles from authenticated;
grant update (full_name, account_type) on profiles to authenticated;
-- role, subscription_status, subscription_term, subscription_expires_at,
-- xp restent en lecture seule pour le client — modifiables uniquement
-- par les fonctions security definer ci-dessous ou par le service_role
-- (webhooks de paiement, triggers de gamification).

create policy "Un utilisateur gère ses propres cours"
  on courses for all using (auth.uid() = owner_id);

-- SÉCURITÉ CRITIQUE : un résultat d'examen ne doit jamais pouvoir être
-- écrit directement par le client (il pourrait s'inventer un score de
-- 100%, ce qui fausse aussi XP/badges basés dessus). Lecture seule pour
-- l'utilisateur ; l'écriture passe uniquement par /api/exams/submit et
-- /api/quizzes/submit, qui utilisent la clé service_role après avoir
-- eux-mêmes calculé le score à partir des bonnes réponses gardées
-- côté serveur (table generated_exams ci-dessous).
create policy "Un utilisateur lit ses propres résultats"
  on exam_results for select using (auth.uid() = owner_id);

-- Examens/quiz générés par l'IA : les bonnes réponses restent ici,
-- côté serveur, jusqu'à la correction. Le client ne reçoit jamais
-- correctIndex/method avant d'avoir soumis ses réponses.
create table generated_exams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  kind text not null,              -- 'exam' | 'quiz'
  subject text,                    -- pour un examen ; null pour un quiz (multi-matières)
  questions jsonb not null,        -- [{question, options, correctIndex, method, subject?}]
  weak_subjects jsonb,             -- pour le quiz, calculé à la génération
  used boolean not null default false,
  created_at timestamptz not null default now()
);

alter table generated_exams enable row level security;
-- Le client n'a AUCUN accès direct à cette table (ni select, ni insert) :
-- tout passe par les routes serveur (generate-exam/generate-quiz pour
-- créer, exams/submit et quizzes/submit pour lire et corriger), avec la
-- clé service_role qui contourne RLS. Une policy select limiterait les
-- dégâts si jamais mal utilisée, mais autant ne rien exposer du tout
-- puisque ces lignes contiennent les bonnes réponses.

-- Stockage des documents importés (PDF, présentations, photos de notes)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false,
  15728640, -- 15 Mo — bloqué par Supabase lui-même, avant que le code ne s'exécute
  array[
    'application/pdf', 'text/plain',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = excluded.allowed_mime_types;
-- ⚠️ Si ce bucket a été créé "public" avant cette version du schéma :
-- Storage > documents > Settings > désactive "Public bucket" à la main
-- dans le tableau de bord Supabase (cette ligne seule ne suffit pas
-- toujours à changer un bucket existant selon la version de Supabase).

create policy "Un utilisateur lit ses propres documents"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Un utilisateur dépose ses propres documents"
  on storage.objects for insert
  with check (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- Planning quotidien généré (phase 7) — un jeu de lignes par jour
create table schedule_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  item_date date not null default current_date,
  time text not null,          -- "04:40"
  label text not null,         -- "Mathématiques", "Examen Study Helper", "École"...
  item_type text not null,     -- 'matiere' | 'examen' | 'repos' | 'cours'
  duration_minutes int,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table schedule_items enable row level security;
create policy "Un utilisateur gère son propre planning"
  on schedule_items for all using (auth.uid() = owner_id);

-- Groupes d'étude (phase 11)
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text,
  owner_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table groups enable row level security;
alter table group_members enable row level security;
alter table group_messages enable row level security;

create policy "Tout utilisateur connecté peut lister les groupes"
  on groups for select using (auth.uid() is not null);
-- Nouveau cahier des charges (V1→V4) : les groupes sont inclus dans
-- l'offre gratuite. La création redevient une insertion directe, gratuite
-- pour tout le monde — plus de paiement à la création (l'ancien modèle
-- payant par type de compte est abandonné).
create policy "Un utilisateur crée un groupe en tant que propriétaire"
  on groups for insert with check (auth.uid() = owner_id);

-- L'ajout du créateur comme membre se fait côté client juste après la
-- création (voir app/groups/page.tsx), couvert par la policy d'insertion
-- de group_members plus bas ("Un utilisateur rejoint un groupe pour
-- lui-même").

create policy "Lecture des membres"
  on group_members for select using (auth.uid() is not null);
create policy "Un utilisateur rejoint un groupe pour lui-même"
  on group_members for insert with check (auth.uid() = user_id);
create policy "Un utilisateur quitte un groupe"
  on group_members for delete using (auth.uid() = user_id);

create policy "Seuls les membres lisent les messages du groupe"
  on group_messages for select using (
    group_id in (select group_id from group_members where user_id = auth.uid())
  );
create policy "Seuls les membres envoient des messages"
  on group_messages for insert with check (
    sender_id = auth.uid()
    and group_id in (select group_id from group_members where user_id = auth.uid())
  );

-- Activer le temps réel sur les messages de groupe
alter publication supabase_realtime add table group_messages;

-- Anti-spam : bloque l'envoi si l'utilisateur a déjà envoyé 5 messages
-- dans les 10 dernières secondes (protection basique côté serveur,
-- indépendante du client).
create function public.check_message_rate_limit()
returns trigger as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from group_messages
  where sender_id = new.sender_id
    and created_at > now() - interval '10 seconds';

  if recent_count >= 5 then
    raise exception 'Trop de messages envoyés trop vite, réessaie dans quelques secondes.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger enforce_message_rate_limit
  before insert on group_messages
  for each row execute procedure public.check_message_rate_limit();

-- Suivi des questions posées à l'assistant IA, pour appliquer la limite
-- quotidienne (plus élevée pour les abonnés Premium)
create table ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  action text not null default 'assistant', -- 'assistant' | 'analyze' | 'exam' | 'quiz'
  created_at timestamptz not null default now()
);

alter table ai_usage_log enable row level security;
-- SÉCURITÉ : le client ne doit pouvoir QUE consulter son propre
-- historique — jamais insérer ni supprimer une ligne lui-même (ça
-- reviendrait à pouvoir réinitialiser sa propre limite quotidienne).
-- L'écriture passe exclusivement par check_and_log_usage() ci-dessous,
-- appelée par lib/rate-limit.ts avec la clé service_role.
create policy "Un utilisateur consulte son propre historique d'usage IA"
  on ai_usage_log for select using (auth.uid() = owner_id);

-- Si ta base a été créée avec une version antérieure de ce fichier
-- (avant l'ajout de la colonne "action"), exécute cette ligne seule :
-- alter table ai_usage_log add column if not exists action text not null default 'assistant';

-- Vérifie ET journalise l'usage en une seule opération atomique
-- (une fonction PL/pgSQL s'exécute dans une transaction implicite) —
-- élimine la fenêtre de course entre "lire le compteur" et "l'incrémenter"
-- qu'auraient deux appels JS séparés depuis la route serveur.
create function public.check_and_log_usage(
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
  -- Verrou consultatif propre à cette transaction, sur la combinaison
  -- utilisateur+action : deux appels simultanés pour le même
  -- utilisateur/la même action s'exécutent maintenant en séquence, pas
  -- en parallèle — élimine la fenêtre de course "les deux lisent le
  -- même compteur avant que l'un des deux n'insère". Des appels pour
  -- des utilisateurs ou actions différents restent parallèles (clé de
  -- verrou différente), donc pas de ralentissement inutile.
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

-- De même, si schedule_items existait déjà sans le suivi de complétion :
-- alter table schedule_items add column if not exists completed boolean not null default false;

-- ============================================================
-- Nouveau cahier des charges V1→V4 : Opportunités + Activités
-- ============================================================

-- Le terme choisi pour l'abonnement Premium (mensuel/trimestriel/annuel),
-- purement informatif tant que le vrai paiement n'est pas branché.
alter table profiles add column if not exists subscription_term text
  check (subscription_term in ('mensuel', 'trimestriel', 'annuel'));

create type moderation_status as enum ('pending', 'approved', 'rejected');

-- Opportunités : bourses, certifications, stages, jobs étudiants,
-- freelance, projets/startups/challenges — accessibles à tous
-- gratuitement, mais modérées avant publication (sécurité).
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  category text not null,   -- 'bourse' | 'certification' | 'formation' | 'stage' | 'job_etudiant' | 'freelance' | 'projet' | 'startup' | 'challenge'
  title text not null,
  organization text,
  description text not null,
  location text,
  contact text,             -- lien ou email de candidature
  deadline date,
  status moderation_status not null default 'pending',
  verified_badge boolean not null default false,
  moderated_by uuid references profiles(id),
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

create table opportunity_reports (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table opportunities enable row level security;
alter table opportunity_reports enable row level security;

create policy "Tout le monde voit les opportunités approuvées"
  on opportunities for select using (
    status = 'approved' or author_id = auth.uid()
  );
create policy "Un utilisateur propose une opportunité (en attente de modération)"
  on opportunities for insert with check (
    auth.uid() = author_id and status = 'pending'
  );

create policy "Un utilisateur signale une opportunité"
  on opportunity_reports for insert with check (auth.uid() = reporter_id);
create policy "Un utilisateur voit ses propres signalements"
  on opportunity_reports for select using (auth.uid() = reporter_id);

-- Activités éducatives : hackathons, concours, olympiades, conférences,
-- ateliers, clubs étudiants — même principe de modération.
create table activities (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  category text not null, -- 'hackathon' | 'concours' | 'olympiade' | 'conference' | 'atelier' | 'club'
  title text not null,
  organizer text,
  description text not null,
  location text,
  event_date date,
  registration_link text,
  rewards text,
  status moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);

alter table activities enable row level security;
create policy "Tout le monde voit les activités approuvées"
  on activities for select using (
    status = 'approved' or author_id = auth.uid()
  );
create policy "Un utilisateur propose une activité (en attente de modération)"
  on activities for insert with check (
    auth.uid() = author_id and status = 'pending'
  );

-- Modération : pour l'instant réservée manuellement (pas encore de rôle
-- admin en base — voir README, panel admin toujours à construire). Un
-- administrateur avec la clé service_role peut modérer directement via
-- Table Editor ou une future route /api/admin.

-- ============================================================
-- Rôles + panel de modération
-- ============================================================

create type user_role as enum ('user', 'moderator', 'admin');
alter table profiles add column if not exists role user_role not null default 'user';

-- Fonctions security definer pour vérifier le rôle — évite de répéter
-- (et de potentiellement mal sécuriser) des EXISTS(select ... profiles)
-- directement dans chaque policy RLS. security definer + stable : ces
-- fonctions s'exécutent avec les privilèges de leur propriétaire, donc
-- indépendamment des policies RLS appliquées à l'appelant.
create function public.is_admin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer stable set search_path = public;

create function public.is_moderator_or_admin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('moderator', 'admin'));
$$ language sql security definer stable set search_path = public;

-- Un admin voit tous les profils (lecture seule directe — les
-- modifications passent par admin_update_user() ci-dessous, jamais par
-- une mise à jour directe de la table, à cause du verrou de colonnes
-- posé plus haut).
create policy "Les admins voient tous les profils"
  on profiles for select using (public.is_admin());

-- Seule façon de changer le rôle ou l'abonnement d'un autre utilisateur :
-- cette fonction, qui vérifie elle-même que l'appelant est admin avant
-- toute mutation, et ne touche qu'aux deux colonnes voulues.
create function public.admin_update_user(
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

  -- La 2FA doit être RÉELLEMENT vérifiée pour cette session, pas juste
  -- activée sur le compte un jour donné. Si l'admin a un facteur 2FA
  -- vérifié, son jeton de session actuel doit être de niveau AAL2
  -- (c'est-à-dire qu'il vient bien de saisir son code) — sinon une
  -- session simplement authentifiée par mot de passe (AAL1) pourrait
  -- réaliser cette action sans jamais avoir prouvé la 2FA. Un admin qui
  -- n'a pas activé la 2FA n'est pas bloqué ici (à traiter séparément :
  -- l'imposer à l'inscription/l'accès au rôle admin).
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

-- Un modérateur/admin voit TOUTES les opportunités et activités (y
-- compris en attente), pas seulement les siennes ou les approuvées.
create policy "Modérateurs et admins voient tout (opportunités)"
  on opportunities for select using (public.is_moderator_or_admin());
create policy "Modérateurs et admins voient tout (activités)"
  on activities for select using (public.is_moderator_or_admin());

-- Seuls les modérateurs/admins peuvent changer le statut d'une
-- opportunité ou d'une activité (approuver/rejeter) — restreint aux
-- colonnes de modération uniquement : un modérateur ne doit pas pouvoir
-- réécrire le titre/la description d'un contenu qu'il modère.
create policy "Modérateurs et admins modèrent les opportunités"
  on opportunities for update using (public.is_moderator_or_admin());
create policy "Modérateurs et admins modèrent les activités"
  on activities for update using (public.is_moderator_or_admin());

revoke update on opportunities from authenticated;
grant update (status, moderated_by, moderated_at, verified_badge) on opportunities to authenticated;
revoke update on activities from authenticated;
grant update (status) on activities to authenticated;

-- Un modérateur/admin peut aussi lire les signalements pour décider.
create policy "Modérateurs et admins lisent les signalements"
  on opportunity_reports for select using (public.is_moderator_or_admin());

-- Pour donner le rôle modérateur/admin à un utilisateur (aucune
-- interface pour l'instant, volontairement — évite qu'un utilisateur se
-- l'attribue lui-même) :
-- update profiles set role = 'admin' where id = 'uuid-de-l-utilisateur';

-- ============================================================
-- Portfolio (Espace Carrière)
-- ============================================================

create table portfolio_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text,
  link text,
  tags text[],
  created_at timestamptz not null default now()
);

alter table portfolio_items enable row level security;
create policy "Un utilisateur gère son propre portfolio"
  on portfolio_items for all using (auth.uid() = owner_id);

-- ============================================================
-- Gamification (XP, niveaux, badges)
-- ============================================================

alter table profiles add column if not exists xp int not null default 0;

create table user_badges (
  owner_id uuid not null references profiles(id) on delete cascade,
  badge_key text not null,
  earned_at timestamptz not null default now(),
  primary key (owner_id, badge_key)
);

alter table user_badges enable row level security;
create policy "Un utilisateur voit ses propres badges"
  on user_badges for select using (auth.uid() = owner_id);
-- Pas de policy d'insertion pour les utilisateurs : les badges ne sont
-- accordés que par les fonctions/triggers ci-dessous (security definer),
-- jamais directement par le client — impossible de se les attribuer soi-même.

create function public.award_badge(p_owner_id uuid, p_badge_key text)
returns void as $$
begin
  insert into user_badges (owner_id, badge_key)
  values (p_owner_id, p_badge_key)
  on conflict do nothing;
end;
$$ language plpgsql security definer set search_path = public;

create function public.add_xp(p_owner_id uuid, p_amount int)
returns void as $$
begin
  update profiles set xp = xp + p_amount where id = p_owner_id;
end;
$$ language plpgsql security definer set search_path = public;

-- Trigger : examen/quiz terminé → XP proportionnel au score + badges
create function public.handle_exam_result_inserted()
returns trigger as $$
declare
  exam_count int;
  high_score_count int;
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

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_exam_result_inserted
  after insert on exam_results
  for each row execute procedure public.handle_exam_result_inserted();

-- Trigger : cours importé → petit XP + badge du premier cours
-- (déclenché à CHAQUE import de cours — le même bug que ci-dessus sur
-- award_badge() faisait donc échouer l'import lui-même, silencieusement
-- pour l'utilisateur : la ligne "courses" ne s'insérait jamais.)
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

create trigger on_course_inserted
  after insert on courses
  for each row execute procedure public.handle_course_inserted();

-- Trigger : groupe rejoint (ou créé) → petit XP + badge
-- (même bug : bloquait la création de groupe ET le fait d'en rejoindre un.)
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


create trigger on_group_member_inserted
  after insert on group_members
  for each row execute procedure public.handle_group_member_inserted();

-- Le catalogue des badges (libellé, description, icône) est défini
-- côté code dans lib/badges.ts — seule la clé (badge_key) est stockée
-- ici, pour rester simple à faire évoluer sans migration.

-- ============================================================
-- Paiement réel (Monetbil — mobile money)
-- ============================================================

create table payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  transaction_id text not null unique,
  type text not null check (type in ('premium', 'tutoring')),
  amount_fcfa int not null check (amount_fcfa > 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  metadata jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table payments enable row level security;
create policy "Un utilisateur voit ses propres paiements"
  on payments for select using (auth.uid() = owner_id);
-- Pas de policy d'insertion/mise à jour pour le client : tout passe par
-- les routes serveur (clé service_role), qui vérifient le vrai statut
-- auprès de Monetbil avant de modifier quoi que ce soit — impossible de
-- se déclarer "payé" en insérant/modifiant directement depuis le client.

-- ============================================================
-- Notifications push réelles (Web Push)
-- ============================================================

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
create policy "Un utilisateur gère ses propres abonnements push"
  on push_subscriptions for all using (auth.uid() = owner_id);

-- Pour retrouver rapidement, à une minute donnée, les sessions de
-- révision/examen à notifier (voir app/api/push/send-reminders).
create index if not exists idx_schedule_items_date_time
  on schedule_items (item_date, time);

-- ============================================================
-- Documents et Questions partagés dans les groupes d'étude
-- ============================================================

-- Partage d'un cours déjà importé/analysé (table "courses") dans un
-- groupe — pas un nouvel upload, juste une référence.
create table group_documents (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  shared_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table group_questions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  question text not null,
  created_at timestamptz not null default now()
);

create table group_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references group_questions(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  answer text not null,
  created_at timestamptz not null default now()
);

alter table group_documents enable row level security;
alter table group_questions enable row level security;
alter table group_answers enable row level security;

create policy "Seuls les membres voient les documents du groupe"
  on group_documents for select using (
    group_id in (select group_id from group_members where user_id = auth.uid())
  );
create policy "Un membre partage un de ses cours dans le groupe"
  on group_documents for insert with check (
    shared_by = auth.uid()
    and group_id in (select group_id from group_members where user_id = auth.uid())
    and course_id in (select id from courses where owner_id = auth.uid())
  );
create policy "Un membre retire un document qu'il a partagé"
  on group_documents for delete using (shared_by = auth.uid());

create policy "Seuls les membres voient les questions du groupe"
  on group_questions for select using (
    group_id in (select group_id from group_members where user_id = auth.uid())
  );
create policy "Un membre pose une question dans le groupe"
  on group_questions for insert with check (
    author_id = auth.uid()
    and group_id in (select group_id from group_members where user_id = auth.uid())
  );

create policy "Seuls les membres du groupe voient les réponses"
  on group_answers for select using (
    question_id in (
      select gq.id from group_questions gq
      join group_members gm on gm.group_id = gq.group_id
      where gm.user_id = auth.uid()
    )
  );
create policy "Un membre répond à une question du groupe"
  on group_answers for insert with check (
    author_id = auth.uid()
    and question_id in (
      select gq.id from group_questions gq
      join group_members gm on gm.group_id = gq.group_id
      where gm.user_id = auth.uid()
    )
  );

-- ============================================================
-- Marketplace enseignants (cours de répétition)
-- ============================================================

create table tutoring_offers (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  subject text not null,
  description text not null,
  price_fcfa int not null check (price_fcfa > 0),
  format text not null default 'en_ligne', -- 'en_ligne' | 'presentiel'
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table tutoring_offers enable row level security;
create policy "Tout le monde voit les offres actives"
  on tutoring_offers for select using (
    active = true or teacher_id = auth.uid()
  );
create policy "Seul un enseignant crée ses propres offres"
  on tutoring_offers for insert with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from profiles
      where id = auth.uid() and account_type = 'enseignant'
    )
  );
create policy "Un enseignant gère ses propres offres"
  on tutoring_offers for update using (teacher_id = auth.uid());
create policy "Un enseignant supprime ses propres offres"
  on tutoring_offers for delete using (teacher_id = auth.uid());

create table tutoring_bookings (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references tutoring_offers(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending_payment', -- 'pending_payment' | 'paid' | 'cancelled'
  created_at timestamptz not null default now()
);

alter table tutoring_bookings enable row level security;
create policy "Un étudiant voit ses propres réservations"
  on tutoring_bookings for select using (student_id = auth.uid());
create policy "Un enseignant voit les réservations de ses offres"
  on tutoring_bookings for select using (
    offer_id in (select id from tutoring_offers where teacher_id = auth.uid())
  );
create policy "Un étudiant réserve pour lui-même"
  on tutoring_bookings for insert with check (student_id = auth.uid());
-- Pas de policy de mise à jour pour le client : le passage à "paid" se
-- fait uniquement via le webhook de paiement (clé service_role), après
-- vérification réelle auprès de Monetbil — jamais directement.

-- Un enseignant a besoin du nom (et éventuellement du contact) de
-- l'étudiant qui a payé une réservation, pour organiser la session.
create policy "Un enseignant voit le profil des étudiants ayant payé"
  on profiles for select using (
    id in (
      select tb.student_id from tutoring_bookings tb
      join tutoring_offers tof on tof.id = tb.offer_id
      where tof.teacher_id = auth.uid() and tb.status = 'paid'
    )
  );

-- ============================================================
-- Fuseau horaire par utilisateur (pour les rappels push)
-- ============================================================

alter table profiles add column if not exists timezone text not null default 'Africa/Douala';
-- Autorisé en auto-modification (voir la section "verrouillage des
-- colonnes sensibles" plus haut) — ajouté à la liste des colonnes que
-- l'utilisateur peut modifier lui-même sur son propre profil.
grant update (full_name, account_type, timezone) on profiles to authenticated;

-- ============================================================
-- Anti-brute-force serveur sur /login (au-delà du blocage client)
-- ============================================================

create table login_attempts (
  identifier text primary key, -- email en minuscules
  attempt_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table login_attempts enable row level security;
-- Aucune policy : le client n'a accès à cette table d'aucune façon,
-- uniquement lue/écrite par app/api/auth/login avec service_role.

create function public.check_login_allowed(p_email text)
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
$$ language plpgsql security definer set search_path = public;

create function public.record_login_result(p_email text, p_success boolean)
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
$$ language plpgsql security definer set search_path = public;


-- ============================================================
-- V1.3 (fusionnée dans ce fichier pour une base neuve) — voir aussi
-- supabase/migration-v1.3-assistant-quota.sql pour une base existante.
-- ============================================================
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
-- Table du compteur (absente des versions précédentes de ce dépôt).
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


-- ---------------------------------------------------------------------------
-- v2.8 — Réglages publicitaires (voir supabase/migration-v2.8-ad-settings.sql pour les commentaires)
-- ---------------------------------------------------------------------------
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

