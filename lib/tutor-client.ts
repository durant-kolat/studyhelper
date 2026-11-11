// Client navigateur de /api/tutor. Le jeton de session est joint à chaque appel (c'est lui, vérifié côté
// serveur, qui identifie l'utilisateur) ; la progression et les quotas restent décidés par le serveur.
import { languageHeader } from "@/lib/i18n/client";
import { supabase } from "./supabase";

export type TutorState = {
  sessionId: string;
  status: "active" | "paused" | "stopped" | "completed";
  index: number;
  count: number;
  maxIndex: number;
  paragraph: string;
  truncated: boolean;
  currentQuestion: string | null;
  attempts: number;
  voiceCounted: boolean;
  done: boolean;
};
export type Verdict = "correct" | "partial" | "incorrect" | "unclear";
export type TutorFinal = { summary: string; keyNotions: string[]; quiz: { question: string; answer: string }[]; weakNotions: string[] };

export type TutorResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function call<T>(body: Record<string, unknown>): Promise<TutorResult<T>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch("/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: String(json.code ?? "server_error"), message: String(json.error ?? "") };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "network", message: "" };
  }
}

export const tutorApi = {
  status: (courseId: string) =>
    call<{ resumable: { sessionId: string; index: number; count: number; lastActivityAt: string } | null }>({ action: "status", courseId }),
  start: (courseId: string, mode: "new" | "resume", sessionId?: string) =>
    call<{ state: TutorState; title: string }>({ action: "start", courseId, mode, sessionId }),
  teach: (sessionId: string, variant: "first" | "other") =>
    call<{ explanation: string; question: string; paragraphLang: string; state: TutorState }>({ action: "teach", sessionId, variant }),
  answer: (sessionId: string, answer: string, via: "text" | "voice") =>
    call<{ verdict: Verdict; feedback: string; example: string; advanced: boolean; reformulated: boolean; state: TutorState }>({ action: "answer", sessionId, answer, via }),
  ask: (sessionId: string, question: string, via: "text" | "voice", history: { role: "user" | "assistant"; content: string }[]) =>
    call<{ reply: string; state: TutorState }>({ action: "ask", sessionId, question, via, history }),
  goto: (sessionId: string, index: number) => call<{ state: TutorState }>({ action: "goto", sessionId, index }),
  skip: (sessionId: string) => call<{ state: TutorState }>({ action: "skip", sessionId }),
  pause: (sessionId: string, status: "paused" | "stopped") => call<{ ok: boolean }>({ action: "pause", sessionId, status }),
  voiceStart: (sessionId: string) => call<{ ok: boolean }>({ action: "voice_start", sessionId }),
  finish: (sessionId: string) => call<{ final: TutorFinal }>({ action: "finish", sessionId }),
};

/**
 * Prépare le texte d'un document (extraction locale côté serveur, sans Gemini ni quota d'analyse).
 * Renvoie le texte, ou un code d'erreur (no_text : PDF scanné / image illisible).
 */
export const courseTextApi = {
  ensure: async (courseId: string): Promise<TutorResult<{ text: string; extracted: boolean }>> => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/course-text", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ courseId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, code: String(json.code ?? "server_error"), message: String(json.error ?? "") };
      return { ok: true, data: json as { text: string; extracted: boolean } };
    } catch {
      return { ok: false, code: "network", message: "" };
    }
  },
};
