-- ============================================================
-- MIGRATION V1.5 — Planning partagé des groupes d'étude
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
--
-- Ajoute la table utilisée par le nouvel onglet « Planning » d'un groupe :
-- une séance de révision partagée (date, heure, matière), visible et
-- modifiable par tous les membres du groupe.

create table if not exists public.group_schedule_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  subject text,
  item_date date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists group_schedule_items_group_date_idx
  on public.group_schedule_items (group_id, item_date, start_time);

alter table public.group_schedule_items enable row level security;

-- ----------------------------------------------------------------------
-- Ajout direct d'un membre par le propriétaire du groupe.
-- Jusqu'ici, la règle de sécurité (RLS) sur group_members n'autorisait
-- que "je m'ajoute moi-même" — un propriétaire ne pouvait pas ajouter
-- quelqu'un d'autre, quelle que soit l'interface construite dessus.
drop policy if exists "Un utilisateur rejoint un groupe pour lui-même" on public.group_members;
create policy "Rejoindre soi-même ou être ajouté par le propriétaire"
  on public.group_members for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.groups g
      where g.id = group_members.group_id and g.owner_id = auth.uid()
    )
  );

-- Recherche d'un utilisateur par son nom, pour l'inviter dans un groupe.
-- Chaque profil n'étant lisible que par son propre propriétaire (RLS),
-- une recherche directe sur "profiles" ne renverrait jamais personne
-- d'autre. Cette fonction expose UNIQUEMENT id + nom (rien de sensible :
-- ni l'abonnement, ni l'e-mail, ni le rôle), pour les membres connectés.
create or replace function public.search_profiles(query text)
returns table(id uuid, full_name text) as $$
  select id, full_name from public.profiles
  where full_name ilike '%' || query || '%'
  order by full_name
  limit 10;
$$ language sql stable security definer set search_path = public;

revoke all on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;


drop policy if exists "Membres du groupe lisent le planning" on public.group_schedule_items;
create policy "Membres du groupe lisent le planning"
  on public.group_schedule_items for select
  using (
    exists (
      select 1 from public.group_members m
      where m.group_id = group_schedule_items.group_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Membres du groupe ajoutent une séance" on public.group_schedule_items;
create policy "Membres du groupe ajoutent une séance"
  on public.group_schedule_items for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.group_members m
      where m.group_id = group_schedule_items.group_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Auteur ou owner supprime une séance" on public.group_schedule_items;
create policy "Auteur ou owner supprime une séance"
  on public.group_schedule_items for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.groups g
      where g.id = group_schedule_items.group_id and g.owner_id = auth.uid()
    )
  );
