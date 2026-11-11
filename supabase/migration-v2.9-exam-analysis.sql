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
