"use client";

import { Fragment, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { relativeDate } from "@/lib/utils";
import AdSlot from "@/components/ads/AdSlot";
import { FileText, Maximize2, Loader2, GraduationCap, Phone, Volume2 } from "lucide-react";
import AudioControls from "@/components/AudioControls";
import TutorSession from "@/components/TutorSession";
import { tutorText } from "@/lib/i18n/tutor-strings";
import { courseTextApi } from "@/lib/tutor-client";
import FullscreenViewer, { type ViewerKind } from "@/components/FullscreenViewer";
import { useI18n } from "@/lib/i18n/I18nProvider";

// La bibliothèque montre le document ORIGINAL tel qu'il a été importé
// (PDF, image, texte, Word, PowerPoint) — jamais une explication ou un
// résumé généré par l'IA. Les explications se trouvent dans l'assistant.

type CourseRow = {
  id: string;
  title: string;
  subject: string;
  created_at: string;
  file_path: string | null;
  content_text: string | null;
};

type FileKind = "pdf" | "image" | "text" | "office" | "other";

function kindOf(path: string | null): FileKind {
  const p = (path ?? "").toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(p)) return "image";
  if (p.endsWith(".txt")) return "text";
  if (/\.(docx?|pptx?)$/.test(p)) return "office";
  return "other";
}

