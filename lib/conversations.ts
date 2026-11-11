// Historique des conversations du chat global + fiche « mémoire pédagogique ». CLIENT (Supabase + RLS).
// Chaque requête est filtrée par RLS : un élève ne lit, ne modifie et ne supprime que SES lignes.
import { supabase } from "./supabase";
import { greetingName } from "./learner-context-format";

export type StoredMessage = { role: "user" | "assistant"; content: string; evaluation?: unknown };
export type SavedConversation = { id: string; title: string; updated_at: string };
export type LearnerMemoryRow = {
  personalization_enabled: boolean;
  history_enabled: boolean;
  display_name: string | null;
  study_level: string | null;
  subjects: string | null;
  goals: string | null;
  learning_prefs: string | null;
};

const MAX_MESSAGES = 100;
const MAX_CONTENT = 8000;

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export function conversationTitle(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "Conversation";
  return first.replace(/\s+/g, " ").trim().slice(0, 60) || "Conversation";
}

/** Crée (id null) ou met à jour la conversation. Renvoie son id, ou null si l'enregistrement a échoué (le chat continue sans). */
export async function saveConversation(id: string | null, messages: StoredMessage[]): Promise<string | null> {
  const owner = await uid();
  if (!owner || messages.length === 0) return id;
  const trimmed = messages.slice(-MAX_MESSAGES).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT), ...(m.evaluation ? { evaluation: m.evaluation } : {}) }));
  if (id) {
    const { error } = await supabase.from("assistant_conversations").update({ messages: trimmed, updated_at: new Date().toISOString() }).eq("id", id);
    return error ? null : id;
  }
  const { data, error } = await supabase
    .from("assistant_conversations")
    .insert({ owner_id: owner, title: conversationTitle(trimmed), messages: trimmed })
    .select("id")
    .single();
  return error || !data ? null : (data.id as string);
}

export async function listConversations(): Promise<SavedConversation[]> {
  const { data } = await supabase.from("assistant_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(50);
  return (data as SavedConversation[] | null) ?? [];
}

export async function loadConversation(id: string): Promise<StoredMessage[] | null> {
  const { data } = await supabase.from("assistant_conversations").select("messages").eq("id", id).maybeSingle();
  return Array.isArray(data?.messages) ? (data!.messages as StoredMessage[]) : null;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const { error } = await supabase.from("assistant_conversations").delete().eq("id", id);
  return !error;
}

export async function deleteAllConversations(): Promise<boolean> {
  const owner = await uid();
  if (!owner) return false;
  const { error } = await supabase.from("assistant_conversations").delete().eq("owner_id", owner);
  return !error;
}

export async function loadLearnerMemory(): Promise<LearnerMemoryRow | null> {
  const { data } = await supabase
    .from("learner_memory")
    .select("personalization_enabled, history_enabled, display_name, study_level, subjects, goals, learning_prefs")
    .maybeSingle();
  return (data as LearnerMemoryRow | null) ?? null;
}

export async function saveLearnerMemory(m: LearnerMemoryRow): Promise<boolean> {
  const owner = await uid();
  if (!owner) return false;
  const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const { error } = await supabase.from("learner_memory").upsert(
    {
      owner_id: owner,
      personalization_enabled: m.personalization_enabled,
      history_enabled: m.history_enabled,
      display_name: blank(m.display_name)?.slice(0, 60) ?? null,
      study_level: blank(m.study_level)?.slice(0, 80) ?? null,
      subjects: blank(m.subjects)?.slice(0, 200) ?? null,
      goals: blank(m.goals)?.slice(0, 300) ?? null,
      learning_prefs: blank(m.learning_prefs)?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );
  return !error;
}

export async function deleteLearnerMemory(): Promise<boolean> {
  const owner = await uid();
  if (!owner) return false;
  const { error } = await supabase.from("learner_memory").delete().eq("owner_id", owner);
  return !error;
}

/** Prénom pour la salutation : null si la personnalisation est désactivée. Jamais inventé (nom d'affichage ou 1er mot du nom du profil). */
export async function getGreetingName(): Promise<string | null> {
  const memory = await loadLearnerMemory();
  if (memory?.personalization_enabled === false) return null;
  let full: string | null = null;
  const owner = await uid();
  if (owner) {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", owner).maybeSingle();
    full = (data?.full_name as string | undefined) ?? null;
  }
  return greetingName(memory?.display_name, full) || null;
}
