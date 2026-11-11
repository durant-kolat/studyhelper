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
