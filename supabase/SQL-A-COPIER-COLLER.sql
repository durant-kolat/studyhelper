-- =====================================================================================
-- STUDY HELPER — SQL À COPIER-COLLER (NOUVEAUTÉS v2.9 → v3.3 SEULEMENT)
-- ⚠️ À lancer APRÈS les migrations v1.1 → v2.8. Si une erreur parle d'une colonne ou d'une table inconnue
--    (ex. « provider_txn_id » : migration v2.0 absente), utilise plutôt SQL-COMPLET-DANS-L-ORDRE.sql.
-- Sans danger si exécuté deux fois. Aucune donnée existante n'est supprimée.
-- =====================================================================================

-- ===================== 1/5 — migration-v2.9-exam-analysis =====================
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


-- ===================== 2/5 — migration-v3.0-assistant-memory =====================
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


-- ===================== 3/5 — migration-v3.1-celebrations =====================
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


-- ===================== 4/5 — migration-v3.2-exam-open-questions =====================
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


-- ===================== 5/5 — migration-v3.3-direct-payments =====================
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


