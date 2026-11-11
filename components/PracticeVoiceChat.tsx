"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ear, Loader2, Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { languageHeader, getStoredLanguage } from "@/lib/i18n/client";
import { practiceVoiceText } from "@/lib/i18n/practice-voice-strings";
import type { LangCode } from "@/lib/i18n/languages";
import {
  isVoiceInputSupported, isVoiceOutputSupported, speak, startListening, stopSpeaking, VOICE_ERROR_DICT_KEY,
  type VoiceErrorCode,
} from "@/lib/voice";
import type { DictKey } from "@/lib/i18n/dictionaries";

type Msg = { role: "user" | "assistant"; content: string };
type Phase = "idle" | "listening" | "thinking" | "speaking";
const MAX_SILENCES = 2; // après 2 silences d'affilée, on met le micro en pause au lieu d'écouter dans le vide

/**
 * Conversation vocale avec le professeur de Pratique.
 * Chaîne réelle : micro (reconnaissance du navigateur ou transcription serveur de lib/voice) → /api/practice
 * (Gemini, clé côté serveur uniquement) → lecture à voix haute (synthèse du navigateur) → nouvelle écoute.
 * Ce N'EST PAS une API audio temps réel : il y a un délai entre la question et la réponse.
 */
export default function PracticeVoiceChat({
  lang, subject, level, courseId, history, onTurn, onError, t,
}: {
  lang: LangCode; subject: string; level: string; courseId: string;
  history: Msg[];
  onTurn: (user: string, assistant: string, engine?: string) => void;
  onError: (message: string | null) => void;
  t: (key: DictKey) => string;
}) {
  const pv = (k: Parameters<typeof practiceVoiceText>[1]) => practiceVoiceText(lang, k);
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [micOn, setMicOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [heard, setHeard] = useState("");
  const [note, setNote] = useState<string | null>(null);

  // Valeurs lues par les rappels asynchrones (toujours les plus récentes).
  const run = useRef(0); // identifiant de session : une session terminée rend ses rappels « périmés »
  const micRef = useRef(true);
  const soundRef = useRef(true);
  const historyRef = useRef<Msg[]>(history);
  const silences = useRef(0);
  const stopListenRef = useRef<(() => void) | null>(null);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const propsRef = useRef({ subject, level, courseId, lang });
  const handleHeardRef = useRef<(id: number, text: string) => Promise<void>>(async () => {});
  historyRef.current = history;
  propsRef.current = { subject, level, courseId, lang };

  const inputOk = typeof window !== "undefined" && isVoiceInputSupported();
  const outputOk = typeof window !== "undefined" && isVoiceOutputSupported();

  const halt = useCallback(() => {
    stopListenRef.current?.(); stopListenRef.current = null;
    stopSpeakRef.current?.(); stopSpeakRef.current = null;
    stopSpeaking();
  }, []);

  // Quitter la page : plus de micro ouvert, plus de voix.
  useEffect(() => () => { run.current++; halt(); }, [halt]);

  async function ask(text: string): Promise<{ reply: string; engine?: string } | null> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const p = propsRef.current;
    const res = await fetch("/api/practice", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        action: "explain", message: text, subject: p.subject, level: p.level,
        language: getStoredLanguage() ?? undefined, ...(p.courseId ? { courseId: p.courseId } : {}),
        history: historyRef.current.slice(-8),
      }),
    });
    const json = (await res.json().catch(() => null)) as { reply?: string; code?: string; engine?: string } | null;
    if (!res.ok) {
      const c = json?.code;
      throw new Error(c === "not_configured" ? t("practice.notConfigured") : c === "quota_exceeded" ? t("practice.quota") : c === "too_many_requests" ? t("practice.tooMany") : t("practice.error"));
    }
    if (!json?.reply?.trim()) return null;
    return { reply: json.reply, engine: json.engine };
  }

  const listen = useCallback((id: number) => {
    if (run.current !== id) return;
    if (!micRef.current) { setPhase("idle"); return; }
    setPhase("listening");
    let gotResult = false;
    stopListenRef.current = startListening(
      (text) => { gotResult = true; silences.current = 0; void handleHeardRef.current(id, text); },
      (code: VoiceErrorCode) => {
        if (run.current !== id) return;
        if (code === "no-speech") return; // géré dans onEnd
        gotResult = true; // erreur déjà traitée : pas de relance automatique
        onError(t(VOICE_ERROR_DICT_KEY[code]));
        if (code === "denied" || code === "no-mic" || code === "unsupported" || code === "lang-unsupported" || code === "unavailable") endConversation();
        else { micRef.current = false; setMicOn(false); setPhase("idle"); } // réseau : pause, l'élève réactive le micro
      },
      () => {
        if (run.current !== id || gotResult) return;
        silences.current++;
        if (silences.current > MAX_SILENCES) {
          micRef.current = false; setMicOn(false); setPhase("idle"); setNote(pv("noSpeech")); silences.current = 0;
        } else listen(id);
      },
      propsRef.current.lang
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleHeard(id: number, text: string) {
    if (run.current !== id) return;
    const clean = text.trim();
    if (!clean) { listen(id); return; }
    setHeard(clean); setNote(null); onError(null); setPhase("thinking");
    try {
      const out = await ask(clean);
      if (run.current !== id) return;
      if (!out) { setNote(pv("emptyReply")); listen(id); return; }
      onTurn(clean, out.reply, out.engine);
      if (soundRef.current && outputOk) {
        setPhase("speaking");
        stopSpeakRef.current = speak(out.reply, () => { stopSpeakRef.current = null; listen(id); }, propsRef.current.lang);
      } else listen(id);
    } catch (e) {
      if (run.current !== id) return;
      onError(e instanceof Error && e.message ? e.message : t("error.network"));
      micRef.current = false; setMicOn(false); setPhase("idle");
    }
  }

  handleHeardRef.current = handleHeard; // toujours la version la plus récente (langue, rappels du parent)

  function startConversation() {
    if (!inputOk) { setNote(pv("unsupported")); return; }
    onError(null); setNote(outputOk ? null : pv("noOutput"));
    run.current++;
    micRef.current = true; setMicOn(true); silences.current = 0; setHeard("");
    setActive(true);
    listen(run.current);
  }

  function endConversation() {
    run.current++;
    halt();
    setActive(false); setPhase("idle"); setHeard("");
  }

  function toggleMic() {
    const next = !micRef.current;
    micRef.current = next; setMicOn(next);
    if (!next) { stopListenRef.current?.(); stopListenRef.current = null; if (phase === "listening") setPhase("idle"); }
    else if (phase === "idle") { silences.current = 0; setNote(null); listen(run.current); }
  }

  function toggleSound() {
    const next = !soundRef.current;
    soundRef.current = next; setSoundOn(next);
    if (!next && phase === "speaking") {
      // Couper le son pendant une lecture : on l'arrête et on reprend l'écoute.
      stopSpeakRef.current?.(); stopSpeakRef.current = null; stopSpeaking();
      listen(run.current);
    }
  }

  const btn = "flex h-9 items-center gap-1.5 rounded-card border px-3 text-xs";
  return (
    <div className="mb-3 rounded-card border border-mist bg-white p-3" aria-live="polite">
      {!active ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={startConversation} className="flex h-10 items-center gap-2 rounded-card bg-ink px-4 text-sm font-medium text-paper">
            <Mic size={16} /> {pv("start")}
          </button>
          <p className="min-w-[12rem] flex-1 text-xs text-slate">{inputOk ? pv("mode") : pv("unsupported")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 text-sm text-ink">
              {phase === "listening" && <><Ear size={16} className="animate-pulse text-clay" /> {pv("listening")}</>}
              {phase === "thinking" && <><Loader2 size={16} className="animate-spin" /> {pv("thinking")}</>}
              {phase === "speaking" && <><Volume2 size={16} className="animate-pulse text-forest" /> {pv("speaking")}</>}
              {phase === "idle" && <><MicOff size={16} className="text-slate" /> {pv("paused")}</>}
            </span>
            <span className="flex-1" />
            <button type="button" onClick={toggleMic} aria-pressed={micOn} className={`${btn} ${micOn ? "border-ink text-ink" : "border-mist text-slate"}`}>
              {micOn ? <Mic size={14} /> : <MicOff size={14} />} {micOn ? pv("micOn") : pv("micOff")}
            </button>
            <button type="button" onClick={toggleSound} aria-pressed={soundOn} disabled={!outputOk} className={`${btn} ${soundOn ? "border-ink text-ink" : "border-mist text-slate"} disabled:opacity-50`}>
              {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />} {soundOn ? pv("soundOn") : pv("soundOff")}
            </button>
            <button type="button" onClick={endConversation} className={`${btn} border-clay text-clay`}>
              <PhoneOff size={14} /> {pv("end")}
            </button>
          </div>
          {heard && <p className="text-xs text-slate"><span className="font-medium">{pv("heard")}</span> {heard}</p>}
        </div>
      )}
      {note && <p role="status" className="mt-2 text-xs text-amber-700">{note}</p>}
    </div>
  );
}
