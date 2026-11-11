"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Mic, RotateCcw, Send, Upload, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import MessageContent from "@/components/MessageContent";
import AudioControls from "@/components/AudioControls";
import VisualExplain from "@/components/VisualExplain";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { getStoredLanguage, languageHeader } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";
import PracticeVoiceChat from "@/components/PracticeVoiceChat";
import { isVoiceInputSupported, startListening, VOICE_ERROR_DICT_KEY } from "@/lib/voice";
import CameraCapture, { type CapturedPage } from "@/components/CameraCapture";
import { captureText } from "@/lib/capture-strings";
import { toJpeg } from "@/lib/capture";

type Action = "exercise" | "solve" | "correct" | "examples" | "explain" | "progress";
type Level = "debutant" | "intermediaire" | "avance";
type Turn = { role: "user" | "assistant"; content: string; engine?: string };
type CourseOption = { id: string; title: string; subject: string };

const ACTIONS: Action[] = ["exercise", "solve", "correct", "examples", "explain", "progress"];
const LEVELS: Level[] = ["debutant", "intermediaire", "avance"];

/** « Pratique » : exercices, résolution guidée, correction, exemples, explications, progression — moteur Gemini n°2 (Gemini 3.5 Flash-Lite). */
export default function PracticePage() {
  const { t, lang } = useI18n();
  const [action, setAction] = useState<Action>("exercise");
  const [level, setLevel] = useState<Level>("intermediaire");
  const [subject, setSubject] = useState("");
  const [courseId, setCourseId] = useState("");
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [listening, setListening] = useState(false);
  const stopListenRef = useRef<(() => void) | null>(null);
  // Image jointe (importée ou filmée) : envoyée à l'analyse d'image avec la question de l'élève.
  const [image, setImage] = useState<CapturedPage | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setImage(await toJpeg(file));
    } catch {
      setError(t("error.file"));
    } finally {
      if (imageInput.current) imageInput.current.value = "";
    }
  }

  async function sendImage() {
    if (!image || busy) return;
    setBusy(true);
    setError(null);
    const userText = input.trim();
    const preview = image.dataUrl;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const question = [
        `${t(`practice.mode.${action}` as DictKey)}${subject ? ` — ${subject}` : ""}`,
        userText,
      ].filter(Boolean).join("\n").slice(0, 1000);
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ question, mimeType: "image/jpeg", data: preview.split(",")[1] ?? "", language: getStoredLanguage() ?? undefined }),
      });
      const json = (await res.json().catch(() => null)) as { reply?: string; error?: string; code?: string; engine?: string } | null;
      if (!res.ok || !json?.reply) {
        const code = json?.code;
        setError(
          code === "not_configured" ? t("practice.notConfigured")
          : code === "quota_exceeded" ? t("practice.quota")
          : code === "too_many_requests" ? t("practice.tooMany")
          : t("practice.error")
        );
        return;
      }
      const reply = json.reply;
      setTurns((prev) => [
        ...prev,
        { role: "user" as const, content: userText ? `${captureText(lang, "imageSent")}\n${userText}` : captureText(lang, "imageSent") },
        { role: "assistant" as const, content: reply, engine: json.engine },
      ]);
      setInput("");
      setImage(null);
    } catch {
      setError(t("error.network"));
    } finally {
      setBusy(false);
    }
  }

  // Quitter la page ne doit pas laisser le micro écouter dans le vide.
  useEffect(() => {
    return () => stopListenRef.current?.();
  }, []);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data } = await supabase.from("courses").select("id, title, subject").eq("owner_id", userData.user.id).order("created_at", { ascending: false }).limit(50);
      setCourses((data as CourseOption[] | null) ?? []);
    })();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const needsText = action !== "exercise" && action !== "progress";

  function toggleListening() {
    if (listening) {
      stopListenRef.current?.();
      setListening(false);
      return;
    }
    setError(null);
    setListening(true);
    stopListenRef.current = startListening(
      (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
      (code) => setError(t(VOICE_ERROR_DICT_KEY[code])),
      () => setListening(false),
      lang
    );
  }

  async function send() {
    if (busy) return;
    if (image) return sendImage();
    if (needsText && input.trim().length < 2 && !courseId) return;
    setBusy(true);
    setError(null);
    const userText = input.trim();
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          action,
          message: userText,
          subject,
          level,
          language: getStoredLanguage() ?? undefined,
          ...(courseId ? { courseId } : {}),
          history: turns.slice(-8),
        }),
      });
      const json = (await res.json().catch(() => null)) as { reply?: string; error?: string; code?: string; engine?: string } | null;
      if (!res.ok || !json?.reply) {
        const code = json?.code;
        setError(
          code === "not_configured" ? t("practice.notConfigured")
          : code === "quota_exceeded" ? t("practice.quota")
          : code === "too_many_requests" ? t("practice.tooMany")
          : t("practice.error")
        );
        return;
      }
      const reply = json.reply;
      setTurns((prev) => [
        ...prev,
        ...(userText ? [{ role: "user" as const, content: userText }] : []),
        { role: "assistant" as const, content: reply, engine: json.engine },
      ]);
      setInput("");
    } catch {
      setError(t("error.network"));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-card border border-mist bg-white px-3 py-2 text-sm outline-none focus:border-ink";

  return (
    <AppShell active="practice" title={t("practice.title")}>
      <p className="mb-4 text-sm text-slate">{t("practice.intro")}</p>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={t("practice.title")}>
        {ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={action === a}
            onClick={() => setAction(a)}
            className={`rounded-full border px-3 py-1.5 text-xs ${action === a ? "border-ink bg-ink text-paper" : "border-mist bg-white text-slate hover:border-ink"}`}
          >
            {t(`practice.mode.${a}` as DictKey)}
          </button>
        ))}
      </div>

      <PracticeVoiceChat
        lang={lang} subject={subject} level={level} courseId={courseId}
        history={turns.map((x) => ({ role: x.role, content: x.content }))}
        onTurn={(u, a, engine) => setTurns((prev) => [...prev, { role: "user", content: u }, { role: "assistant", content: a, engine }])}
        onError={setError} t={t}
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} placeholder={t("practice.subject")} aria-label={t("practice.subject")} className={field} />
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label={t("practice.course")} className={field}>
          <option value="">{t("practice.noCourse")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value as Level)} aria-label={t("practice.level")} className={field}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(`practice.level.${l}` as DictKey)}
            </option>
          ))}
        </select>
      </div>

      {/* La zone de discussion occupe la hauteur de l'écran : la barre de saisie reste en bas, bien visible. */}
      <div className="min-h-[calc(100dvh-24rem)] space-y-3">
        {turns.length === 0 && !busy && <p className="rounded-card border border-dashed border-mist p-4 text-sm text-slate">{t("practice.empty")}</p>}
        {turns.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-auto max-w-[90%] rounded-card bg-ink px-3 py-2 text-sm text-paper" : "max-w-[96%] rounded-card border border-mist bg-white p-3 text-sm text-ink"}>
            {m.role === "assistant" ? (
              <>
                <MessageContent text={m.content} />
                <AudioControls text={m.content} />
                <VisualExplain topic={turns[i - 1]?.role === "user" ? turns[i - 1].content : m.content.slice(0, 200)} context={m.content} />
                <p className="mt-1 text-[10px] uppercase tracking-wide text-slate/60">{t("practice.engine", { engine: m.engine === "gemini2" ? "Gemini 3.5 Flash-Lite" : "Gemini" })}</p>
              </>
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-slate">
            <Loader2 size={14} className="animate-spin" />
            {t("practice.thinking")}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 mt-4 bg-paper pb-2 pt-2">
      {image && (
        <div className="mb-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.dataUrl} alt="" className="h-16 rounded-card border border-mist object-contain" />
          <button type="button" onClick={() => setImage(null)} aria-label={captureText(lang, "removeImage")} className="rounded-full border border-mist p-1.5 text-slate hover:border-ink hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder={image ? captureText(lang, "askAboutImage") : t("practice.placeholder")}
          aria-label={t("practice.placeholder")}
          className={`${field} resize-none`}
        />
        <label aria-label={captureText(lang, "importImage")} title={captureText(lang, "importImage")} className="flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-card border border-mist px-3 text-slate hover:border-ink hover:text-ink">
          <Upload size={16} />
          <span className="hidden text-xs sm:inline">{captureText(lang, "import")}</span>
          <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="sr-only" onChange={(e) => void onPickImage(e.target.files?.[0])} />
        </label>
        <button type="button" onClick={() => setCameraOpen(true)} aria-label={captureText(lang, "camera")} title={captureText(lang, "camera")} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-card border border-mist px-3 text-slate hover:border-ink hover:text-ink">
          <Camera size={16} />
          <span className="hidden text-xs sm:inline">{captureText(lang, "camera")}</span>
        </button>
        {isVoiceInputSupported() && (
          <button
            type="button"
            onClick={toggleListening}
            aria-label={listening ? t("voice.stop") : t("voice.listen")}
            className={`flex h-10 shrink-0 items-center justify-center rounded-card px-3 ${
              listening ? "animate-pulse bg-clay text-paper" : "border border-mist text-slate hover:border-ink hover:text-ink"
            }`}
          >
            <Mic size={16} />
          </button>
        )}
        <button type="button" onClick={send} disabled={busy} aria-label={t("practice.send")} className="flex h-10 shrink-0 items-center gap-1.5 rounded-card bg-ink px-4 text-sm font-medium text-paper disabled:opacity-60">
          <Send size={15} />
          <span className="hidden sm:inline">{t("practice.send")}</span>
        </button>
        {turns.length > 0 && (
          <button type="button" onClick={() => { setTurns([]); setError(null); }} aria-label={t("practice.reset")} className="flex h-10 shrink-0 items-center rounded-card border border-mist px-3 text-slate hover:border-ink">
            <RotateCcw size={15} />
          </button>
        )}
        </div>
      </div>
      {cameraOpen && (
        <CameraCapture
          single
          onClose={() => setCameraOpen(false)}
          onDone={(pages) => {
            setCameraOpen(false);
            if (pages[0]) setImage(pages[0]);
          }}
        />
      )}
    </AppShell>
  );
}
