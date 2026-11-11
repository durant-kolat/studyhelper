"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import {
  Send,
  FileText,
  HelpCircle,
  CalendarDays,
  Video,
  MessageCircle,
  Plus,
  Trash2,
  Users,
  Sparkles,
  Mic,
  Square,
  Volume2,
  Loader2,
} from "lucide-react";
import { getStoredLanguage } from "@/lib/i18n/client";
import { askAssistant, AssistantError, joinGroup } from "@/lib/api";
import { GROUPS_PREMIUM_MESSAGE, isPremiumActive } from "@/lib/group-access";
import MessageContent from "@/components/MessageContent";
import {
  isVoiceInputSupported,
  isVoiceOutputSupported,
  speak,
  startListening,
  stopSpeaking,
  type VoiceErrorCode,
} from "@/lib/voice";

// Cette mini-discussion de groupe n'utilise pas lib/i18n (toujours en français) : messages d'erreur
// alignés sur le reste de la page plutôt que sur les dictionnaires de lib/i18n/dictionaries.
const VOICE_ERROR_FR: Record<VoiceErrorCode, string> = {
  unsupported: "La reconnaissance vocale n'est pas prise en charge par ce navigateur.",
  denied: "Micro refusé — autorise l'accès au micro dans les réglages de ton navigateur.",
  "no-speech": "Aucune parole détectée, réessaie.",
  "no-mic": "Aucun micro détecté, ou il est déjà utilisé par une autre application.",
  network: "Problème réseau pendant la reconnaissance vocale.",
  "lang-unsupported": "Ce navigateur n'a pas de reconnaissance vocale pour cette langue.",
  unavailable: "La reconnaissance vocale a rencontré un problème. Réessaie, ou écris ton message.",
};

type Message = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type GroupDocument = {
  id: string;
  shared_by: string;
  course: { id: string; title: string; subject: string } | null;
};

type MyCourse = { id: string; title: string; subject: string };

type Question = {
  id: string;
  author_id: string;
  content: string;
  created_at: string;
  answers: { id: string; author_id: string; content: string }[];
};

