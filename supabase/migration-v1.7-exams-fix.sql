-- ============================================================
-- MIGRATION V1.7 — Correctifs generated_exams / exam_results / courses
-- ============================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor (rejouable sans erreur).
--
-- Erreur A : « Could not find the 'weak_subjects' column of 'generated_exams'
--            in the schema cache » (Grand Quiz de la semaine)
-- Erreur B : « record "new" has no field "percent" » (fin d'un examen :
--            un trigger/une fonction de ta base réelle lit NEW.percent alors
--            que la colonne s'appelle score_percent sur exam_results)
-- Nouveau  : courses.content_text — texte ORIGINAL extrait du document
--            (affiché tel quel dans la Bibliothèque, et donné à l'IA).

-- 1) generated_exams : colonnes manquantes --------------------------------
-- weak_subjects en jsonb (comme dans schema.sql) : PostgREST y écrit
-- directement le tableau JS de matières ; null est géré côté code (?? []).
alter table public.generated_exams add column if not exists weak_subjects jsonb;
alter table public.generated_exams add column if not exists percent integer;

-- 2) exam_results : colonne `percent` de compatibilité ---------------------
-- Colonne calculée = score_percent. Toute ancienne fonction qui lit
-- NEW.percent fonctionne à nouveau, sans rien dupliquer ni désynchroniser.
alter table public.exam_results
  add column if not exists percent integer generated always as (score_percent) stored;

-- 3) Trigger XP/badges : réécrit avec score_percent, jamais bloquant -------
create or replace function public.handle_exam_result_inserted()
returns trigger as $$
declare
  exam_count int;
  high_score_count int;
  v_score int := coalesce(new.score_percent, 0);
begin
  begin
    perform public.add_xp(new.owner_id, greatest(round(v_score / 5.0)::int, 1));

    select count(*) into exam_count from exam_results where owner_id = new.owner_id;
    if exam_count = 1 then
      perform public.award_badge(new.owner_id, 'first_exam');
    end if;

    if v_score = 100 then
      perform public.award_badge(new.owner_id, 'perfect_score');
    end if;

    select count(*) into high_score_count
    from exam_results where owner_id = new.owner_id and score_percent >= 80;
    if high_score_count >= 5 then
      perform public.award_badge(new.owner_id, 'high_achiever');
    end if;
  exception when others then
    raise warning 'handle_exam_result_inserted: %', sqlerrm;
  end;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_exam_result_inserted on public.exam_results;
create trigger on_exam_result_inserted
  after insert on public.exam_results
  for each row execute procedure public.handle_exam_result_inserted();

-- 4) courses : contenu original du document ---------------------------------
alter table public.courses add column if not exists content_text text;

-- 5) Diagnostic (optionnel) : autres fonctions qui lisent encore NEW.percent
--    → si cette requête renvoie des lignes, corrige-les avec score_percent.
-- select p.proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and pg_get_functiondef(p.oid) ilike '%new.percent%';

-- 6) Recharge le cache de schéma PostgREST (sinon l'erreur A persiste)
notify pgrst, 'reload schema';
