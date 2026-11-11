"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2, Mic, Pause, Phone, PhoneOff, Play, RefreshCw, Send, SkipForward, Square, Undo2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { isLangCode, type LangCode } from "@/lib/i18n/languages";
import { tutorText, type TutorKey } from "@/lib/i18n/tutor-strings";
import { looksLikeQuestion, nextLiveStep } from "@/lib/tutor/live";
import { tutorApi, type TutorFinal, type TutorResult, type TutorState, type Verdict } from "@/lib/tutor-client";
import {
  abortListening,
  isVoiceInputSupported,
  isVoiceOutputSupported,
  pauseSpeaking,
  resumeSpeaking,
  speak,
  startListening,
  stopSpeaking,
  VOICE_ERROR_DICT_KEY,
} from "@/lib/voice";

// Séance « Étudier avec mon professeur IA ».
// Voix : micro → texte → même service Gemini (via /api/tutor) → réponse affichée ET lue (synthèse du navigateur).
// Anti-écho : le micro ne s'ouvre JAMAIS tout seul et la lecture est coupée avant qu'il s'ouvre ; une seule lecture à la fois.
// Anti-boucle : aucun appel IA automatique — chaque appel part d'un geste de l'élève (réponse, question, « autre explication »,
// « continuer »). Si la voix échoue, la saisie écrite reste toujours disponible.

type Phase = "boot" | "resumePrompt" | "teaching" | "finished" | "error";
type Feedback = { verdict: Verdict; text: string; example: string; advanced: boolean };
type SpeechItem = { text: string; lang: LangCode };

