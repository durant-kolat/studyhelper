"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, GraduationCap, Languages, Loader2, Minus, Phone, Plus, RotateCcw, X } from "lucide-react";
import { tutorText } from "@/lib/i18n/tutor-strings";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateCourse } from "@/lib/api";
import AudioControls from "./AudioControls";

// Visionneuse PLEIN ÉCRAN de la bibliothèque.
//  - PDF   : rendu page par page (pdf.js), zoom, déplacement, page précédente / suivante, numéro de page ;
//            si pdf.js ne peut pas s'initialiser, repli sur le lecteur PDF natif du navigateur.
//  - Image : zoom (boutons, molette, double-clic) et déplacement (défilement tactile).
//  - Texte : texte original du document, zoom de la taille de police.
// Sur téléphone : toute la surface de l'écran (hauteur dynamique 100dvh), une seule barre minimale.

export type ViewerKind = "pdf" | "image" | "text";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const STEP = 0.25;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
};

function PdfPages({ url, zoom, onPageInfo, page, onError }: { url: string; zoom: number; page: number; onPageInfo: (total: number) => void; onError: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);

  // Chargement du document (une seule fois par URL).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/build/pdf");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
        const doc = (await pdfjs.getDocument({ url }).promise) as unknown as PdfDoc;
        if (cancelled) return;
        docRef.current = doc;
        onPageInfo(doc.numPages);
        setReady(true);
      } catch (err) {
        console.error("[viewer] pdf.js :", err instanceof Error ? err.message : err);
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Rendu de la page courante, ajustée à la largeur de l'écran × zoom.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!ready || !doc || !canvas) return;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let cancelled = false;
    setBusy(true);
    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        const available = (wrapRef.current?.clientWidth ?? window.innerWidth) - 16;
        const base = pdfPage.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = (available / base.width) * zoom;
        const viewport = pdfPage.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas indisponible");
        const current = pdfPage.render({ canvasContext: ctx, viewport });
        task = current;
        await current.promise;
        if (!cancelled) setBusy(false);
      } catch (err) {
        if (cancelled || (err as { name?: string })?.name === "RenderingCancelledException") return;
        console.error("[viewer] rendu page :", err instanceof Error ? err.message : err);
        onError();
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, page, zoom]);

  return (
    <div ref={wrapRef} className="relative min-h-full w-full">
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-white/70" size={28} />
        </div>
      )}
      <div className="mx-auto w-max min-w-full px-2 py-2">
        <canvas ref={canvasRef} className="mx-auto block max-w-none bg-white shadow-lg" />
      </div>
    </div>
  );
}

