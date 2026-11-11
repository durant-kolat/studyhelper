"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import AudioControls from "@/components/AudioControls";
import { askQuestionChat, type QuestionChatAction, type QuestionChatMessage } from "@/lib/api";
import { chatIndexFor } from "@/lib/exam-open";

const ACTIONS: { id: QuestionChatAction; label: string }[] = [
  { id: "understand", label: "Comprendre mon erreur" },
  { id: "rephrase", label: "Explique autrement" },
  { id: "steps", label: "Montre-moi les étapes" },
  { id: "example", label: "Donne-moi un exemple" },
  { id: "similar", label: "Propose un exercice similaire" },
];

/** Chat privé sous une question corrigée. Le serveur relit lui-même l'énoncé, la réponse, le corrigé et l'explication : rien à recopier. */
export default function ExamQuestionChat({ resultId, index, part = "A" }: { resultId: string; index: number; part?: "A" | "B" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<QuestionChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");

  async function openChat() {
    if (open) return;
    setOpen(true);
    // Lecture de l'historique : protégée par RLS (seul le propriétaire voit ses conversations).
    const { data } = await supabase
      .from("exam_question_chats")
      .select("messages")
      .eq("result_id", resultId)
      .eq("question_index", chatIndexFor(part, index))
      .maybeSingle();
    if (Array.isArray(data?.messages)) setMessages(data!.messages as QuestionChatMessage[]);
  }

  async function send(payload: { action: QuestionChatAction } | { message: string }) {
    if (busy) return;
    setError(null);
    setOpen(true);
    setBusy(true);
    const label = "action" in payload ? ACTIONS.find((a) => a.id === payload.action)!.label : payload.message;
    setMessages((m) => [...m, { role: "user", content: label }]);
    try {
      const r = await askQuestionChat(resultId, index, payload, part);
      setMessages(r.messages);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Le tuteur IA a échoué.");
      setMessages((m) => m.slice(0, -1)); // le message non traité n'est pas gardé
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-mist pt-3">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => send({ action: a.id })}
            className="rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:bg-mist2 disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
        {!open && (
          <button type="button" onClick={openChat} className="rounded-card px-3 py-1.5 text-xs text-slate underline">
            Voir ma conversation
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap rounded-card px-3 py-2 text-sm ${m.role === "user" ? "ml-6 bg-mist2 text-ink" : "mr-6 border border-mist bg-white text-ink"}`}
            >
              {m.content}
              {m.role === "assistant" && <AudioControls text={m.content} />}
            </div>
          ))}
          {busy && <p className="text-xs text-slate">Le tuteur réfléchit…</p>}
          {error && <p role="alert" className="text-xs text-clay">{error}</p>}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) send({ message: input.trim() });
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={1000}
              placeholder="Pose ta question sur cet exercice…"
              className="min-w-0 flex-1 rounded-card border border-mist px-3 py-2 text-sm"
            />
            <button type="submit" disabled={busy || !input.trim()} className="rounded-card bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">
              Envoyer
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
