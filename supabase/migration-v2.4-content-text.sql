-- Ajoute la colonne qui stocke le texte extrait d'un document (déjà prévue par la migration v1.7).
-- À exécuter dans Supabase > SQL Editor. Sans danger si la colonne existe déjà.
alter table public.courses add column if not exists content_text text;

-- Colonnes de traduction en cache (migration v2.2) : même précaution.
alter table public.courses add column if not exists content_translated text;
alter table public.courses add column if not exists content_translated_lang text;

-- Recharge le cache du schéma pour que l'API voie tout de suite les nouvelles colonnes.
notify pgrst, 'reload schema';
