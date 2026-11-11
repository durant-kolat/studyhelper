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
