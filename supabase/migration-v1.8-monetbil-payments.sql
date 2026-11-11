-- ============================================================
-- MIGRATION V1.8 — Table payments alignée sur le code Monetbil
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
--
-- Audit : schema.sql décrit `payments` avec owner_id / transaction_id /
-- amount_fcfa / metadata et un `type` limité à premium|tutoring, alors que
-- le code (initiate + webhook) lit/écrit user_id / provider_ref / amount /
-- meta / currency / updated_at et le type `group_access`. Cette migration
-- aligne la base sur le code, sans supprimer aucune donnée.

-- 1) Colonnes utilisées par le code (ajout seulement si absentes) ------------
alter table public.payments add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.payments add column if not exists provider text default 'monetbil';
alter table public.payments add column if not exists provider_ref text;
alter table public.payments add column if not exists plan text;
alter table public.payments add column if not exists amount integer;
alter table public.payments add column if not exists currency text not null default 'XAF';
alter table public.payments add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.payments add column if not exists updated_at timestamptz not null default now();

-- 2) Anciennes colonnes (schema.sql d'origine) : reprise des données puis
--    NOT NULL levé, pour ne pas bloquer les insertions du code actuel.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='owner_id') then
    execute 'update public.payments set user_id = owner_id where user_id is null';
    execute 'alter table public.payments alter column owner_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='transaction_id') then
    execute 'update public.payments set provider_ref = transaction_id where provider_ref is null';
    execute 'alter table public.payments alter column transaction_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='amount_fcfa') then
    execute 'update public.payments set amount = amount_fcfa where amount is null';
    execute 'alter table public.payments alter column amount_fcfa drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='metadata') then
    execute 'update public.payments set meta = metadata where metadata is not null and meta = ''{}''::jsonb';
  end if;
end $$;

-- 3) Types de paiement : ajout de group_access (sinon l'INSERT est refusé) ----
alter table public.payments drop constraint if exists payments_type_check;
alter table public.payments
  add constraint payments_type_check check (type in ('premium', 'tutoring', 'group_access')) not valid;

-- 4) Intégrité / anti-rejeu ---------------------------------------------------
-- Une référence de paiement (payment_ref envoyé à Monetbil) est unique…
create unique index if not exists payments_provider_ref_key
  on public.payments (provider_ref) where provider_ref is not null;
-- …et une transaction Monetbil ne peut créditer qu'UN seul paiement.
create unique index if not exists payments_monetbil_transaction_key
  on public.payments ((meta->>'monetbil_transaction_id'))
  where meta ? 'monetbil_transaction_id';

-- 5) Sécurité : lecture seule pour l'utilisateur, écriture serveur uniquement --
-- (le webhook et l'initiation utilisent la clé service_role)
alter table public.payments enable row level security;
drop policy if exists "Un utilisateur voit ses propres paiements" on public.payments;
create policy "Un utilisateur voit ses propres paiements"
  on public.payments for select using (auth.uid() = user_id);
revoke insert, update, delete on public.payments from anon, authenticated;

-- 6) Recharge le cache de schéma PostgREST
notify pgrst, 'reload schema';