type Tab = "chat" | "documents" | "questions" | "members" | "planning" | "call" | "ai";

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const [groupName, setGroupName] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  // "loading" tant qu'on ne sait pas ; "premium" = abonnement Premium requis ;
  // "join" = Premium actif mais pas encore membre (rejoindre est gratuit).
  const [access, setAccess] = useState<"loading" | "ok" | "premium" | "join">("loading");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      setUserId(uid);
      const { data: group } = await supabase
        .from("groups")
        .select("name, owner_id")
        .eq("id", groupId)
        .single();
      setGroupName(group?.name ?? "Groupe");
      setOwnerId(group?.owner_id ?? null);

      if (!uid) return setAccess("premium");

      // Affichage seulement : la règle « Premium actif requis » est appliquée par la base
      // (RLS sur tous les contenus du groupe) — le navigateur ne peut pas la contourner.
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_status, subscription_expires_at")
        .eq("id", uid)
        .maybeSingle();
      if (!isPremiumActive(profile?.subscription_status, profile?.subscription_expires_at)) {
        return setAccess("premium");
      }

      const { data: membership } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("user_id", uid)
        .maybeSingle();
      setAccess(membership ? "ok" : "join");
    }
    load();
  }, [groupId]);

  return (
    <AppShell active="groups" title={groupName}>
      {access === "loading" && <p className="text-sm text-slate">Chargement…</p>}
      {(access === "premium" || access === "join") && (
        <AccessGate groupId={groupId} needsPremium={access === "premium"} onJoined={() => setAccess("ok")} />
      )}
      {access === "ok" && (
      <>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: "chat", label: "Chat", icon: MessageCircle },
          { key: "documents", label: "Documents", icon: FileText },
          { key: "questions", label: "Questions", icon: HelpCircle },
          { key: "members", label: "Membres", icon: Users },
          { key: "planning", label: "Planning", icon: CalendarDays },
          { key: "call", label: "Audio/vidéo", icon: Video },
          { key: "ai", label: "Assistant", icon: Sparkles },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as Tab)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
              tab === t.key ? "bg-ink text-paper" : "border border-mist text-slate"
            }`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "chat" && <ChatTab groupId={groupId} userId={userId} />}
      {tab === "documents" && <DocumentsTab groupId={groupId} userId={userId} />}
      {tab === "questions" && <QuestionsTab groupId={groupId} userId={userId} />}
      {tab === "members" && (
        <MembersTab groupId={groupId} userId={userId} isOwner={userId !== null && userId === ownerId} />
      )}
      {tab === "planning" && <PlanningTab groupId={groupId} userId={userId} />}
      {tab === "call" && <CallTab groupId={groupId} />}
      {tab === "ai" && <GroupAssistantTab />}
      </>
      )}
    </AppShell>
  );
}

function ChatTab({ groupId, userId }: { groupId: string; userId: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const { data: msgs } = await supabase
        .from("group_messages")
        .select("id, user_id, content, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true });
      setMessages(msgs ?? []);
    }
    load();

    const channel = supabase
      .channel(`group-${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message])
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !userId) return;
    setInput("");
    await supabase.from("group_messages").insert({
      group_id: groupId,
      user_id: userId,
      content: text,
    });
  }

  return (
    <div className="flex h-[calc(100vh-260px)] flex-col rounded-card border border-mist bg-white">
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <p className="text-sm text-slate">
            Aucun message pour l'instant — lance la discussion.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-md rounded-card px-4 py-2.5 text-sm ${
                m.user_id === userId ? "ml-auto bg-ink text-paper" : "bg-mist2 text-ink"
              }`}
            >
              {m.content}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-mist p-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Écris un message…"
          className="flex-1 rounded-card border border-mist px-4 py-2.5 text-sm outline-none focus:border-ink"
        />
        <button
          type="submit"
          aria-label="Envoyer"
          disabled={!input.trim()}
          className="rounded-card bg-clay p-2.5 text-paper hover:bg-clay/90 disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

function DocumentsTab({ groupId, userId }: { groupId: string; userId: string | null }) {
  const [docs, setDocs] = useState<GroupDocument[]>([]);
  const [myCourses, setMyCourses] = useState<MyCourse[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase
      .from("group_documents")
      .select("id, shared_by, course:courses(id, title, subject)")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });
    setDocs((data as unknown as GroupDocument[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [groupId]);

  async function openPicker() {
    if (!userId) return;
    const { data } = await supabase
      .from("courses")
      .select("id, title, subject")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });
    setMyCourses(data ?? []);
    setShowPicker(true);
  }

  async function shareCourse(courseId: string) {
    if (!userId) return;
    await supabase.from("group_documents").insert({
      group_id: groupId,
      course_id: courseId,
      shared_by: userId,
    });
    setShowPicker(false);
    load();
  }

  async function removeDoc(id: string) {
    await supabase.from("group_documents").delete().eq("id", id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={openPicker}
          className="flex items-center gap-2 rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90"
        >
          <Plus size={16} /> Partager un de mes cours
        </button>
      </div>

      {showPicker && (
        <div className="mb-6 rounded-card border border-mist bg-white p-4">
          <p className="mb-2 text-sm text-slate">Choisis un cours à partager :</p>
          {myCourses.length === 0 ? (
            <p className="text-sm text-slate">
              Tu n'as pas encore de cours importé (voir "Mes cours").
            </p>
          ) : (
            <div className="space-y-2">
              {myCourses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => shareCourse(c.id)}
                  className="flex w-full items-center justify-between rounded-card border border-mist px-3 py-2 text-left text-sm hover:border-ink"
                >
                  <span>{c.title}</span>
                  <span className="text-xs text-slate">{c.subject}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-slate">
          Aucun document partagé pour l'instant dans ce groupe.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-start gap-3 rounded-card border border-mist bg-white p-4">
              <FileText size={18} className="mt-0.5 shrink-0 text-clay" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{d.course?.title ?? "Document supprimé"}</p>
                <p className="text-xs text-slate">{d.course?.subject}</p>
              </div>
              {d.shared_by === userId && (
                <button onClick={() => removeDoc(d.id)} className="text-slate hover:text-clay">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionsTab({ groupId, userId }: { groupId: string; userId: string | null }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data: qs } = await supabase
      .from("group_questions")
      .select("id, author_id, content, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });

    const questionIds = (qs ?? []).map((q) => q.id);
    const { data: answers } = questionIds.length
      ? await supabase
          .from("group_answers")
          .select("id, question_id, author_id, content")
          .in("question_id", questionIds)
      : { data: [] };

    setQuestions(
      (qs ?? []).map((q) => ({
        ...q,
        answers: (answers ?? []).filter((a) => a.question_id === q.id),
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [groupId]);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestion.trim() || !userId) return;
    await supabase.from("group_questions").insert({
      group_id: groupId,
      author_id: userId,
      content: newQuestion.trim(),
    });
    setNewQuestion("");
    load();
  }

  async function handleAnswer(questionId: string) {
    const answer = answerDrafts[questionId]?.trim();
    if (!answer || !userId) return;
    await supabase.from("group_answers").insert({
      group_id: groupId,
      question_id: questionId,
      author_id: userId,
      content: answer,
    });
    setAnswerDrafts((prev) => ({ ...prev, [questionId]: "" }));
    load();
  }

  return (
    <div>
      <form onSubmit={handleAsk} className="mb-6 flex gap-2">
        <input
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="Pose une question au groupe…"
          className="flex-1 rounded-card border border-mist px-4 py-2.5 text-sm outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={!newQuestion.trim()}
          className="rounded-card bg-clay px-4 py-2.5 text-sm text-paper hover:bg-clay/90 disabled:opacity-50"
        >
          Poser
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : questions.length === 0 ? (
        <p className="text-sm text-slate">Aucune question pour l'instant.</p>
      ) : (
        <div className="space-y-4">
          {questions.map((q) => (
            <div key={q.id} className="rounded-card border border-mist bg-white p-4">
              <p className="text-sm font-medium text-ink">{q.content}</p>
              {q.answers.length > 0 && (
                <div className="mt-3 space-y-2 border-l-2 border-mist pl-3">
                  {q.answers.map((a) => (
                    <p key={a.id} className="text-sm text-slate">
                      {a.content}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <input
                  value={answerDrafts[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswerDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                  placeholder="Répondre…"
                  className="flex-1 rounded-card border border-mist px-3 py-1.5 text-xs outline-none focus:border-ink"
                />
                <button
                  onClick={() => handleAnswer(q.id)}
                  disabled={!answerDrafts[q.id]?.trim()}
                  className="rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink disabled:opacity-50"
                >
                  Envoyer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Membres — liste + invitation par le propriétaire (recherche par nom)
// ---------------------------------------------------------------------------

type Member = { user_id: string; role: string; full_name: string | null };

function MembersTab({
  groupId,
  userId,
  isOwner,
}: {
  groupId: string;
  userId: string | null;
  isOwner: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; full_name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("group_members")
      .select("user_id, role, profile:profiles(full_name)")
      .eq("group_id", groupId);
    setMembers(
      ((data ?? []) as unknown as { user_id: string; role: string; profile: { full_name: string | null } | null }[]).map(
        (m) => ({ user_id: m.user_id, role: m.role, full_name: m.profile?.full_name ?? null })
      )
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setNotice(null);
    const { data, error } = await supabase.rpc("search_profiles", { query: q });
    setSearching(false);
    if (error) {
      setNotice("Recherche indisponible pour l'instant.");
      return;
    }
    const memberIds = new Set(members.map((m) => m.user_id));
    setResults(((data ?? []) as { id: string; full_name: string }[]).filter((r) => !memberIds.has(r.id)));
  }

  async function handleAdd(personId: string) {
    setNotice(null);
    const { error } = await supabase
      .from("group_members")
      .insert({ group_id: groupId, user_id: personId, role: "member" });
    if (error) {
      setNotice("Impossible d'ajouter cette personne (déjà membre ?).");
      return;
    }
    setResults((prev) => prev.filter((r) => r.id !== personId));
    await load();
  }

  return (
    <div className="space-y-5">
      {isOwner && (
        <div className="rounded-card border border-mist bg-white p-4">
          <p className="mb-2 text-sm font-medium text-ink">Inviter quelqu'un</p>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Nom de la personne à ajouter"
              className="flex-1 rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="rounded-card bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : "Chercher"}
            </button>
          </div>
          {notice && <p className="mt-2 text-xs text-clay">{notice}</p>}
          {results.length > 0 && (
            <ul className="mt-3 space-y-2">
              {results.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-card bg-mist2 px-3 py-2 text-sm"
                >
                  <span className="text-ink">{r.full_name}</span>
                  <button
                    onClick={() => handleAdd(r.id)}
                    className="flex items-center gap-1 text-xs text-clay hover:underline"
                  >
                    <Plus size={12} /> Ajouter
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-card border border-mist bg-white p-4">
        <p className="mb-3 text-sm font-medium text-ink">
          {members.length} membre{members.length > 1 ? "s" : ""}
        </p>
        {loading ? (
          <p className="text-sm text-slate">Chargement…</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center justify-between rounded-card bg-mist2 px-3 py-2 text-sm"
              >
                <span className="text-ink">
                  {m.full_name ?? "Utilisateur"}
                  {m.user_id === userId && " (toi)"}
                </span>
                <span className="text-xs text-slate">
                  {m.role === "owner" ? "Propriétaire" : "Membre"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Planning — séances de révision partagées par le groupe
// ---------------------------------------------------------------------------

type ScheduleItem = {
  id: string;
  title: string;
  subject: string | null;
  item_date: string;
  start_time: string;
  end_time: string;
  created_by: string;
};

function PlanningTab({ groupId, userId }: { groupId: string; userId: string | null }) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    subject: "",
    item_date: "",
    start_time: "",
    end_time: "",
  });

  async function load() {
    const { data } = await supabase
      .from("group_schedule_items")
      .select("id, title, subject, item_date, start_time, end_time, created_by")
      .eq("group_id", groupId)
      .order("item_date", { ascending: true })
      .order("start_time", { ascending: true });
    setItems((data as ScheduleItem[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !form.title.trim() || !form.item_date || !form.start_time || !form.end_time) return;
    await supabase.from("group_schedule_items").insert({
      group_id: groupId,
      created_by: userId,
      title: form.title.trim(),
      subject: form.subject.trim() || null,
      item_date: form.item_date,
      start_time: form.start_time,
      end_time: form.end_time,
    });
    setForm({ title: "", subject: "", item_date: "", start_time: "", end_time: "" });
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    await supabase.from("group_schedule_items").delete().eq("id", id);
    load();
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="flex items-center gap-1.5 rounded-card bg-ink px-4 py-2 text-sm text-paper"
      >
        <Plus size={14} /> Programmer une séance
      </button>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-card border border-mist bg-white p-4"
        >
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Titre (ex. Révision chapitre 3)"
            required
            className="w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Matière (facultatif)"
            className="w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="date"
              value={form.item_date}
              onChange={(e) => setForm({ ...form, item_date: e.target.value })}
              required
              className="rounded-card border border-mist px-2 py-2 text-sm outline-none focus:border-ink"
            />
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              required
              className="rounded-card border border-mist px-2 py-2 text-sm outline-none focus:border-ink"
            />
            <input
              type="time"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              required
              className="rounded-card border border-mist px-2 py-2 text-sm outline-none focus:border-ink"
            />
          </div>
          <button
            type="submit"
            className="rounded-card bg-clay px-4 py-2 text-sm text-paper hover:bg-clay/90"
          >
            Ajouter au planning
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate">Aucune séance programmée pour l'instant.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between rounded-card border border-mist bg-white px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-ink">{it.title}</p>
                <p className="text-xs text-slate">
                  {it.item_date} · {it.start_time.slice(0, 5)}–{it.end_time.slice(0, 5)}
                  {it.subject ? ` · ${it.subject}` : ""}
                </p>
              </div>
              {it.created_by === userId && (
                <button
                  onClick={() => handleDelete(it.id)}
                  aria-label="Supprimer"
                  className="text-slate hover:text-clay"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio/vidéo — appel de groupe via Jitsi Meet (gratuit, sans backend,
// une salle par groupe identifiée par son id).
// ---------------------------------------------------------------------------

function CallTab({ groupId }: { groupId: string }) {
  const [joined, setJoined] = useState(false);
  const roomName = `study-helper-${groupId}`;

  if (!joined) {
    return (
      <div className="rounded-card border border-mist bg-white p-8 text-center">
        <Video size={28} className="mx-auto mb-3 text-clay" />
        <p className="mb-1 text-sm font-medium text-ink">Appel de groupe</p>
        <p className="mb-4 text-xs text-slate">
          Audio ou vidéo, directement dans le navigateur — personne d'autre
          que les membres présents dans cet appel n'y a accès.
        </p>
        <button
          onClick={() => setJoined(true)}
          className="rounded-card bg-clay px-5 py-2.5 text-sm text-paper hover:bg-clay/90"
        >
          Rejoindre l'appel
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-mist bg-black">
      <iframe
        title="Appel de groupe"
        src={`https://meet.jit.si/${roomName}#config.prejoinPageEnabled=true`}
        allow="camera; microphone; fullscreen; display-capture; autoplay"
        className="h-[calc(100vh-260px)] w-full"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant IA — accessible à chaque membre depuis le groupe (conversation
// personnelle, pas partagée : chacun consomme son propre quota).
// ---------------------------------------------------------------------------

function GroupAssistantTab() {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const stopListenRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      stopListenRef.current?.();
      stopSpeaking();
    };
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history);
    setSending(true);
    try {
      const res = await askAssistant({ message: text, history: messages, mode: "chat" });
      setMessages([...history, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setError(
        err instanceof AssistantError
          ? err.message
          : "L'assistant est momentanément indisponible."
      );
    } finally {
      setSending(false);
    }
  }

  function toggleListening() {
    if (listening) {
      stopListenRef.current?.();
      setListening(false);
      return;
    }
    setListening(true);
    stopListenRef.current = startListening(
      (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
      (code) => setError(VOICE_ERROR_FR[code]),
      () => setListening(false),
      getStoredLanguage() ?? undefined // langue choisie dans l'application, pas celle du navigateur
    );
  }

  function toggleSpeak(index: number, text: string) {
    if (speakingIndex === index) {
      stopSpeaking();
      setSpeakingIndex(null);
      return;
    }
    setSpeakingIndex(index);
    speak(text, () => setSpeakingIndex(null));
  }

  return (
    <div className="flex h-[calc(100vh-260px)] flex-col rounded-card border border-mist bg-white">
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <p className="text-sm text-slate">
            Pose une question à l'assistant, juste pour toi — ça ne compte
            pas pour les autres membres du groupe.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-md" : "max-w-md"}>
              <div
                className={`rounded-card px-4 py-2.5 text-sm ${
                  m.role === "user" ? "bg-ink text-paper" : "bg-mist2 text-ink"
                }`}
              >
                {m.role === "user" ? m.content : <MessageContent text={m.content} />}
              </div>
              {m.role === "assistant" && isVoiceOutputSupported() && (
                <button
                  type="button"
                  onClick={() => toggleSpeak(i, m.content)}
                  className="mt-1 flex items-center gap-1 text-xs text-slate hover:text-ink"
                >
                  {speakingIndex === i ? <Square size={12} /> : <Volume2 size={12} />}
                  {speakingIndex === i ? "Arrêter" : "Écouter"}
                </button>
              )}
            </div>
          ))
        )}
        {sending && <Loader2 size={16} className="animate-spin text-slate" />}
        {error && <p className="text-xs text-clay">{error}</p>}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} className="flex gap-2 border-t border-mist p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Écris ta question…"
          className="flex-1 rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
        />
        {isVoiceInputSupported() && (
          <button
            type="button"
            onClick={toggleListening}
            aria-label="Parler à l'assistant"
            className={`rounded-card p-2.5 ${
              listening ? "animate-pulse bg-clay text-paper" : "border border-mist text-slate"
            }`}
          >
            <Mic size={16} />
          </button>
        )}
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Envoyer"
          className="rounded-card bg-clay p-2.5 text-paper disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accès aux groupes — inclus dans Premium (aucun paiement séparé)
