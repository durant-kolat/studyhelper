-- Autorise toutes les langues de l'application (53) dans le profil.
-- À exécuter dans Supabase > SQL Editor. Sans danger si déjà exécuté.
alter table public.profiles drop constraint if exists profiles_preferred_language_check;

alter table public.profiles
  add constraint profiles_preferred_language_check
  check (preferred_language is null or preferred_language in
    ('fr', 'en', 'de', 'es', 'it', 'pt', 'ar', 'zh', 'nl', 'ru', 'tr', 'ja', 'ko', 'hi', 'pl', 'uk', 'ro', 'el', 'cs', 'sv', 'da', 'fi', 'no', 'hu', 'bg', 'hr', 'sk', 'id', 'ms', 'vi', 'th', 'fil', 'bn', 'ur', 'fa', 'ta', 'te', 'mr', 'he', 'ne', 'sw', 'af', 'am', 'zu', 'ha', 'yo', 'ig', 'so', 'rw', 'mg', 'sn', 'ln', 'wo'));

notify pgrst, 'reload schema';
