import { supabaseAdmin } from "./supabase-admin";
import { wrapUntrustedData } from "./study-helper-rules";
import { computeWeakSubjects, formatLearnerContext, LEARNER_CONTEXT_RULES, type LearnerMemory } from "./learner-context-format";

/**
 * Bloc de personnalisation ajouté aux instructions de l'assistant. SERVEUR UNIQUEMENT.
 * Isolation : lecture filtrée par owner_id de l'utilisateur authentifié. Échec = chaîne vide (l'assistant fonctionne sans).
 * Les textes saisis par l'élève sont des DONNÉES (jamais des instructions) : encadrés par wrapUntrustedData.
 */
export async function buildLearnerContext(ownerId: string): Promise<string> {
  try {
    const { data: memory } = await supabaseAdmin
      .from("learner_memory")
      .select("personalization_enabled, display_name, study_level, subjects, goals, learning_prefs")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if ((memory as LearnerMemory | null)?.personalization_enabled === false) return "";

    const { data: rows } = await supabaseAdmin
      .from("exam_results")
      .select("subject, score_percent")
      .eq("owner_id", ownerId)
      .order("taken_at", { ascending: false })
      .limit(30);
    const text = formatLearnerContext(memory as LearnerMemory | null, computeWeakSubjects(rows ?? []));
    if (!text) return "";
    return `${LEARNER_CONTEXT_RULES}\n${wrapUntrustedData({ title: "Profil pédagogique de l'élève", content: text })}`;
  } catch (err) {
    console.error("[learner-context] indisponible :", err instanceof Error ? err.message : err);
    return "";
  }
}