// ---------------------------------------------------------------------------

function AccessGate({
  groupId,
  needsPremium,
  onJoined,
}: {
  groupId: string;
  needsPremium: boolean;
  onJoined: () => void;
}) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      await joinGroup(groupId);
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de rejoindre ce groupe.");
      setJoining(false);
    }
  }

  if (needsPremium) {
    return (
      <div className="mx-auto max-w-sm rounded-card border border-mist bg-white p-6 text-center">
        <p className="mb-1 font-display text-lg text-ink">Réservé aux abonnés Premium</p>
        <p className="mb-4 text-sm text-slate">{GROUPS_PREMIUM_MESSAGE}</p>
        <a
          href="/profile"
          className="inline-block w-full rounded-card bg-gold px-4 py-2.5 text-sm font-medium text-ink hover:bg-gold/90"
        >
          Passer Premium
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm rounded-card border border-mist bg-white p-6 text-center">
      <p className="mb-1 font-display text-lg text-ink">Rejoindre ce groupe</p>
      <p className="mb-4 text-sm text-slate">
        Ton abonnement Premium inclut l&apos;accès aux groupes : rejoindre est gratuit.
      </p>
      <button
        onClick={handleJoin}
        disabled={joining}
        className="w-full rounded-card bg-clay px-4 py-2.5 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
      >
        {joining ? "Connexion au groupe…" : "Rejoindre le groupe"}
      </button>
      {error && <p role="alert" className="mt-3 text-xs text-clay">{error}</p>}
    </div>
  );
}
