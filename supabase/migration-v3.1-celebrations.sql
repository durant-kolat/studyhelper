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