export default function LibraryPage() {
  const [documents, setDocuments] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, lang } = useI18n();
  const [tutorDoc, setTutorDoc] = useState<CourseRow | null>(null);
  const [tutorLive, setTutorLive] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ doc: CourseRow; kind: ViewerKind; url: string | null } | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      // Chaque utilisateur ne voit que ses propres cours (owner_id) —
      // la bibliothèque est personnelle, pas partagée.
      let { data, error } = await supabase
        .from("courses")
        .select("id, title, subject, created_at, file_path, content_text")
        .eq("owner_id", userData.user.id)
        .order("created_at", { ascending: false });

      // content_text vient de la migration v1.7 : sans elle, on relit sans.
      if (error) {
        const retry = await supabase
          .from("courses")
          .select("id, title, subject, created_at, file_path")
          .eq("owner_id", userData.user.id)
          .order("created_at", { ascending: false });
        data = (retry.data ?? []).map((c) => ({ ...c, content_text: null })) as typeof data;
      }

      setDocuments((data as CourseRow[] | null) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  // Le bucket est privé : URL signée temporaire générée à l'ouverture, puis visionneuse PLEIN ÉCRAN.
  /**
   * Garantit que le texte du document est disponible (extraction locale côté serveur, sans Gemini ni quota d'analyse).
   * « Écouter », le professeur IA et l'appel en direct en ont besoin ; un document jamais analysé n'en avait pas.
   */
  async function ensureText(d: CourseRow): Promise<CourseRow | null> {
    if (d.content_text && d.content_text.trim().length >= 20) return d;
    if (preparing) return null;
    setPreparing(d.id);
    setUrlError(null);
    const r = await courseTextApi.ensure(d.id);
    setPreparing(null);
    if (!r.ok) {
      setUrlError(tutorText(lang, r.code === "no_text" ? "errExtract" : "errGeneric"));
      return null;
    }
    const updated = { ...d, content_text: r.data.text };
    setDocuments((docs) => docs.map((x) => (x.id === d.id ? updated : x)));
    setViewer((v) => (v && v.doc.id === d.id ? { ...v, doc: updated } : v));
    return updated;
  }

  async function startStudy(d: CourseRow, live: boolean) {
    const ready = await ensureText(d);
    if (!ready) return;
    setViewer(null); // le professeur prend l'écran
    setTutorLive(live);
    setTutorDoc(ready);
  }

  async function openDocument(d: CourseRow) {
    setUrlError(null);
    const kind = kindOf(d.file_path);
    // Texte / Word / PowerPoint : le texte original s'affiche en plein écran ; sinon on ouvre le fichier.
    const viewerKind: ViewerKind = kind === "pdf" ? "pdf" : kind === "image" ? "image" : "text";
    if (!d.file_path) {
      setViewer({ doc: d, kind: viewerKind, url: null });
      return;
    }
    setOpening(d.id);
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(d.file_path, 3600);
    setOpening(null);
    if (error || !data?.signedUrl) {
      if (viewerKind === "text" && d.content_text) {
        setViewer({ doc: d, kind: "text", url: null }); // le texte original reste lisible sans le fichier
        return;
      }
      setUrlError(t("error.file"));
      return;
    }
    setViewer({ doc: d, kind: viewerKind, url: data.signedUrl });
    // Pas encore de texte (document jamais analysé) : on le prépare en arrière-plan pour proposer
    // « Écouter », le professeur IA et l'appel en direct dans le lecteur.
    if (!d.content_text || d.content_text.trim().length < 20) void ensureText(d);
  }

  return (
    <AppShell active="library" title={t("library.title")}>
      <p className="mb-4 text-sm text-slate">
        Tes documents tels que tu les as importés, dans leur format d'origine. Touche un document pour l'ouvrir en plein écran.
      </p>
      {urlError && (
        <p role="alert" className="mb-3 rounded-card bg-clay/10 px-3 py-2 text-sm text-clay">
          {urlError}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-slate">{t("common.loading")}</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-slate">
          Rien ici pour l'instant — importe un document depuis "Mes cours".
        </p>
      ) : (
        <div className="space-y-3">
          {documents.map((d, di) => (
            <Fragment key={d.id}>
            {/* Publicité entre deux documents (après le 3e). Aucune publicité pendant la lecture d'un document ni une séance
                avec le professeur IA : l'emplacement n'est même pas monté (blocked). */}
            {di === 3 && <AdSlot slot="library_between" blocked={!!tutorDoc || !!viewer} />}
            <div className="rounded-card border border-mist bg-white hover:border-ink">
              {/* 1) Lire le document : lecteur existant, inchangé. */}
              <button
                type="button"
                onClick={() => openDocument(d)}
                disabled={opening === d.id}
                aria-label={`${tutorText(lang, "read")} — ${d.title}`}
                className="flex w-full items-start gap-3 p-4 text-left disabled:opacity-70"
              >
                <div className="rounded-card bg-gold/15 p-2 text-clay">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{d.title}</p>
                  <p className="text-xs text-slate">{d.subject}</p>
                  <p className="mt-2 text-xs text-slate/70">importé {relativeDate(d.created_at)}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 self-center text-xs text-clay">
                  {opening === d.id ? <Loader2 size={14} className="animate-spin" /> : <Maximize2 size={14} />}
                  {t("library.open")}
                </span>
              </button>
              {/* 2) Écouter le document · 3) Étudier avec mon professeur IA · 4) Appel en direct.
                  Disponibles pour tout document ; le texte est préparé à la demande s'il n'existe pas encore. */}
              {(d.file_path || d.content_text) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-mist px-4 pb-3 pt-1">
                  {d.content_text && d.content_text.trim().length >= 20 ? (
                    <AudioControls text={d.content_text} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void ensureText(d)}
                      disabled={preparing === d.id}
                      className="mt-1.5 flex items-center gap-1.5 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink disabled:opacity-60"
                    >
                      {preparing === d.id ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                      {preparing === d.id ? tutorText(lang, "preparing") : tutorText(lang, "listen")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void startStudy(d, false)}
                    disabled={preparing === d.id}
                    className="mt-1.5 flex items-center gap-1.5 rounded-card bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold/90 disabled:opacity-60"
                  >
                    <GraduationCap size={14} /> {tutorText(lang, "cta")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startStudy(d, true)}
                    disabled={preparing === d.id}
                    className="mt-1.5 flex items-center gap-1.5 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink disabled:opacity-60"
                  >
                    <Phone size={14} /> {tutorText(lang, "liveStart")}
                  </button>
                </div>
              )}
            </div>
            </Fragment>
          ))}
        </div>
      )}

      {tutorDoc && <TutorSession courseId={tutorDoc.id} title={tutorDoc.title} live={tutorLive} onClose={() => setTutorDoc(null)} />}

      {viewer && (
        <FullscreenViewer
          url={viewer.url}
          kind={viewer.kind}
          title={viewer.doc.title}
          text={viewer.doc.content_text}
          courseId={viewer.doc.id}
          onStudy={(live) => void startStudy(viewer.doc, live)}
          preparing={preparing === viewer.doc.id}
          onClose={() => setViewer(null)}
        />
      )}
    </AppShell>
  );
}