export default function FullscreenViewer({
  url,
  kind,
  title,
  text,
  courseId,
  onStudy,
  preparing = false,
  onClose,
}: {
  url: string | null;
  kind: ViewerKind;
  title: string;
  /** Texte original (documents texte / Word / PowerPoint dont le texte a été extrait, ou tout document déjà analysé). */
  text?: string | null;
  /** Id du cours : permet de proposer « Traduire dans ma langue » + « Écouter » (texte original ou PDF/image déjà analysés). */
  courseId?: string;
  /** Ouvre le professeur IA (live = appel en direct). Absent : aucun bouton (comportement d'origine). */
  onStudy?: (live: boolean) => void;
  /** Le texte du document est en cours de préparation (extraction) : « Écouter » et le professeur apparaissent ensuite. */
  preparing?: boolean;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [pdfFallback, setPdfFallback] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Traduction à la demande du texte original dans la langue de l'application (voir /api/translate-course) :
  // le document affiché/téléchargé reste l'original ; seul ce panneau texte change de langue.
  const [translated, setTranslated] = useState<string | null>(null);
  const [translatedLang, setTranslatedLang] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);

  async function handleTranslate() {
    if (!courseId || translating) return;
    setTranslateError(null);
    setTranslating(true);
    try {
      const res = await translateCourse(courseId);
      setTranslated(res.text);
      setTranslatedLang(res.lang);
      setShowTranslated(true);
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : t("library.translateError"));
    } finally {
      setTranslating(false);
    }
  }

  const activeText = showTranslated && translated && translatedLang === lang ? translated : text ?? null;

  const zoomIn = useCallback(() => setZoom((z) => clamp(z + STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clamp(z - STEP)), []);
  const prev = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const next = useCallback(() => setPage((p) => (pages ? Math.min(pages, p + 1) : p)), [pages]);

  // Plein écran réel quand le navigateur le permet (Android, ordinateur) ; sinon la couche couvre déjà tout l'écran.
  useEffect(() => {
    const el = rootRef.current;
    try {
      void el?.requestFullscreen?.().catch(() => undefined);
    } catch {
      /* iOS Safari : pas d'API, la couche fixe suffit */
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      try {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      } catch {
        /* ignoré */
      }
    };
  }, []);

  // Si l'utilisateur quitte le plein écran natif (geste du navigateur), on ferme proprement la visionneuse.
  useEffect(() => {
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) onClose();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-") zoomOut();
      else if (kind === "pdf" && !pdfFallback && e.key === "ArrowRight") next();
      else if (kind === "pdf" && !pdfFallback && e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, pdfFallback, next, prev, zoomIn, zoomOut, onClose]);

  const btn = "flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/15 disabled:opacity-40";
  const showZoom = (kind === "pdf" && !pdfFallback) || kind === "image" || kind === "text";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] flex flex-col bg-black text-white"
      style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Barre minimale */}
      <div className="flex shrink-0 items-center gap-1 bg-black/80 px-1">
        <button type="button" onClick={onClose} aria-label={t("common.back")} className={btn}>
          <X size={22} />
        </button>
        <p className="min-w-0 flex-1 truncate px-1 text-sm">{title}</p>
        {showZoom && (
          <>
            <button type="button" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label={t("library.zoomOut")} className={btn}>
              <Minus size={18} />
            </button>
            <button type="button" onClick={() => setZoom(1)} aria-label={t("library.resetZoom")} className={`${btn} hidden sm:flex`}>
              <RotateCcw size={16} />
            </button>
            <button type="button" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label={t("library.zoomIn")} className={btn}>
              <Plus size={18} />
            </button>
          </>
        )}
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("library.openExternal")} className={btn}>
            <ExternalLink size={18} />
          </a>
        )}
      </div>

      {/* Contenu : occupe tout le reste de l'écran ; défilement natif = déplacement tactile */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
        {kind === "pdf" && url && !pdfFallback && (
          <PdfPages url={url} zoom={zoom} page={page} onPageInfo={setPages} onError={() => setPdfFallback(true)} />
        )}
        {kind === "pdf" && url && pdfFallback && (
          <iframe src={url} title={title} className="h-full w-full border-0 bg-white" />
        )}

        {kind === "image" && url && !imgError && (
          <div className="flex min-h-full min-w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={title}
              draggable={false}
              onError={() => setImgError(true)}
              onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
              onWheel={(e) => {
                if (e.ctrlKey) setZoom((z) => clamp(z + (e.deltaY < 0 ? STEP : -STEP)));
              }}
              style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? "100%" : "none", maxHeight: zoom <= 1 ? "100%" : "none", objectFit: "contain" }}
              className="select-none"
            />
          </div>
        )}

        {kind === "text" && activeText && (
          <div className="mx-auto max-w-3xl whitespace-pre-wrap p-4 text-white/95" style={{ fontSize: `${Math.round(zoom * 16)}px`, lineHeight: 1.6 }}>
            {activeText}
          </div>
        )}

        {((kind !== "text" && !url) || imgError || (kind === "text" && !activeText)) && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-white/80">{t("library.loadError")}</p>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-card border border-white/30 px-4 py-2 text-sm hover:bg-white/10">
                {t("library.openExternal")}
              </a>
            )}
          </div>
        )}
      </div>

      {/* Navigation entre pages (PDF) */}
      {kind === "pdf" && !pdfFallback && pages > 0 && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-black/80 px-2 py-1">
          <button type="button" onClick={prev} disabled={page <= 1} aria-label={t("library.prev")} className={btn}>
            <ChevronLeft size={22} />
          </button>
          <span className="min-w-[7rem] text-center text-sm tabular-nums">
            {t("library.page")} {page} / {pages}
          </span>
          <button type="button" onClick={next} disabled={page >= pages} aria-label={t("library.next")} className={btn}>
            <ChevronRight size={22} />
          </button>
        </div>
      )}

      {/* Traduction + écoute du texte extrait du document, dans la langue choisie dans l'application —
          disponible pour tout document déjà analysé (texte, PDF ou image), sans jamais modifier l'original. */}
      {!text && courseId && preparing && (
        <div className="flex shrink-0 items-center gap-2 border-t border-white/15 bg-black/85 px-3 py-2 text-xs text-white/80">
          <Loader2 size={13} className="animate-spin" /> {tutorText(lang, "preparing")}
        </div>
      )}

      {text && courseId && (
        <div className="shrink-0 border-t border-white/15 bg-black/85 px-3 py-2 text-white">
          <div className="flex flex-wrap items-center gap-2">
            {translated && translatedLang === lang ? (
              <button
                type="button"
                onClick={() => setShowTranslated((v) => !v)}
                className="flex items-center gap-1 rounded-full border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10"
              >
                <Languages size={13} />
                {showTranslated ? t("library.original") : t("library.translate")}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTranslate}
                disabled={translating}
                className="flex items-center gap-1 rounded-full border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10 disabled:opacity-60"
              >
                {translating ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
                {translating ? t("library.translating") : t("library.translate")}
              </button>
            )}
          </div>
          {onStudy && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onStudy(false)}
                className="flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-300"
              >
                <GraduationCap size={13} /> {tutorText(lang, "cta")}
              </button>
              <button
                type="button"
                onClick={() => onStudy(true)}
                className="flex items-center gap-1.5 rounded-full border border-white/25 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                <Phone size={13} /> {tutorText(lang, "liveStart")}
              </button>
            </div>
          )}
          {translateError && (
            <p role="alert" className="mt-1 text-xs text-clay">
              {translateError}
            </p>
          )}
          {showTranslated && translated && translatedLang === lang && (
            <p className="mt-1 text-[11px] text-white/60">{t("library.translatedNotice")}</p>
          )}
          <div className="[&_button]:text-white/90 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            <AudioControls text={activeText ?? ""} />
          </div>
        </div>
      )}
    </div>
  );
}
