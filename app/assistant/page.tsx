"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Crown,
  FileSearch,
  Headphones,
  HelpCircle,
  Loader2,
  Mic,
  MessageCircle,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Volume2,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import MessageContent from "@/components/MessageContent";
import { supabase } from "@/lib/supabase";
import ConversationHistory from "@/components/ConversationHistory";
import { getGreetingName, loadLearnerMemory, saveConversation, type StoredMessage } from "@/lib/conversations";
import AudioControls from "@/components/AudioControls";
import VisualExplain from "@/components/VisualExplain";
import ImageQuestion from "@/components/ImageQuestion";
import { detectDomain } from "@/lib/ai/router";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { formatUsageLabel } from "@/lib/quota-limits";
import {
  abortListening,
  isVoiceInputSupported,
  isVoiceOutputSupported,
  pauseSpeaking,
  resumeSpeaking,
  speak,
  startListening,
  stopListening,
  stopSpeaking,
  VOICE_ERROR_DICT_KEY,
} from "@/lib/voice";
import {
  AssistantError,
  AssistantRequest,
  AssistantUsage,
  ChatMessage,
  askAssistant,
  fetchAssistantUsage,
} from "@/lib/api";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  Difficulty,
  Evaluation,
  nextAdaptiveState,
} from "@/lib/adaptive";

type UiMessage = ChatMessage & { evaluation?: Evaluation | null };

type Screen = "home" | "config" | "chat";
/** Étapes de la conversation vocale : écoute → traitement (Gemini) → lecture → écoute… */
type VoicePhase = "listening" | "processing" | "speaking" | "paused";
type ConfigKind = "question" | "exercise" | "revise";
type ExerciseFormat = "one" | "series" | "quiz";

type CourseOption = { id: string; title: string; subject: string };

type FailedAttempt = {
  request: Omit<AssistantRequest, "history">;
  display: string;
};

const SUBJECT_SUGGESTIONS = [
  "Mathématiques",
  "Physique",
  "Chimie",
  "Informatique",
  "Anglais",
  "Français",
  "SVT",
  "Économie",
];

const FOLLOW_UPS = [
  "Passe à la question suivante.",
  "Donne-moi un exercice similaire.",
  "Explique-moi encore, autrement.",
];

const CONFIG_TITLES: Record<ConfigKind, { title: string; help: string; cta: string }> = {
  question: {
    title: "Commencer une question",
    help: "L'assistant te pose une question, tu réponds, puis il corrige et t'explique.",
    cta: "Poser la question",
  },
  exercise: {
    title: "Obtenir un exercice",
    help: "Un exercice, une série ou un mini-quiz, corrigés après tes réponses.",
    cta: "Générer",
  },
  revise: {
    title: "Réviser un cours",
    help: "Une fiche de révision courte, puis une question pour vérifier que c'est acquis.",
    cta: "Commencer la révision",
  },
};

/** « Gratuit - Questions IA : 2 / 5 utilisées - 3 restantes » — chiffres fournis par le serveur. */
function usageLabel(usage: AssistantUsage) {
  return formatUsageLabel(usage);
}

function evaluationBadge(evaluation: Evaluation) {
  if (evaluation === "correct") return { text: "✓ Réponse juste", cls: "bg-forest/15 text-forest" };
  if (evaluation === "partial") return { text: "≈ Partiellement juste", cls: "bg-gold/25 text-ink" };
  return { text: "✗ À revoir", cls: "bg-clay/15 text-clay" };
}

