-- v2.8 — Réglages publicitaires (page /admin/ads).
-- À EXÉCUTER MANUELLEMENT (SQL Editor Supabase). Idempotent : peut être rejoué sans risque.
-- Pourquoi UNE table : les interrupteurs de l'administrateur (emplacements, pages, formats) doivent survivre
-- aux rechargements et s'appliquer à tous les visiteurs ; les variables d'environnement ne sont pas modifiables
-- depuis l'application. Une seule ligne (id = 'global'), un seul objet JSON : aucune colonne par réglage.
-- Aucune donnée existante n'est modifiée ni supprimée ; aucune politique RLS existante n'est touchée.
-- Contenu NON secret : lecture publique (la page d'accueil est visible sans connexion) ; écriture réservée
-- aux administrateurs par RLS (public.is_admin()). Aucune politique de suppression : la ligne ne peut pas être effacée.
-- Aucun identifiant publicitaire n'est stocké ici : ils vivent dans les variables d'environnement.

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

-- Vérification rapide (facultatif) : avec un compte NON admin, cette requête doit échouer / mettre 0 ligne à jour :
--   update public.ad_settings set config = '{"globalEnabled": false}' where id = 'global';