export default function TutorSession({ courseId, title, live: startLive = false, onClose }: { courseId: string; title: string; live?: boolean; onClose: () => void }) {
  const { lang, t } = useI18n();
  const tt = useCallback((key: TutorKey, vars?: Record<string, string | number>) => tutorText(lang, key, vars), [lang]);

  const [phase, setPhase] = useState<Phase>("boot");
  const [resumable, setResumable] = useState<{ sessionId: string; index: number; count: number } | null>(null);
  const [state, setState] = useState<TutorState | null>(null);
  const [explanation, setExplanation] = useState("");
  const [question, setQuestion] = useState("");
  const [paragraphLang, setParagraphLang] = useState<LangCode>(lang);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [askReply, setAskReply] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"answer" | "ask">("answer");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [live, setLive] = useState(startLive); // appel en direct : mains libres, sans jamais de boucle IA automatique
  const [silenceStreak, setSilenceStreak] = useState(0);
  const [final, setFinal] = useState<TutorFinal | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const busyRef = useRef(false); // garde synchrone contre le double clic
  const speechToken = useRef(0); // invalide une lecture en cours quand une nouvelle commence / quand on quitte
  const stopListenRef = useRef<(() => void) | null>(null);
  const lastHeard = useRef<{ text: string; at: number } | null>(null);
  const askHistory = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const lastSpeech = useRef<SpeechItem[]>([]);
  const mounted = useRef(true);
  const sessionRef = useRef<string | null>(null);
  const modeRef = useRef<"answer" | "ask">("answer"); // valeurs courantes pour les rappels du micro (évite les valeurs périmées)
  const stateRef = useRef<TutorState | null>(null);
  const liveRef = useRef(startLive);
  const booted = useRef(false); // le démarrage ne doit se produire qu'UNE fois (React Strict Mode rejoue les effets en développement)

  modeRef.current = mode;
  liveRef.current = live;
  stateRef.current = state;

  // ------------------------------------------------------------------ messages d'erreur (par code, dans la langue choisie)
  const errorText = useCallback(
    (code: string): string => {
      if (code === "quota_exceeded") return tt("errQuota");
      if (code === "budget_exceeded") return tt("errBudget");
      if (code === "no_text") return tt("errNoText");
      return tt("errGeneric");
    },
    [tt]
  );

  // ------------------------------------------------------------------ lecture à voix haute (séquence, sans chevauchement)
  const stopAllAudio = useCallback(() => {
    speechToken.current += 1;
    stopSpeaking();
    setSpeaking(false);
    setPaused(false);
  }, []);

  const playSequence = useCallback(
    (items: SpeechItem[]) => {
      lastSpeech.current = items;
      stopAllAudio();
      const clean = items.filter((i) => i.text.trim());
      if (!isVoiceOutputSupported() || clean.length === 0) return;
      const token = speechToken.current;
      setSpeaking(true);
      const next = (i: number) => {
        if (token !== speechToken.current || !mounted.current) return;
        if (i >= clean.length) {
          setSpeaking(false);
          setPaused(false);
          return;
        }
        speak(clean[i].text, () => next(i + 1), clean[i].lang);
      };
      next(0);
    },
    [stopAllAudio]
  );

  function togglePause() {
    if (!speaking) return;
    if (paused) {
      resumeSpeaking();
      setPaused(false);
    } else {
      pauseSpeaking();
      setPaused(true);
    }
  }

  // ------------------------------------------------------------------ appels serveur (une seule opération à la fois)
  async function guarded<T>(fn: () => Promise<TutorResult<T>>): Promise<TutorResult<T> | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      if (!r.ok) setNotice(errorText(r.code));
      return r;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const loadParagraph = useCallback(
    async (s: TutorState, variant: "first" | "other") => {
      const r = await guarded(() => tutorApi.teach(s.sessionId, variant));
      if (!r || !r.ok || !mounted.current) return;
      const d = r.data;
      setState(d.state);
      setExplanation(d.explanation);
      setQuestion(d.question);
      setFeedback(null);
      setAskReply(null);
      setMode("answer");
      const pl: LangCode = isLangCode(d.paragraphLang) ? d.paragraphLang : lang;
      setParagraphLang(pl);
      // Le paragraphe est lu dans SA langue, l'explication et la question dans la langue choisie par l'élève.
      playSequence([
        ...(variant === "first" ? [{ text: s.paragraph, lang: pl }] : []),
        { text: d.explanation, lang },
        { text: d.question, lang },
      ]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, playSequence]
  );

  const begin = useCallback(
    async (mode: "new" | "resume", sessionId?: string) => {
      const r = await guarded(() => tutorApi.start(courseId, mode, sessionId));
      if (!r) return;
      if (!r.ok) {
        setPhase("error");
        return;
      }
      sessionRef.current = r.data.state.sessionId;
      setState(r.data.state);
      setPhase("teaching");
      busyRef.current = false; // la suite (teach) est un nouvel appel volontaire de la séance
      await loadParagraph(r.data.state, "first");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseId, loadParagraph]
  );

  // Démarrage : une séance en cours est proposée à la reprise (aucun essai consommé) ; sinon nouvelle séance.
  useEffect(() => {
    mounted.current = true;
    if (!booted.current) {
      booted.current = true;
      void (async () => {
      const r = await tutorApi.status(courseId);
      if (!mounted.current) return;
      if (r.ok && r.data.resumable) {
        setResumable(r.data.resumable);
        setPhase("resumePrompt");
      } else {
        await begin("new");
      }
      })();
    }
    return () => {
      mounted.current = false;
      speechToken.current += 1;
      stopSpeaking();
      abortListening();
      stopListenRef.current?.();
      if (sessionRef.current) void tutorApi.pause(sessionRef.current, "paused"); // la séance reste reprenable
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ réponse / question
  async function submit(text: string, via: "text" | "voice") {
    const clean = text.trim();
    const state = stateRef.current;
    // En appel en direct, une question parlée part comme question libre ; sinon on suit le mode choisi.
    const mode = via === "voice" && liveRef.current && looksLikeQuestion(clean) ? "ask" : modeRef.current;
    if (!clean || !state || busyRef.current) return;
    stopAllAudio();
    if (mode === "ask") {
      const r = await guarded(() => tutorApi.ask(state.sessionId, clean, via, askHistory.current.slice(-4)));
      if (!r || !r.ok || !mounted.current) return;
      askHistory.current = [...askHistory.current, { role: "user" as const, content: clean }, { role: "assistant" as const, content: r.data.reply.slice(0, 700) }].slice(-4);
      setAskReply(r.data.reply);
      setInput("");
      playSequence([{ text: r.data.reply, lang }]);
      return;
    }
    const r = await guarded(() => tutorApi.answer(state.sessionId, clean, via));
    if (!r || !r.ok || !mounted.current) return;
    const d = r.data;
    setState(d.state);
    setInput("");
    setFeedback({ verdict: d.verdict, text: d.feedback, example: d.example, advanced: d.advanced });
    playSequence([
      { text: d.feedback, lang },
      ...(d.example ? [{ text: d.example, lang }] : []),
    ]);
    if (!d.advanced && d.state.currentQuestion) setQuestion(d.state.currentQuestion);
  }

  async function continueCourse() {
    if (!state || busyRef.current) return;
    if (state.done) {
      await finishCourse();
      return;
    }
    await loadParagraph(state, "first");
  }

  async function otherExplanation() {
    if (!state || busyRef.current) return;
    stopAllAudio();
    await loadParagraph(state, "other");
  }

  async function goBack() {
    if (!state || busyRef.current || state.index === 0) return;
    stopAllAudio();
    const r = await guarded(() => tutorApi.goto(state.sessionId, state.index - 1));
    if (!r || !r.ok) return;
    setState(r.data.state);
    busyRef.current = false;
    await loadParagraph(r.data.state, "first");
  }

  async function skip() {
    if (!state || busyRef.current) return;
    stopAllAudio();
    const r = await guarded(() => tutorApi.skip(state.sessionId));
    if (!r || !r.ok) return;
    setState(r.data.state);
    busyRef.current = false;
    if (r.data.state.done) await finishCourse();
    else await loadParagraph(r.data.state, "first");
  }

  async function finishCourse() {
    if (!state) return;
    busyRef.current = false;
    setPhase("finished");
    const r = await guarded(() => tutorApi.finish(state.sessionId));
    if (r && r.ok && mounted.current) setFinal(r.data.final);
  }

  async function stopSession() {
    stopAllAudio();
    abortListening();
    if (sessionRef.current) await tutorApi.pause(sessionRef.current, "paused");
    sessionRef.current = null;
    onClose();
  }

  // ------------------------------------------------------------------ micro
  /** Ouvre le micro UNE fois (après avoir compté la séance vocale, une seule fois par séance). */
  async function startListen(): Promise<boolean> {
    const st = stateRef.current;
    if (!st || busyRef.current) return false;
    if (!isVoiceInputSupported() || voiceBlocked) {
      setNotice(tt("voiceFallback"));
      return false;
    }
    if (!st.voiceCounted) {
      const v = await guarded(() => tutorApi.voiceStart(st.sessionId));
      if (!v || !v.ok) {
        setVoiceBlocked(true); // quota vocal atteint ou erreur : retour à la saisie écrite, sans bloquer le reste
        return false;
      }
      setState((cur) => (cur ? { ...cur, voiceCounted: true } : cur));
      stateRef.current = { ...st, voiceCounted: true };
    }
    // Le micro ne doit jamais capter la voix du professeur.
    stopAllAudio();
    setNotice(null);
    setListening(true);
    stopListenRef.current = startListening(
      (text) => {
        const clean = text.trim();
        if (!clean) return;
        const now = Date.now();
        const last = lastHeard.current;
        if (last && last.text === clean && now - last.at < 3000) return; // double événement du navigateur
        lastHeard.current = { text: clean, at: now };
        setSilenceStreak(0);
        setInput(clean);
        void submit(clean, "voice");
      },
      (code) => {
        if (code === "no-speech") {
          setSilenceStreak((n) => n + 1); // en direct : 2 silences d'affilée → on raccroche
          return;
        }
        // Permission refusée, réseau, micro absent… : on quitte l'appel et on repasse à l'écrit, sans rien bloquer.
        setLive(false);
        setNotice(`${t(VOICE_ERROR_DICT_KEY[code])} ${tt("voiceFallback")}`);
      },
      () => setListening(false),
      lang
    );
    return true;
  }

  async function toggleMic() {
    if (listening) {
      stopListenRef.current?.();
      return;
    }
    setSilenceStreak(0);
    await startListen();
  }

  function toggleLive() {
    if (live) {
      setLive(false);
      stopListenRef.current?.();
      abortListening();
      setListening(false);
      return;
    }
    setSilenceStreak(0);
    setLive(true);
  }

  // Appel en direct : décision pure et testée (lib/tutor/live.ts). Un seul geste à la fois ; aucun appel IA sans parole de l'élève.
  useEffect(() => {
    const step = nextLiveStep({
      live,
      phase,
      hasExplanation: !!explanation,
      speaking,
      busy,
      listening,
      advancePending: !!feedback?.advanced,
      silenceStreak,
    });
    if (step === "none") return;
    if (step === "hangup") {
      setLive(false);
      return;
    }
    const id = setTimeout(() => {
      if (step === "continue") void continueCourse();
      else void startListen().then((ok) => { if (!ok) setLive(false); });
    }, 700); // laisse la synthèse vocale se terminer complètement avant d'ouvrir le micro
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, phase, explanation, speaking, busy, listening, feedback, silenceStreak]);

  // ------------------------------------------------------------------ rendu
  const verdictKey: Record<Verdict, TutorKey> = { correct: "vCorrect", partial: "vPartial", incorrect: "vIncorrect", unclear: "vUnclear" };
  const verdictStyle: Record<Verdict, string> = {
    correct: "bg-gold/15 text-ink",
    partial: "bg-mist/60 text-ink",
    incorrect: "bg-clay/10 text-clay",
    unclear: "bg-mist/60 text-ink",
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label={tt("cta")}>
      <header className="flex items-center gap-2 border-b border-mist px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{title}</p>
          {state && <p className="text-xs text-slate">{tt("paragraph", { n: state.index + 1, total: state.count })}</p>}
        </div>
        {phase === "teaching" && isVoiceInputSupported() && !voiceBlocked && (
          <button
            type="button"
            onClick={toggleLive}
            className={`flex items-center gap-1 rounded-card px-3 py-1.5 text-xs ${live ? "bg-clay text-white" : "border border-mist text-ink hover:border-ink"}`}
          >
            {live ? <PhoneOff size={14} /> : <Phone size={14} />} {live ? tt("liveStop") : tt("liveStart")}
          </button>
        )}
        <button type="button" onClick={stopSession} className="flex items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink">
          <X size={14} /> {tt("stop")}
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {notice && (
          <p role="alert" className="rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">
            {notice}
          </p>
        )}

        {live && phase === "teaching" && (
          <p className="flex items-center gap-2 rounded-card bg-gold/15 px-3 py-2 text-xs text-ink">
            <Phone size={13} /> {listening ? tt("listening") : tt("liveOn")}
          </p>
        )}

        {phase === "boot" && (
          <p className="flex items-center gap-2 text-sm text-slate">
            <Loader2 size={16} className="animate-spin" /> {tt("loading")}
          </p>
        )}

        {phase === "resumePrompt" && resumable && (
          <div className="space-y-3 rounded-card border border-mist p-4">
            <p className="text-sm text-ink">{tt("resumeAsk", { n: resumable.index + 1, total: resumable.count })}</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => begin("resume", resumable.sessionId)} className="rounded-card bg-gold px-4 py-2 text-sm font-medium text-ink disabled:opacity-60">
                {tt("resume")}
              </button>
              <button type="button" disabled={busy} onClick={() => begin("new")} className="rounded-card border border-mist px-4 py-2 text-sm text-ink hover:border-ink disabled:opacity-60">
                {tt("newSession")}
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <button type="button" onClick={onClose} className="rounded-card border border-mist px-4 py-2 text-sm text-ink hover:border-ink">
            {tt("stop")}
          </button>
        )}

        {phase === "teaching" && state && (
          <>
            {state.truncated && <p className="text-xs text-slate">{tt("truncated")}</p>}
            <blockquote className="rounded-card border-l-4 border-gold bg-gold/10 px-3 py-2 text-sm text-ink" lang={paragraphLang}>
              {state.paragraph}
            </blockquote>

            {busy && !explanation && (
              <p className="flex items-center gap-2 text-sm text-slate">
                <Loader2 size={16} className="animate-spin" /> {tt("loading")}
              </p>
            )}

            {explanation && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate">{tt("explanation")}</p>
                <p className="whitespace-pre-wrap text-sm text-ink">{explanation}</p>
                <p className="text-xs font-medium uppercase tracking-wide text-slate">{tt("question")}</p>
                <p className="text-sm font-medium text-ink">{state.currentQuestion ?? question}</p>
              </div>
            )}

            {feedback && (
              <div className={`space-y-1 rounded-card px-3 py-2 text-sm ${verdictStyle[feedback.verdict]}`}>
                <p className="font-medium">{tt(verdictKey[feedback.verdict])}</p>
                <p className="whitespace-pre-wrap">{feedback.text}</p>
                {feedback.example && <p className="whitespace-pre-wrap text-xs opacity-90">{feedback.example}</p>}
                {feedback.advanced && (
                  <button type="button" disabled={busy} onClick={continueCourse} className="mt-2 rounded-card bg-gold px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-60">
                    {state.done ? tt("summaryBtn") : tt("cont")}
                  </button>
                )}
              </div>
            )}

            {askReply && (
              <div className="space-y-2 rounded-card border border-mist px-3 py-2 text-sm text-ink">
                <p className="whitespace-pre-wrap">{askReply}</p>
                <button type="button" onClick={() => { setAskReply(null); setMode("answer"); playSequence([{ text: explanation, lang }, { text: state.currentQuestion ?? question, lang }]); }} className="rounded-card border border-mist px-3 py-1.5 text-xs hover:border-ink">
                  {tt("cont")}
                </button>
              </div>
            )}
          </>
        )}

        {phase === "finished" && (
          <div className="space-y-4">
            <p className="font-medium text-ink">{tt("finished")}</p>
            {busy && !final && (
              <p className="flex items-center gap-2 text-sm text-slate">
                <Loader2 size={16} className="animate-spin" /> {tt("loading")}
              </p>
            )}
            {!final && !busy && state && (
              <button type="button" onClick={finishCourse} className="rounded-card bg-gold px-4 py-2 text-sm font-medium text-ink">
                {tt("summaryBtn")}
              </button>
            )}
            {final && (
              <>
                <section>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate">{tt("summary")}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{final.summary}</p>
                </section>
                {final.keyNotions.length > 0 && (
                  <section>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate">{tt("notions")}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                      {final.keyNotions.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {final.weakNotions.length > 0 && (
                  <section>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate">{tt("toReview")}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                      {final.weakNotions.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate">{tt("quiz")}</p>
                  {final.quiz.map((q, i) => (
                    <div key={i} className="rounded-card border border-mist px-3 py-2 text-sm">
                      <p className="text-ink">{q.question}</p>
                      {revealed[i] ? (
                        <p className="mt-1 text-slate">{q.answer}</p>
                      ) : (
                        <button type="button" onClick={() => setRevealed((r) => ({ ...r, [i]: true }))} className="mt-1 text-xs text-clay">
                          {tt("showAnswer")}
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              </>
            )}
          </div>
        )}
      </div>

      {phase === "teaching" && state && explanation && (
        <footer className="space-y-2 border-t border-mist px-4 py-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={togglePause} disabled={!speaking} className="flex items-center gap-1 rounded-card border border-mist px-2.5 py-1.5 text-ink hover:border-ink disabled:opacity-40">
              {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? tt("play") : tt("pause")}
            </button>
            <button type="button" onClick={() => playSequence(lastSpeech.current)} className="flex items-center gap-1 rounded-card border border-mist px-2.5 py-1.5 text-ink hover:border-ink">
              <Undo2 size={13} /> {tt("replay")}
            </button>
            <button type="button" onClick={otherExplanation} disabled={busy} className="flex items-center gap-1 rounded-card border border-mist px-2.5 py-1.5 text-ink hover:border-ink disabled:opacity-40">
              <RefreshCw size={13} /> {tt("other")}
            </button>
            <button type="button" onClick={goBack} disabled={busy || state.index === 0} className="flex items-center gap-1 rounded-card border border-mist px-2.5 py-1.5 text-ink hover:border-ink disabled:opacity-40">
              <ChevronLeft size={13} /> {tt("back")}
            </button>
            <button type="button" onClick={skip} disabled={busy} className="flex items-center gap-1 rounded-card border border-mist px-2.5 py-1.5 text-ink hover:border-ink disabled:opacity-40">
              <SkipForward size={13} /> {tt("skip")}
            </button>
          </div>

          <div className="flex gap-1 text-xs">
            {(["answer", "ask"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-card px-3 py-1 ${mode === m ? "bg-ink text-white" : "border border-mist text-ink"}`}
              >
                {m === "answer" ? tt("modeAnswer") : tt("modeAsk")}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? tt("listening") : mode === "answer" ? tt("answerPh") : tt("askPh")}
              rows={2}
              maxLength={mode === "answer" ? 2000 : 1000}
              disabled={busy}
              className="min-h-[44px] flex-1 resize-none rounded-card border border-mist px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
            />
            {isVoiceInputSupported() && !voiceBlocked && (
              <button
                type="button"
                onClick={toggleMic}
                disabled={busy && !listening}
                aria-label={tt("mic")}
                title={tt("mic")}
                className={`rounded-card p-2.5 ${listening ? "bg-clay text-white" : "border border-mist text-ink hover:border-ink"} disabled:opacity-40`}
              >
                {listening ? <Square size={18} /> : <Mic size={18} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => submit(input, "text")}
              disabled={busy || !input.trim()}
              aria-label={tt("send")}
              title={tt("send")}
              className="rounded-card bg-gold p-2.5 text-ink disabled:opacity-40"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
