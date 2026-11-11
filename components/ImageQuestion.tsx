"use client";

import { getStoredLanguage, languageHeader } from "@/lib/i18n/client";
import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n/I18nProvider";
import MessageContent from "./MessageContent";
import AudioControls from "./AudioControls";

const MAX_SIDE = 1600;

/** Réduit l'image (côté max 1600 px, JPEG) avant l'envoi : plus rapide, et sous la limite de taille du serveur. */
async function toJpegBase64(file: File): Promise<{ data: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1] ?? "", preview: url };
}

/** Pose une question sur une image (exercice photographié, schéma, graphique). Analyse faite côté serveur (/api/vision). */
export default function ImageQuestion() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<{ data: string; preview: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReply(null);
    try {
      setImage(await toJpegBase64(file));
    } catch {
      setError(t("error.file"));
    }
  }

  async function send() {
    if (!image || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...languageHeader(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ question, mimeType: "image/jpeg", data: image.data, language: getStoredLanguage() ?? undefined }),
      });
      const json = (await res.json().catch(() => null)) as { reply?: string; error?: string } | null;
      if (!res.ok || !json?.reply) setError(json?.error ?? t("error.ai"));
      else setReply(json.reply);
    } catch {
      setError(t("error.network"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mx-3 mb-2 flex items-center gap-1.5 self-start rounded-full border border-mist px-3 py-1.5 text-xs text-slate hover:border-ink hover:text-ink sm:mx-4">
        <Camera size={14} />
        Image
      </button>
    );
  }

  return (
    <div className="mx-3 mb-2 rounded-card border border-mist bg-white p-3 text-sm sm:mx-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-ink">Image</p>
        <button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)} className="rounded-full p-1 text-slate hover:bg-mist2">
          <X size={16} />
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => onPick(e.target.files?.[0])} />
      {!image ? (
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-mist py-4 text-slate hover:border-ink">
          <Camera size={16} /> JPEG · PNG · WebP
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.preview} alt="" className="max-h-40 rounded-card border border-mist object-contain" />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={1000}
            className="w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <div className="flex gap-2">
            <button type="button" onClick={send} disabled={busy} className="flex items-center gap-2 rounded-card bg-ink px-3 py-2 text-xs font-medium text-paper disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />}
              OK
            </button>
            <button type="button" onClick={() => { setImage(null); setReply(null); }} className="rounded-card border border-mist px-3 py-2 text-xs text-slate">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-clay">{error}</p>}
      {reply && (
        <div className="mt-3 rounded-card bg-mist2 p-3 text-ink">
          <MessageContent text={reply} />
          <AudioControls text={reply} />
        </div>
      )}
    </div>
  );
}
