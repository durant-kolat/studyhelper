"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { analyzeDocument } from "@/lib/api";
import { relativeDate } from "@/lib/utils";
import { Upload, Loader2, FileText, ChevronDown, ChevronUp, Sparkles, Camera } from "lucide-react";
import AdSlot from "@/components/ads/AdSlot";
import CameraCapture, { type CapturedPage } from "@/components/CameraCapture";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { captureText } from "@/lib/capture-strings";
import { imagesToPdf, ocrImages } from "@/lib/capture";

type CourseRow = {
  id: string;
  title: string;
  subject: string;
  created_at: string;
  summary: string | null;
  key_notions: string[] | null;
  questions: { question: string; answer: string }[] | null;
};

const subjects = ["Mathématiques", "Physique", "Informatique", "Anglais", "Autre"];

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [subject, setSubject] = useState(subjects[0]);
  const [error, setError] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { lang } = useI18n();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  async function loadCourses() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data, error: fetchError } = await supabase
      .from("courses")
      .select("id, title, subject, created_at, summary, key_notions, questions")
      .eq("owner_id", userData.user.id)
      .order("created_at", { ascending: false });

    if (fetchError) setError(fetchError.message);
    setCourses(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadCourses();
  }, []);

  /** Envoie un fichier dans le bucket privé, crée le cours, puis lance l'analyse (commun à « Importer » et « Caméra »). */
  async function saveCourse(file: Blob, fileName: string, contentText: string | null) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setUploading(false);
      return;
    }
    const userId = userData.user.id;
    const path = `${userId}/${Date.now()}-${fileName}`;

    const { error: uploadError } = await supabase.storage.from("documents").upload(path, file);

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    // Bucket privé : on stocke le chemin, jamais une URL publique (le
    // fichier reste inaccessible sans passer par une URL signée générée
    // à la demande, ou par le serveur avec la clé service_role).
    const baseRow = {
      owner_id: userId,
      title: fileName.replace(/\.[^.]+$/, ""),
      subject,
      file_path: path,
      // key_notions / questions sont NOT NULL en base : valeurs vides
      // tant que l'analyse n'a pas encore eu lieu.
      key_notions: [],
      questions: [],
      status: "pending",
    };
    // Texte déjà lu sur les photos de la caméra : enregistré tout de suite (colonne content_text de la migration v1.7).
    let res = await supabase
      .from("courses")
      .insert((contentText ? { ...baseRow, content_text: contentText } : baseRow) as never)
      .select("id")
      .single();
    if (res.error && contentText) {
      res = await supabase.from("courses").insert(baseRow).select("id").single();
    }

    setUploading(false);
    setProgressMsg(null);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    if (fileInput.current) fileInput.current.value = "";
    await loadCourses();

    if (res.data) handleAnalyze(res.data.id);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const MAX_SIZE = 15 * 1024 * 1024; // 15 Mo — doit rester cohérent avec le bucket Supabase
    if (file.size > MAX_SIZE) {
      setError("Fichier trop volumineux (15 Mo maximum).");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setUploading(true);
    await saveCourse(file, file.name, null);
  }

  /** Pages filmées → lecture du texte (OCR) → un seul document (PDF, ou JPEG s'il n'y a qu'une page) → même chemin que « Importer ». */
  async function handleCameraDone(pages: CapturedPage[]) {
    setCameraOpen(false);
    if (pages.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      setProgressMsg(captureText(lang, "ocrRunning"));
      const text = await ocrImages(pages.map((p) => p.blob));
      setProgressMsg(captureText(lang, "building"));
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
      const name = `Cours caméra ${stamp}`;
      const MAX_SIZE = 15 * 1024 * 1024;
      if (pages.length === 1) {
        await saveCourse(pages[0].blob, `${name}.jpg`, text.trim().length >= 20 ? text : null);
      } else {
        const pdf = await imagesToPdf(pages);
        if (pdf.size > MAX_SIZE) {
          setError("Document trop volumineux (15 Mo maximum) : filme moins de pages à la fois.");
          setUploading(false);
          setProgressMsg(null);
          return;
        }
        await saveCourse(pdf, `${name}.pdf`, text.trim().length >= 20 ? text : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import impossible.");
      setUploading(false);
      setProgressMsg(null);
    }
  }

  async function handleAnalyze(courseId: string) {
    setError(null);
    setAnalyzingId(courseId);
    try {
      await analyzeDocument(courseId);
      await loadCourses();
      setExpandedId(courseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'analyse a échoué.");
    } finally {
      setAnalyzingId(null);
    }
  }

  return (
    <AppShell active="courses" title="Mes cours">
      <div className="mb-6 rounded-card border-2 border-dashed border-mist bg-white px-6 py-8 text-center">
        <Upload className="mx-auto text-clay" size={22} />
        <p className="mt-2 text-sm text-ink">
          Importe un PDF, une présentation ou une photo de tes notes — ou filme-les avec la caméra
        </p>
        <p className="text-xs text-slate">
          Study Helper l'analysera et en tirera un résumé et des questions
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-card border border-mist px-3 py-2 text-sm"
          >
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className={`flex cursor-pointer items-center gap-2 rounded-card bg-ink px-4 py-2 text-sm text-paper hover:bg-ink/90 ${uploading ? "pointer-events-none opacity-70" : ""}`}>
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {captureText(lang, "import")}
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.txt,.pptx,.docx,image/*"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={uploading}
            className="flex items-center gap-2 rounded-card border border-ink px-4 py-2 text-sm text-ink hover:bg-mist2 disabled:opacity-60"
          >
            <Camera size={15} />
            {captureText(lang, "camera")}
          </button>
        </div>
        {progressMsg && <p className="mt-3 text-xs text-slate">{progressMsg}</p>}
        {error && <p className="mt-3 text-sm text-clay">{error}</p>}
      </div>
      {cameraOpen && <CameraCapture onDone={(p) => void handleCameraDone(p)} onClose={() => setCameraOpen(false)} />}

      {loading ? (
        <p className="text-sm text-slate">Chargement de tes cours…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-slate">
          Aucun document pour l'instant — importe ton premier cours ci-dessus.
        </p>
      ) : (
        <div className="space-y-4">
          {courses.map((c, ci) => {
            const analyzed = !!c.summary;
            const expanded = expandedId === c.id;
            return (
              <Fragment key={c.id}>
              {/* Publicité entre deux documents (après le 2e) : jamais dans un document, jamais pendant une action. */}
              {ci === 2 && <AdSlot slot="courses_between" />}
              <div
                className="rounded-card border border-mist bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-card bg-gold/15 p-2 text-clay">
                    <FileText size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{c.title}</p>
                    <p className="text-xs text-slate">
                      {c.subject} · importé {relativeDate(c.created_at)}
                    </p>
                  </div>
                  {analyzingId === c.id ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-slate">
                      <Loader2 size={14} className="animate-spin" /> Analyse…
                    </span>
                  ) : analyzed ? (
                    <button
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      className="flex shrink-0 items-center gap-1 text-xs text-clay"
                    >
                      {expanded ? "Réduire" : "Voir l'analyse"}
                      {expanded ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAnalyze(c.id)}
                      className="flex shrink-0 items-center gap-1 rounded-card border border-mist px-3 py-1.5 text-xs text-ink hover:border-ink"
                    >
                      <Sparkles size={13} /> Analyser
                    </button>
                  )}
                </div>

                {expanded && analyzed && (
                  <div className="mt-4 space-y-4 border-t border-mist pt-4">
                    <div>
                      <p className="mb-1 text-xs font-medium text-slate">
                        Résumé
                      </p>
                      <p className="text-sm text-ink">{c.summary}</p>
                    </div>
                    {c.key_notions && c.key_notions.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-slate">
                          Notions clés
                        </p>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
                          {c.key_notions.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {c.questions && c.questions.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-slate">
                          Questions de vérification
                        </p>
                        <ul className="space-y-2 text-sm">
                          {c.questions.map((q, i) => (
                            <li
                              key={i}
                              className="rounded-card bg-mist2 px-3 py-2"
                            >
                              <p className="text-ink">{q.question}</p>
                              <p className="mt-1 text-xs text-slate">
                                {q.answer}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
