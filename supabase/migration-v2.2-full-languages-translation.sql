-- v2.2 — Langues complètes + traduction du contenu importé.
--
-- 1) La migration v2.1 limitait preferred_language à 8 codes ('fr','en','de',
--    'es','it','pt','ar','zh') via une contrainte CHECK. L'application
--    propose maintenant 14 langues (ajout de nl, ru, tr, ja, ko, hi) : sans
--    cette migration, choisir l'une de ces nouvelles langues dans les
--    Paramètres échoue silencieusement à l'enregistrement (la contrainte
--    rejette la mise à jour), même si l'interface affiche déjà l'option.
--
-- 2) Ajoute deux colonnes à `courses` pour mettre en cache la traduction du
--    texte original d'un document (content_text) dans la langue actuellement
--    choisie par l'utilisateur. Le texte ORIGINAL n'est jamais modifié ; la
--    traduction est un cache à part, régénéré si l'utilisateur change de
--    langue d'application.

alter table public.profiles drop constraint if exists profiles_preferred_language_check;

alter table public.profiles
  add constraint profiles_preferred_language_check
  check (preferred_language is null or preferred_language in
    ('fr', 'en', 'de', 'es', 'it', 'pt', 'ar', 'zh', 'nl', 'ru', 'tr', 'ja', 'ko', 'hi'));

alter table public.courses add column if not exists content_translated text;
alter table public.courses add column if not exists content_translated_lang text;

comment on column public.courses.content_translated is
  'Traduction mise en cache de content_text dans content_translated_lang ; régénérée à la demande (voir /api/translate-course). Le document original (content_text, file_path) n''est jamais modifié.';
comment on column public.courses.content_translated_lang is
  'Code de langue (voir lib/i18n/languages.ts) de content_translated ; null tant qu''aucune traduction n''a été demandée.';
