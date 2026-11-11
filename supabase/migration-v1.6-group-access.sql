-- ============================================================
-- MIGRATION V1.6 — Accès annuel payant aux groupes d'étude
-- ============================================================
-- À exécuter APRÈS les migrations V1.4 et V1.5 (rejouable sans risque).
--
-- Règles :
--   * Créer un groupe reste GRATUIT (le créateur est membre "owner").
--   * Entrer dans un groupe (en tant que membre) = un paiement, valable
--     un an, renouvelable.
--   * Les membres déjà présents avant cette migration gardent leur accès
--     (expires_at reste NULL = pas d'expiration).
--   * Une personne ajoutée par le propriétaire doit aussi payer avant
--     d'entrer (son accès démarre expiré).
--   * Le paiement confirmé par Monetbil (webhook, clé service) est le
--     seul moyen d'obtenir un accès actif.
--
-- Cette migration ne fait pas confiance aux noms de politiques de ta
-- base : ils ont divergé du schéma d'origine. Elle supprime par boucle
-- les politiques d'écriture/lecture existantes des tables de groupe et
-- les recrée proprement.

alter table public.group_members add column if not exists expires_at timestamptz;

-- Accès actif = membre, et (pas d'expiration OU expiration future).
create or replace function public.is_active_group_member(p_group_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id
      and m.user_id = auth.uid()
      and (m.expires_at is null or m.expires_at > now())
  );
$$ language sql stable security definer set search_path = public;

revoke all on function public.is_active_group_member(uuid) from public, anon;
grant execute on function public.is_active_group_member(uuid) to authenticated;

-- Un membre ajouté depuis un navigateur (auth.uid() non nul) autre que
-- "owner" démarre TOUJOURS expiré : impossible de s'offrir un accès
-- gratuit (ni au propriétaire d'en offrir). Le webhook (clé service,
-- auth.uid() nul) fixe la vraie date d'expiration après paiement.
create or replace function public.force_expired_membership()
returns trigger as $$
begin
  if auth.uid() is not null and new.role <> 'owner' then
    new.expires_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists group_members_force_expired on public.group_members;
create trigger group_members_force_expired
  before insert on public.group_members
  for each row execute procedure public.force_expired_membership();

-- Suppression par boucle des anciennes politiques (quel que soit leur nom).
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'group_members' and cmd in ('INSERT', 'UPDATE', 'ALL'))
        or (tablename in ('group_messages', 'group_documents', 'group_questions',
                          'group_answers', 'group_schedule_items')
            and cmd in ('SELECT', 'INSERT', 'ALL'))
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- group_members : seul le propriétaire du groupe peut insérer (soi-même
-- comme owner à la création, ou une autre personne). Les adhésions payées
-- passent par le webhook (clé service, qui contourne RLS).
create policy "Le propriétaire ajoute des membres"
  on public.group_members for insert
  with check (
    exists (
      select 1 from public.groups g
      where g.id = group_members.group_id and g.owner_id = auth.uid()
    )
  );

drop policy if exists "Lecture des membres" on public.group_members;
create policy "Lecture des membres"
  on public.group_members for select using (auth.uid() is not null);

drop policy if exists "Un utilisateur quitte un groupe" on public.group_members;
create policy "Un utilisateur quitte un groupe"
  on public.group_members for delete using (auth.uid() = user_id);

-- Contenus du groupe : réservés aux membres à accès ACTIF.
create policy "Membres actifs lisent les messages"
  on public.group_messages for select using (public.is_active_group_member(group_id));
create policy "Membres actifs envoient des messages"
  on public.group_messages for insert
  with check (user_id = auth.uid() and public.is_active_group_member(group_id));

create policy "Membres actifs voient les documents"
  on public.group_documents for select using (public.is_active_group_member(group_id));
create policy "Membres actifs partagent un de leurs cours"
  on public.group_documents for insert
  with check (
    shared_by = auth.uid()
    and public.is_active_group_member(group_id)
    and course_id in (select id from public.courses where owner_id = auth.uid())
  );

create policy "Membres actifs voient les questions"
  on public.group_questions for select using (public.is_active_group_member(group_id));
create policy "Membres actifs posent une question"
  on public.group_questions for insert
  with check (author_id = auth.uid() and public.is_active_group_member(group_id));

create policy "Membres actifs voient les réponses"
  on public.group_answers for select using (public.is_active_group_member(group_id));
create policy "Membres actifs répondent"
  on public.group_answers for insert
  with check (
    author_id = auth.uid()
    and public.is_active_group_member(group_id)
    and question_id in (
      select gq.id from public.group_questions gq where gq.group_id = group_answers.group_id
    )
  );

create policy "Membres actifs lisent le planning"
  on public.group_schedule_items for select using (public.is_active_group_member(group_id));
create policy "Membres actifs ajoutent une séance"
  on public.group_schedule_items for insert
  with check (created_by = auth.uid() and public.is_active_group_member(group_id));
