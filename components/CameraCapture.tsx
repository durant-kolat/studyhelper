"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { captureText } from "@/lib/capture-strings";
import { toJpeg } from "@/lib/capture";

export type CapturedPage = { blob: Blob; dataUrl: string; width: number; height: number };

/**
 * Caméra plein écran : l'utilisateur « filme » son cours page par page.
 * `single` = une seule photo (Pratique) ; sinon plusieurs pages (Mes cours).
 * Aucune image n'est envoyée ici : le parent reçoit les pages via onDone.
 */
export default function CameraCapture({
  single = false,
  onDone,
  onClose,
}: {
  single?: boolean;
  onDone: (pages: CapturedPage[]) => void;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(captureText(lang, "unsupported"));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
          setReady(true);
        }
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        setError(captureText(lang, name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported"));
      }
    }
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [lang, stop]);

  async function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")?.drawImage(v, 0, 0);
      const raw: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", 0.92));
      const page = await toJpeg(raw);
      if (single) {
        stop();
        onDone([page]);
        return;
      }
      setPages((p) => [...p, page]);
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    stop();
    onDone(pages);
  }

  function close() {
    stop();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={captureText(lang, "cameraTitle")}>
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-medium">{captureText(lang, "cameraTitle")}</p>
        <button type="button" onClick={close} aria-label={captureText(lang, "cancel")} className="rounded-full p-2 hover:bg-white/10">
          <X size={20} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {error ? (
          <p role="alert" className="max-w-sm px-6 text-center text-sm">{error}</p>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
            {!ready && <p className="absolute text-sm text-white/70">…</p>}
          </>
        )}
      </div>

      {!error && <p className="px-4 pb-2 pt-2 text-center text-xs text-white/70">{captureText(lang, "hint")}</p>}

      {!single && pages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2">
          {pages.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p.dataUrl} alt={`${i + 1}`} className="h-16 w-12 shrink-0 rounded border border-white/30 object-cover" />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-6 pb-6 pt-2">
        {!single ? (
          <button
            type="button"
            onClick={() => setPages((p) => p.slice(0, -1))}
            disabled={pages.length === 0}
            aria-label={captureText(lang, "retake")}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 disabled:opacity-30"
          >
            <Trash2 size={18} />
          </button>
        ) : (
          <span className="w-12" />
        )}

        <button
          type="button"
          onClick={() => void snap()}
          disabled={!ready || !!error || busy}
          aria-label={captureText(lang, "capture")}
          className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/20 disabled:opacity-40"
        >
          <Camera size={24} />
        </button>

        {!single ? (
          <button
            type="button"
            onClick={finish}
            disabled={pages.length === 0}
            className="flex h-12 items-center gap-1.5 rounded-full bg-gold px-4 text-sm font-medium text-ink disabled:opacity-30"
          >
            <Check size={16} />
            {captureText(lang, "finish")} · {captureText(lang, "pages", { n: pages.length })}
          </button>
        ) : (
          <span className="w-12" />
        )}
      </div>
    </div>
  );
}
