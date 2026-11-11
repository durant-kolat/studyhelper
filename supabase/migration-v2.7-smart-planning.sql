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