export default function AssistantPage() {
  const { t, lang } = useI18n();
  const [screen, setScreen] = useState<Screen>("home");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [greetName, setGreetName] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const convIdRef = useRef<string | null>(null);
  const historyOn = useRef(true);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [listenError, setListenError] = useState<string | null>(null);
  const stopListenRef = useRef<(() => void) | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("paused");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [speechPaused, setSpeechPaused] = useState(false);
  // Identifiant de la session vocale en cours : toute sortie / interruption l'incrémente, ce qui rend
  // « périmés » tous les rappels asynchrones d'une ancienne session (aucune réponse lue deux fois, aucune
  // écoute relancée après avoir quitté le mode vocal).
  const voiceRun = useRef(0);
  const noSpeechStreak = useRef(0);
  const userStoppedListen = useRef(false);
  const relistenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHeard = useRef<{ text: string; at: number } | null>(null);
  const [usage, setUsage] = useState<AssistantUsage | null>(null);
  const [error, setError] = useState<AssistantError | Error | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("intermediaire");
  const [streak, setStreak] = useState(0);
  const [levelNote, setLevelNote] = useState<string | null>(null);
  const [activeCourseId, setActiveCourseId] = useState<string | undefined>(undefined);

  // Écran de configuration
  const [configKind, setConfigKind] = useState<ConfigKind>("question");
  const [subject, setSubject] = useState("");
  const [chapter, setChapter] = useState("");
  const [courseId, setCourseId] = useState("");
  const [format, setFormat] = useState<ExerciseFormat>("one");
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const failed = useRef<FailedAttempt | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Valeurs courantes lisibles depuis les rappels vocaux asynchrones (qui sinon verraient un rendu périmé :
  // historique incomplet, ancien niveau de difficulté, ancienne langue).
  const messagesRef = useRef<UiMessage[]>([]);
  const sendRef = useRef<typeof send | null>(null);
  const langRef = useRef(lang);
  const tRef = useRef(t);
  messagesRef.current = messages;
  langRef.current = lang;
  tRef.current = t;

  useEffect(() => {
    setVoiceSupported(isVoiceInputSupported());
  }, []);

  // Compteur du jour : lu côté serveur, sans rien consommer.
  useEffect(() => {
    return () => {
      voiceRun.current += 1;
      if (relistenTimer.current) clearTimeout(relistenTimer.current);
      abortListening();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAssistantUsage().then((u) => {
      if (!cancelled) setUsage(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cours déjà analysés (source prioritaire possible pour l'assistant).
  useEffect(() => {
    supabase
      .from("courses")
      .select("id, title, subject")
      .not("summary", "is", null)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setCourses((data as CourseOption[] | null) ?? []));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, error]);

  // Zone de saisie qui grandit avec le texte (2 à 5 lignes).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input, screen]);

  // Salutation personnalisée (jamais inventée) + réglage « enregistrer l'historique » choisi par l'élève.
  useEffect(() => {
    let alive = true;
    (async () => {
      const memory = await loadLearnerMemory().catch(() => null);
      historyOn.current = memory?.history_enabled !== false;
      const name = await getGreetingName().catch(() => null);
      if (alive) setGreetName(name);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Enregistre la conversation (file d'attente : jamais deux créations simultanées). Un échec n'interrompt jamais le chat. */
  function persistConversation(all: StoredMessage[]) {
    if (!historyOn.current) return;
    saveChain.current = saveChain.current.then(async () => {
      const id = await saveConversation(convIdRef.current, all).catch(() => null);
      if (id) {
        convIdRef.current = id;
        setConvId(id);
      }
    });
  }

  async function send(
    request: Omit<AssistantRequest, "history">,
    display: string,
    baseMessages: UiMessage[] = messages
  ): Promise<string | null> {
    // Verrou immédiat (avant même le re-rendu) : un double clic ou un
    // double « Entrée » ne peut jamais envoyer — ni compter — deux fois.
    if (inFlight.current) return null;
    inFlight.current = true;
    setSending(true);
    setError(null);
    setLevelNote(null);
    failed.current = { request, display };

    const history: ChatMessage[] = baseMessages.map(({ role, content }) => ({ role, content }));
    setMessages([...baseMessages, { role: "user", content: display }]);
    setScreen("chat");

    try {
      const out = await askAssistant({
        ...request,
        history,
        difficulty,
        courseId: request.courseId ?? activeCourseId,
      });
      failed.current = null;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: out.reply, evaluation: out.evaluation },
      ]);
      persistConversation([
        ...baseMessages,
        { role: "user", content: display },
        { role: "assistant", content: out.reply, evaluation: out.evaluation },
      ]);
      if (out.usage) setUsage(out.usage);

      if (out.evaluation) {
        const step = nextAdaptiveState({ level: difficulty, streak }, out.evaluation);
        setDifficulty(step.level);
        setStreak(step.streak);
        if (step.changed === "up") {
          setLevelNote(`Bravo ! Niveau relevé : ${DIFFICULTY_LABELS[step.level]}.`);
        } else if (step.changed === "down") {
          setLevelNote(
            `On revient à un niveau plus accessible (${DIFFICULTY_LABELS[step.level]}) pour consolider, puis on remontera.`
          );
        }
      }
      return out.reply;
    } catch (err) {
      const e = err instanceof Error ? err : new Error("Erreur inconnue.");
      setError(e);
      if (e instanceof AssistantError && e.usage) {
        setUsage(e.usage);
      } else {
        // Une panne ne consomme rien : on relit le vrai compteur côté serveur.
        fetchAssistantUsage().then((u) => u && setUsage(u));
      }
      return null;
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  sendRef.current = send;

  function retry() {
    const attempt = failed.current;
    if (!attempt || inFlight.current) return;
    // On retire le message qui n'a pas abouti, puis on renvoie exactement la même demande.
    const withoutFailed = messages.slice(0, -1);
    void send(attempt.request, attempt.display, withoutFailed);
  }

  function toggleListening() {
    if (listening) {
      stopListenRef.current?.();
      setListening(false);
      return;
    }
    setListenError(null);
    stopSpeaking(); // le micro ne doit jamais capter la lecture vocale de l'assistant
    setListening(true);
    stopListenRef.current = startListening(
      (text) => {
        setInput((prev) => (prev ? `${prev} ${text}` : text));
      },
      (code) => setListenError(t(VOICE_ERROR_DICT_KEY[code])),
      () => setListening(false),
      lang
    );
  }

  // ------------------------------------------------------------------
  // Conversation vocale : micro → texte → Gemini (même route /api/assistant, même modèle, même clé)
  // → réponse affichée ET lue → le micro se rouvre → nouvelle question…
  // Le micro n'est JAMAIS ouvert pendant la lecture (et rouvert 0,7 s après sa fin) : l'assistant ne peut
  // donc pas « s'entendre » et prendre sa propre voix pour une nouvelle question.
  // ------------------------------------------------------------------
  function clearRelisten() {
    if (relistenTimer.current) clearTimeout(relistenTimer.current);
    relistenTimer.current = null;
  }

  function voicePause(run: number, note: string | null) {
    if (run !== voiceRun.current) return;
    clearRelisten();
    setVoicePhase("paused");
    setVoiceNote(note);
    setSpeechPaused(false);
  }

  function voiceListen(run: number) {
    if (run !== voiceRun.current || inFlight.current) return;
    clearRelisten();
    stopSpeaking();
    userStoppedListen.current = false;
    setVoicePhase("listening");
    setVoiceNote(null);
    setSpeechPaused(false);

    let outcome: "none" | "result" | "silence" | "error" = "none";
    startListening(
      (text) => {
        if (run !== voiceRun.current) return;
        outcome = "result";
        voiceHeard(run, text);
      },
      (code) => {
        if (run !== voiceRun.current) return;
        if (code === "no-speech") {
          outcome = "silence";
          return;
        }
        outcome = "error";
        voicePause(run, tRef.current(VOICE_ERROR_DICT_KEY[code]));
      },
      () => {
        if (run !== voiceRun.current || outcome === "result" || outcome === "error") return;
        if (userStoppedListen.current) {
          voicePause(run, null);
          return;
        }
        if (outcome === "silence") {
          noSpeechStreak.current += 1;
          // Deux silences d'affilée : on s'arrête au lieu d'écouter dans le vide indéfiniment.
          if (noSpeechStreak.current >= 2) {
            voicePause(run, tRef.current("voice.conv.silence"));
            return;
          }
          relistenTimer.current = setTimeout(() => voiceListen(run), 300);
          return;
        }
        voicePause(run, null);
      },
      langRef.current
    );
  }

  function voiceHeard(run: number, text: string) {
    const clean = text.trim();
    if (!clean) return;
    // Protection contre les doublons : même phrase reçue deux fois en moins de 3 s (double événement du navigateur).
    const now = Date.now();
    const last = lastHeard.current;
    if (last && last.text === clean && now - last.at < 3000) return;
    lastHeard.current = { text: clean, at: now };
    noSpeechStreak.current = 0;
    void voiceAsk(run, clean);
  }

  async function voiceAsk(run: number, text: string) {
    if (run !== voiceRun.current || inFlight.current || !sendRef.current) return;
    setVoicePhase("processing");
    setInput("");
    // Historique = messagesRef (écrit comme au clavier) : passer du vocal à l'écrit ne perd aucun contexte.
    const reply = await sendRef.current({ mode: "chat", message: text }, text, messagesRef.current);
    if (run !== voiceRun.current) return; // l'utilisateur a quitté ou interrompu pendant la requête
    if (reply === null) {
      // L'erreur (réseau, quota…) est déjà affichée dans la conversation, avec « Réessayer ».
      voicePause(run, null);
      return;
    }
    if (!isVoiceOutputSupported()) {
      voicePause(run, null);
      return;
    }
    setVoicePhase("speaking");
    setSpeechPaused(false);
    speak(
      reply,
      () => {
        if (run !== voiceRun.current) return;
        setSpeechPaused(false);
        clearRelisten();
        relistenTimer.current = setTimeout(() => voiceListen(run), 700);
      },
      langRef.current
    );
  }

  function enterVoiceMode() {
    if (inFlight.current) return;
    if (!voiceSupported) {
      setListenError(t("voice.error.unsupported"));
      return;
    }
    // Interrompt la dictée éventuelle, puis ouvre la conversation vocale sur la MÊME conversation.
    stopListenRef.current = null;
    abortListening();
    setListening(false);
    setListenError(null);
    setScreen("chat");
    // « Déverrouille » la synthèse vocale pendant ce geste utilisateur (Safari/iOS exigent un geste).
    try {
      if (isVoiceOutputSupported()) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    } catch {
      /* sans effet : la lecture se déclenchera quand même sur les navigateurs permissifs */
    }
    const run = ++voiceRun.current;
    noSpeechStreak.current = 0;
    lastHeard.current = null;
    setVoiceMode(true);
    voiceListen(run);
  }

  function exitVoiceMode() {
    voiceRun.current += 1; // périme tous les rappels en attente
    clearRelisten();
    abortListening();
    stopSpeaking();
    setVoiceMode(false);
    setVoiceNote(null);
    setSpeechPaused(false);
  }

  function voiceStopListening() {
    userStoppedListen.current = true;
    stopListening(); // ce qui a déjà été entendu est tout de même traité
  }

  function voiceInterruptSpeech() {
    // Interrompre la lecture : l'assistant se tait puis le micro se rouvre (voir onEnd de speak()).
    stopSpeaking();
  }

  function voiceToggleSpeechPause() {
    if (speechPaused) {
      resumeSpeaking();
      setSpeechPaused(false);
    } else {
      pauseSpeaking();
      setSpeechPaused(true);
    }
  }

  function voiceResume() {
    const run = ++voiceRun.current;
    noSpeechStreak.current = 0;
    voiceListen(run);
  }

  function submitChat(text: string) {
    const clean = text.trim();
    if (!clean || inFlight.current) return;
    // Une question écrite pendant la conversation vocale : on quitte proprement le mode vocal (micro et lecture
    // coupés) — l'historique reste le même, aucun conflit entre les deux modes.
    if (voiceMode) exitVoiceMode();
    setInput("");
    void send({ mode: "chat", message: clean }, clean);
  }

  function openConfig(kind: ConfigKind) {
    setConfigKind(kind);
    setConfigError(null);
    setScreen("config");
  }

  function submitConfig(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    const course = courses.find((c) => c.id === courseId);
    const cleanSubject = subject.trim() || course?.subject || "";
    const cleanChapter = chapter.trim();

    if (configKind === "revise" && !course && !cleanSubject) {
      setConfigError("Choisis un cours ou indique une matière à réviser.");
      return;
    }
    setConfigError(null);

    let mode: AssistantRequest["mode"] = "question";
    let count: number | undefined;
    let label = "Question";
    if (configKind === "exercise") {
      if (format === "series") {
        mode = "series";
        count = 3;
        label = "Série de 3 exercices";
      } else if (format === "quiz") {
        mode = "quiz";
        count = 5;
        label = "Quiz de 5 questions";
      } else {
        mode = "exercise";
        label = "Exercice";
      }
    }
    if (configKind === "revise") {
      mode = "revise";
      label = "Révision";
    }

    const parts = [
      cleanSubject || "selon mes résultats",
      cleanChapter || null,
      course ? `cours « ${course.title} »` : null,
      `niveau ${DIFFICULTY_LABELS[difficulty].toLowerCase()}`,
    ].filter(Boolean);
    const display = `${label} — ${parts.join(" · ")}`;

    setActiveCourseId(course?.id);
    void send(
      {
        mode,
        subject: cleanSubject || undefined,
        chapter: cleanChapter || undefined,
        courseId: course?.id,
        count,
      },
      display,
      []
    );
  }

  function resetConversation() {
    if (inFlight.current) return;
    if (voiceMode) exitVoiceMode();
    setMessages([]);
    convIdRef.current = null;
    setConvId(null);
    setError(null);
    setLevelNote(null);
    setActiveCourseId(undefined);
    failed.current = null;
    setScreen("home");
  }

  const quotaReached =
    (error instanceof AssistantError && error.code === "quota_exceeded") ||
    (usage !== null && usage.remaining === 0);
  const showPremium = quotaReached && !(usage?.isPremium ?? false);
  const technicalError =
    error && !(error instanceof AssistantError && error.code === "quota_exceeded");

  const levelSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="assistant-level" className="text-xs text-slate">
        Niveau
      </label>
      <select
        id="assistant-level"
        value={difficulty}
        onChange={(e) => {
          setDifficulty(e.target.value as Difficulty);
          setStreak(0);
          setLevelNote(null);
        }}
        className="rounded-card border border-mist bg-white px-2 py-1 text-xs text-ink"
      >
        {DIFFICULTIES.map((d) => (
          <option key={d} value={d}>
            {DIFFICULTY_LABELS[d]}
            {d === "examen" ? " (fixe)" : ""}
          </option>
        ))}
      </select>
    </div>
  );

  const usageBadge = usage ? (
    <p
      title={`Limite quotidienne : ${usage.limit} questions (${usage.isPremium ? "Premium" : "gratuit"}). Le compteur est tenu par le serveur et se renouvelle chaque jour.`}
      aria-live="polite"
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        usage.remaining === 0 ? "bg-clay/15 text-clay" : "bg-gold/20 text-ink"
      }`}
    >
      {usageLabel(usage)}
    </p>
  ) : null;

  return (
    <AppShell active="assistant" title="Assistant Study Helper">
      <div className="assistant-frame flex w-full flex-col rounded-card border border-mist bg-white">
        {/* ---------------- Écran d'accueil ---------------- */}
        <ConversationHistory
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          currentId={convId}
          onOpen={(id, msgs) => {
            if (inFlight.current) return;
            convIdRef.current = id;
            setConvId(id);
            setMessages(msgs as UiMessage[]);
            setError(null);
            setScreen("chat");
          }}
          onDeleted={(id) => {
            if (id === "all" || id === convIdRef.current) {
              convIdRef.current = null;
              setConvId(null);
            }
          }}
        />

        {screen === "home" && (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-xl text-ink">Que veux-tu faire aujourd'hui ?</p>
                <p className="mt-1 text-sm text-slate">
                  Study Helper AI t'aide à apprendre, comprendre, pratiquer et progresser.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setHistoryOpen(true)} className="text-xs text-slate underline hover:text-ink">
                  Historique
                </button>
                {usageBadge}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setScreen("chat");
                  setTimeout(() => textareaRef.current?.focus(), 50);
                }}
                className="flex items-start gap-3 rounded-card border border-mist p-4 text-left hover:border-ink"
              >
                <span className="rounded-card bg-clay/10 p-2 text-clay">
                  <MessageCircle size={18} />
                </span>
                <span>
                  <span className="block font-medium text-ink">Poser une question</span>
                  <span className="block text-xs text-slate">
                    Une notion, un exercice, un concept à comprendre.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => openConfig("question")}
                className="flex items-start gap-3 rounded-card border border-mist p-4 text-left hover:border-ink"
              >
                <span className="rounded-card bg-gold/20 p-2 text-ink">
                  <HelpCircle size={18} />
                </span>
                <span>
                  <span className="block font-medium text-ink">Commencer une question</span>
                  <span className="block text-xs text-slate">
                    L'assistant te questionne, puis te corrige.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => openConfig("exercise")}
                className="flex items-start gap-3 rounded-card border border-mist p-4 text-left hover:border-ink"
              >
                <span className="rounded-card bg-forest/10 p-2 text-forest">
                  <PenLine size={18} />
                </span>
                <span>
                  <span className="block font-medium text-ink">Obtenir un exercice</span>
                  <span className="block text-xs text-slate">
                    Exercice, série ou quiz adaptés à ton niveau.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => openConfig("revise")}
                className="flex items-start gap-3 rounded-card border border-mist p-4 text-left hover:border-ink"
              >
                <span className="rounded-card bg-ink/10 p-2 text-ink">
                  <BookOpen size={18} />
                </span>
                <span>
                  <span className="block font-medium text-ink">Réviser un cours</span>
                  <span className="block text-xs text-slate">
                    Fiche de révision puis question de vérification.
                  </span>
                </span>
              </button>

              {voiceSupported && (
                <button
                  type="button"
                  onClick={enterVoiceMode}
                  className="flex items-start gap-3 rounded-card border border-mist p-4 text-left hover:border-ink sm:col-span-2"
                >
                  <span className="rounded-card bg-forest/10 p-2 text-forest">
                    <Headphones size={18} />
                  </span>
                  <span>
                    <span className="block font-medium text-ink">{t("voice.conv.start")}</span>
                    <span className="block text-xs text-slate">{t("voice.conv.help")}</span>
                  </span>
                </button>
              )}

              <Link
                href="/courses"
                className="flex items-start gap-3 rounded-card border border-mist p-4 text-left hover:border-ink sm:col-span-2"
              >
                <span className="rounded-card bg-clay/10 p-2 text-clay">
                  <FileSearch size={18} />
                </span>
                <span>
                  <span className="block font-medium text-ink">Analyser un document</span>
                  <span className="block text-xs text-slate">
                    Importe un PDF, un Word, un PowerPoint ou une photo de cours dans « Mes
                    cours » : résumé et notions clés, puis révise-le ici.
                  </span>
                </span>
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-mist pt-4">
              {levelSelect}
              <p className="text-xs text-slate/70">
                Le niveau s'ajuste automatiquement selon tes réponses.
              </p>
            </div>
          </div>
        )}

        {/* ---------------- Écran de configuration ---------------- */}
        {screen === "config" && (
          <form onSubmit={submitConfig} className="flex-1 overflow-y-auto p-5 sm:p-6" noValidate>
            <button
              type="button"
              onClick={() => setScreen(messages.length > 0 ? "chat" : "home")}
              className="mb-3 flex items-center gap-1 text-xs text-slate hover:text-ink"
            >
              <ArrowLeft size={14} /> Retour
            </button>
            <p className="font-display text-xl text-ink">{CONFIG_TITLES[configKind].title}</p>
            <p className="mt-1 text-sm text-slate">{CONFIG_TITLES[configKind].help}</p>

            {configKind === "exercise" && (
              <fieldset className="mt-4">
                <legend className="mb-1 text-xs font-medium text-slate">Format</legend>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["one", "Un exercice"],
                      ["series", "Série de 3"],
                      ["quiz", "Quiz de 5 questions"],
                    ] as [ExerciseFormat, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={format === value}
                      onClick={() => setFormat(value)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${
                        format === value
                          ? "border-ink bg-ink text-paper"
                          : "border-mist text-slate hover:border-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {courses.length > 0 && (
              <div className="mt-4">
                <label htmlFor="cfg-course" className="mb-1 block text-xs font-medium text-slate">
                  {configKind === "revise" ? "Cours à réviser" : "Utiliser un de mes cours (facultatif)"}
                </label>
                <select
                  id="cfg-course"
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    const c = courses.find((x) => x.id === e.target.value);
                    if (c && !subject.trim()) setSubject(c.subject);
                  }}
                  className="w-full rounded-card border border-mist bg-white px-3 py-2 text-sm text-ink"
                >
                  <option value="">— Aucun —</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.subject} · {c.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4">
              <label htmlFor="cfg-subject" className="mb-1 block text-xs font-medium text-slate">
                Matière
              </label>
              <input
                id="cfg-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={100}
                placeholder="Ex. Mathématiques"
                className="w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUBJECT_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSubject(s)}
                    className="rounded-full border border-mist px-2.5 py-1 text-xs text-slate hover:border-ink hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="cfg-chapter" className="mb-1 block text-xs font-medium text-slate">
                Chapitre ou thème (facultatif)
              </label>
              <input
                id="cfg-chapter"
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
                maxLength={120}
                placeholder="Ex. Dérivées, Les fonctions, Thermodynamique…"
                className="w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
              />
              <p className="mt-1 text-xs text-slate/70">
                Laisse vide pour que l'assistant choisisse selon tes résultats.
              </p>
            </div>

            <div className="mt-4">{levelSelect}</div>

            {configError && <p className="mt-3 text-sm text-clay">{configError}</p>}

            <button
              type="submit"
              disabled={sending}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-card bg-clay py-3 text-sm font-medium text-paper hover:bg-clay/90 disabled:opacity-60"
            >
              {sending ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Préparation…
                </>
              ) : (
                <>
                  <Sparkles size={15} /> {CONFIG_TITLES[configKind].cta}
                </>
              )}
            </button>
          </form>
        )}

        {/* ---------------- Conversation ---------------- */}
        {screen === "chat" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mist px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                {levelSelect}
                {usageBadge}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="text-xs text-slate hover:text-ink"
                >
                  Historique
                </button>
                <button
                  type="button"
                  onClick={resetConversation}
                  disabled={sending}
                  className="flex items-center gap-1 text-xs text-slate hover:text-ink disabled:opacity-50"
                >
                  <RotateCcw size={13} /> Nouvelle conversation
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
              {messages.length === 0 && (
                <div className="rounded-card bg-mist2 px-4 py-3 text-sm text-ink">
                  <p className="font-medium">{greetName ? `Bonjour ${greetName} ! ` : "Bonjour ! "}Je suis Study Helper AI.</p>
                  <p className="mt-1 text-slate">
                    Pose-moi une question sur un cours, un exercice ou une notion. Je t'explique,
                    je te fais pratiquer, puis je te corrige.
                  </p>
                </div>
              )}

              {messages.map((m, i) => {
                const isLastAssistant = m.role === "assistant" && i === messages.length - 1;
                const badge = m.evaluation ? evaluationBadge(m.evaluation) : null;
                return (
                  <div key={i}>
                    <div
                      className={`rounded-card px-4 py-3 text-sm ${
                        m.role === "user"
                          ? "ml-auto max-w-[88%] whitespace-pre-wrap bg-ink text-paper"
                          : "max-w-[94%] bg-mist2 text-ink"
                      }`}
                    >
                      {m.role === "user" ? m.content : <MessageContent text={m.content} />}
                    </div>
                    {m.role === "assistant" && <AudioControls text={m.content} />}
                    {m.role === "assistant" && (
                      <VisualExplain
                        topic={messages[i - 1]?.role === "user" ? messages[i - 1].content : m.content.slice(0, 200)}
                        context={m.content}
                        autoStart={i === messages.length - 1 && messages[i - 1]?.role === "user" && detectDomain({ mode: "chat", message: messages[i - 1].content }) === "visual"}
                      />
                    )}
                    {badge && (
                      <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>
                        {badge.text}
                      </span>
                    )}
                    {isLastAssistant && !sending && !error && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(m.evaluation ? FOLLOW_UPS : FOLLOW_UPS.slice(1)).map((text) => (
                          <button
                            key={text}
                            type="button"
                            onClick={() => submitChat(text)}
                            className="rounded-full border border-mist px-3 py-1 text-xs text-slate hover:border-ink hover:text-ink"
                          >
                            {text.replace(/\.$/, "")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {levelNote && (
                <p role="status" className="rounded-card bg-gold/20 px-3 py-2 text-xs text-ink">
                  {levelNote}
                </p>
              )}

              {sending && (
                <div className="flex w-fit items-center gap-2 rounded-card bg-mist2 px-4 py-3 text-sm text-slate">
                  <Loader2 size={14} className="animate-spin" /> L'assistant réfléchit…
                </div>
              )}

              {technicalError && (
                <div role="alert" className="rounded-card border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">
                  <p>{error?.message}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {failed.current && (
                      <button
                        type="button"
                        onClick={retry}
                        className="rounded-card bg-clay px-3 py-1.5 text-xs font-medium text-paper hover:bg-clay/90"
                      >
                        Réessayer
                      </button>
                    )}
                    {error instanceof AssistantError && error.code === "unauthenticated" && (
                      <Link href="/login" className="text-xs underline">
                        Se reconnecter
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* Premium : UNIQUEMENT quand le serveur a confirmé que le quota du jour est épuisé. */}
              {showPremium && (
                <div role="alert" className="rounded-card border border-gold/50 bg-gold/15 px-4 py-3 text-sm text-ink">
                  <p>
                    Tu as utilisé tes {usage?.limit ?? ""} questions gratuites du jour. Tu pourras continuer
                    lorsque ton quota sera renouvelé demain, ou passer Premium pour en poser beaucoup plus.
                  </p>
                  <Link
                    href="/profile"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-card bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold/90"
                  >
                    <Crown size={13} /> Voir l'abonnement Premium
                  </Link>
                </div>
              )}
              {quotaReached && usage?.isPremium && (
                <p role="alert" className="rounded-card bg-gold/15 px-4 py-3 text-sm text-ink">
                  Ta limite quotidienne est atteinte. Elle sera renouvelée demain.
                </p>
              )}

              <div ref={bottomRef} />
            </div>

            {voiceMode && (
              <div role="status" aria-live="polite" className="border-t border-mist bg-mist2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm text-ink">
                    {voicePhase === "listening" && (
                      <>
                        <span className="relative flex h-3 w-3">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-clay opacity-60" />
                          <span className="relative inline-flex h-3 w-3 rounded-full bg-clay" />
                        </span>
                        {t("voice.conv.listening")}
                      </>
                    )}
                    {voicePhase === "processing" && (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        {t("voice.conv.processing")}
                      </>
                    )}
                    {voicePhase === "speaking" && (
                      <>
                        <Volume2 size={15} className={speechPaused ? "" : "animate-pulse"} />
                        {speechPaused ? t("voice.conv.readingPaused") : t("voice.conv.speaking")}
                      </>
                    )}
                    {voicePhase === "paused" && (
                      <>
                        <Mic size={15} />
                        {t("voice.conv.paused")}
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {voicePhase === "listening" && (
                      <button
                        type="button"
                        onClick={voiceStopListening}
                        className="flex items-center gap-1 rounded-full bg-clay px-3 py-1.5 text-xs font-medium text-paper hover:bg-clay/90"
                      >
                        <Square size={12} /> {t("voice.conv.stopListening")}
                      </button>
                    )}
                    {voicePhase === "speaking" && (
                      <>
                        <button
                          type="button"
                          onClick={voiceToggleSpeechPause}
                          className="flex items-center gap-1 rounded-full border border-mist bg-white px-3 py-1.5 text-xs text-ink hover:border-ink"
                        >
                          {speechPaused ? <Play size={12} /> : <Pause size={12} />}
                          {speechPaused ? t("audio.resume") : t("audio.pause")}
                        </button>
                        <button
                          type="button"
                          onClick={voiceInterruptSpeech}
                          className="flex items-center gap-1 rounded-full bg-clay px-3 py-1.5 text-xs font-medium text-paper hover:bg-clay/90"
                        >
                          <Square size={12} /> {t("voice.conv.interrupt")}
                        </button>
                      </>
                    )}
                    {voicePhase === "paused" && (
                      <button
                        type="button"
                        onClick={voiceResume}
                        disabled={sending}
                        className="flex items-center gap-1 rounded-full bg-clay px-3 py-1.5 text-xs font-medium text-paper hover:bg-clay/90 disabled:opacity-60"
                      >
                        <Play size={12} /> {t("voice.conv.resume")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={exitVoiceMode}
                      className="flex items-center gap-1 rounded-full border border-mist bg-white px-3 py-1.5 text-xs text-slate hover:border-ink hover:text-ink"
                    >
                      <X size={12} /> {t("voice.conv.exit")}
                    </button>
                  </div>
                </div>
                {voiceNote && <p className="mt-2 text-xs text-clay">{voiceNote}</p>}
              </div>
            )}

            <ImageQuestion />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitChat(input);
              }}
              className="flex items-end gap-2 border-t border-mist p-3 sm:p-4"
            >
              <label htmlFor="assistant-input" className="sr-only">
                Ta question
              </label>
              <textarea
                id="assistant-input"
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitChat(input);
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder="Écris ta question ou ta réponse…"
                className="max-h-32 flex-1 resize-none rounded-card border border-mist px-4 py-2.5 text-sm outline-none focus:border-ink"
              />
              {voiceSupported && !voiceMode && (
                <button
                  type="button"
                  onClick={enterVoiceMode}
                  disabled={sending}
                  aria-label={t("voice.conv.start")}
                  title={t("voice.conv.start")}
                  className="rounded-card border border-mist p-3 text-slate hover:border-ink hover:text-ink disabled:opacity-50"
                >
                  <Headphones size={18} />
                </button>
              )}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={voiceMode}
                  aria-label={listening ? t("voice.stop") : t("voice.listen")}
                  className={`rounded-card p-3 disabled:opacity-40 ${
                    listening
                      ? "animate-pulse bg-clay text-paper"
                      : "border border-mist text-slate hover:border-ink hover:text-ink"
                  }`}
                >
                  <Mic size={18} />
                </button>
              )}
              <button
                type="submit"
                aria-label="Envoyer"
                disabled={sending || !input.trim()}
                className="rounded-card bg-clay p-3 text-paper hover:bg-clay/90 disabled:opacity-50"
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </form>
            {listenError && (
              <p role="alert" className="px-4 pb-2 text-xs text-clay sm:px-5">
                {listenError}
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
