"use client";

import { cleanMath } from "@/lib/math-clean";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ExamTimer from "@/components/ExamTimer";
import { analyzeDocument, generateRealExam, submitExam, ExamQuestion, StudyLevel } from "@/lib/api";
import CameraCapture, { type CapturedPage } from "@/components/CameraCapture";
import ExamPartB, { type OpenDraft } from "@/components/ExamPartB";
import QuestionNavigator from "@/components/QuestionNavigator";
import { supabase } from "@/lib/supabase";
import { ANSWER_PHOTO_FOLDER, MAX_OPEN_IMAGES, type OpenAnswerInput, type OpenQuestionClient } from "@/lib/exam-open";
import {
  COURSE_FILE_ACCEPT,
  MAX_COURSE_FILE_BYTES,
  createCourseFromBlob,
  createCourseFromCamera,
  listLibraryCourses,
  type LibraryCourse,
} from "@/lib/course-import";
import { DIFFICULTIES, DIFFICULTY_LABELS, Difficulty } from "@/lib/adaptive";
import { BookOpen, Camera, Library, Loader2, Upload } from "lucide-react";

const subjects = ["Mathématiques", "Physique", "Informatique", "Anglais"];
const OTHER_SUBJECT = "__autre";

const LEVELS: { value: StudyLevel; label: string }[] = [
  { value: "primaire", label: "Primaire" },
  { value: "college", label: "Collège" },
  { value: "lycee", label: "Lycée" },
  { value: "universite", label: "Université" },
  { value: "formation_pro", label: "Formation professionnelle" },
];
type Source = "subject" | "import" | "camera" | "library";
const SOURCES: { value: Source; label: string; Icon: typeof Upload }[] = [
  { value: "subject", label: "Matière", Icon: BookOpen },
  { value: "import", label: "Importer un cours", Icon: Upload },
  { value: "camera", label: "Caméra", Icon: Camera },
  { value: "library", label: "Ma bibliothèque", Icon: Library },
];
const QUESTION_COUNTS = [5, 8, 10, 15, 20, 30, 40, 50];
const DURATIONS = [15, 30, 45, 60, 90, 120];

export default function ExamsPage() {
  const router = useRouter();
  const [subject, setSubject] = useState(subjects[0]);
  const [customSubject, setCustomSubject] = useState("");
  const [chapter, setChapter] = useState("");
  const [level, setLevel] = useState<StudyLevel | "">("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [questionCount, setQuestionCount] = useState(8);
  const [duration, setDuration] = useState(30);
  const [examSubject, setExamSubject] = useState(subjects[0]);
  const [examId, setExamId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Partie B (questions rédigées / à schéma)
  const [openCount, setOpenCount] = useState(2);
  const [openQuestions, setOpenQuestions] = useState<OpenQuestionClient[]>([]);
  const [drafts, setDrafts] = useState<OpenDraft[]>([]);
  const [part, setPart] = useState<"A" | "B">("A");
  const [cameraFor, setCameraFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("subject");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [libCourses, setLibCourses] = useState<LibraryCourse[] | null>(null);
  const [libId, setLibId] = useState<string>("");
  const [progress, setProgress] = useState<string | null>(null);

  // La bibliothèque n'est chargée que si l'élève ouvre cet onglet.
  useEffect(() => {
    if (source !== "library" || libCourses) return;
    listLibraryCourses().then(setLibCourses).catch(() => setLibCourses([]));
  }, [source, libCourses]);

  async function handleStart() {
    const chosenSubject = subject === OTHER_SUBJECT ? customSubject.trim() : subject;
    if (source !== "library" && !chosenSubject) {
      setError("Indique la matière de l'examen.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      let courseId: string | undefined;
      let examSubj = chosenSubject;

      // L'IA lit d'abord le cours (texte du PDF/Word/PowerPoint ou OCR de l'image), puis génère les questions À PARTIR de ce texte.
      const readCourse = async (id: string) => {
        setProgress("Lecture du cours par l'IA…");
        await analyzeDocument(id);
      };

      if (source === "import") {
        if (!file) throw new Error("Choisis un fichier de cours à importer.");
        if (file.size > MAX_COURSE_FILE_BYTES) throw new Error("Fichier trop volumineux (15 Mo maximum).");
        setProgress("Envoi du cours…");
        courseId = await createCourseFromBlob(file, file.name, chosenSubject, null);
        await readCourse(courseId);
      } else if (source === "camera") {
        courseId = await createCourseFromCamera(pages, chosenSubject, setProgress);
        await readCourse(courseId);
      } else if (source === "library") {
        const course = libCourses?.find((c) => c.id === libId);
        if (!course) throw new Error("Choisis un cours dans ta bibliothèque.");
        courseId = course.id;
        examSubj = course.subject;
        if (course.status !== "done") await readCourse(course.id);
      }

      setProgress("Génération de l'examen…");
      // Le serveur garde les bonnes réponses — on ne reçoit ici que les
      // questions et les options, jamais correctIndex/method.
      const {
        examId: id,
        questions: qs,
        durationMinutes,
        openQuestions: oq,
      } = await generateRealExam(examSubj, {
        chapter,
        level: level || undefined,
        difficulty: difficulty || undefined,
        questionCount,
        durationMinutes: duration,
        courseId,
        openCount,
      });
      setExamSubject(examSubj);
      setDuration(durationMinutes);
      setExamId(id);
      setQuestions(qs);
      setOpenQuestions(oq ?? []);
      setDrafts((oq ?? []).map(() => ({ text: "", photos: [] })));
      setPart("A");
      setAnswers(new Array(qs.length).fill(-1));
      setCurrent(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }

  function selectAnswer(index: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = index;
      return next;
    });
  }

  async function handleFinish() {
    if (!questions || !examId || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      // Partie B : les photos partent dans le bucket PRIVÉ de l'élève (dossier à son id) ; le serveur revalide chaque chemin.
      const openAnswers: OpenAnswerInput[] = [];
      if (openQuestions.length > 0) {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        for (let i = 0; i < openQuestions.length; i++) {
          const d = drafts[i] ?? { text: "", photos: [] };
          const imagePaths: string[] = [];
          if (uid && d.photos.length > 0) setProgress("Envoi de tes photos…");
          for (let n = 0; uid && n < Math.min(d.photos.length, MAX_OPEN_IMAGES); n++) {
            const path = `${uid}/${ANSWER_PHOTO_FOLDER}/${examId}/${i}-${n}-${Date.now()}.jpg`;
            let upload = await supabase.storage.from("documents").upload(path, d.photos[n].blob, { contentType: "image/jpeg" });
            if (upload.error) upload = await supabase.storage.from("documents").upload(path, d.photos[n].blob, { contentType: "image/jpeg", upsert: true });
            if (!upload.error) imagePaths.push(path);
          }
          openAnswers.push({ index: i, text: d.text.trim() || undefined, imagePaths });
        }
      }
      setProgress("Correction du QCM…");
      // Le score QCM est calculé côté serveur, à partir des bonnes réponses
      // qu'il a gardées pour lui — impossible à falsifier depuis ici.
      const { resultId } = await submitExam(examId, answers, openAnswers);
      router.push(`/results?id=${resultId}`);
    } catch (err) {
      setFinishing(false);
      setProgress(null);
      setError(err instanceof Error ? err.message : "Échec de la correction.");
    }
  }

  // Étape 1 — choisir la matière et générer l'examen
  if (!questions) {
    return (
      <AppShell active="exams" title="Examen">
        <div className="max-w-lg rounded-card border border-mist bg-white p-6">
          <p className="mb-1 font-display text-lg text-ink">Prépare ton examen</p>
          <p className="mb-4 text-sm text-slate">
            Chronométré, corrigé à la fin, résultat enregistré. Choisis d&apos;où viennent les questions :
            une matière, un cours que tu importes, des pages que tu filmes, ou un cours de ta bibliothèque.
          </p>

          <div role="tablist" aria-label="Source des questions" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SOURCES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={source === value}
                onClick={() => {
                  setSource(value);
                  setError(null);
                }}
                className={`flex flex-col items-center gap-1 rounded-card border px-2 py-2.5 text-center text-xs ${
                  source === value ? "border-ink bg-ink text-paper" : "border-mist text-ink hover:bg-mist2"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          {source === "import" && (
            <div className="mb-4 rounded-card border border-dashed border-mist p-3">
              <input
                ref={fileInput}
                type="file"
                accept={COURSE_FILE_ACCEPT}
                aria-label="Fichier de cours"
                className="block w-full text-sm text-slate file:mr-3 file:rounded-card file:border-0 file:bg-mist2 file:px-3 file:py-2 file:text-sm file:text-ink"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="mt-2 text-xs text-slate">PDF, Word, PowerPoint, texte ou photo — 15 Mo maximum. Le cours est aussi ajouté à « Mes cours ».</p>
            </div>
          )}

          {source === "camera" && (
            <div className="mb-4 rounded-card border border-dashed border-mist p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setCameraOpen(true)} className="flex items-center gap-2 rounded-card bg-mist2 px-3 py-2 text-sm text-ink">
                  <Camera size={15} /> {pages.length === 0 ? "Filmer mon cours" : "Ajouter des pages"}
                </button>
                {pages.length > 0 && (
                  <>
                    <span className="text-sm text-slate">{pages.length} page{pages.length > 1 ? "s" : ""} prête{pages.length > 1 ? "s" : ""}</span>
                    <button type="button" onClick={() => setPages([])} className="text-xs text-slate underline">Effacer</button>
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-slate">Cadre bien le texte, bien éclairé. Le cours est aussi ajouté à « Mes cours ».</p>
            </div>
          )}

          {source === "library" && (
            <div className="mb-4">
              <p className="mb-1 text-xs font-medium text-slate">Choisis un cours</p>
              {libCourses === null && <p className="text-sm text-slate">Chargement…</p>}
              {libCourses?.length === 0 && <p className="text-sm text-slate">Ta bibliothèque est vide : importe d&apos;abord un cours (onglet « Importer un cours » ou « Caméra »).</p>}
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {libCourses?.map((c) => (
                  <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm ${libId === c.id ? "border-ink bg-mist2" : "border-mist"}`}>
                    <input type="radio" name="lib-course" checked={libId === c.id} onChange={() => setLibId(c.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{c.title}</span>
                      <span className="block text-xs text-slate">{c.subject}{c.status !== "done" ? " · pas encore lu par l'IA" : ""}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {source !== "library" && (
          <>
          <label htmlFor="exam-subject" className="mb-1 block text-xs font-medium text-slate">
            {source === "subject" ? "Matière" : "Matière du cours"}
          </label>
          <select
            id="exam-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mb-3 w-full rounded-card border border-mist px-3 py-2 text-sm"
          >
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={OTHER_SUBJECT}>Autre matière…</option>
          </select>
          {subject === OTHER_SUBJECT && (
            <input
              value={customSubject}
              onChange={(e) => setCustomSubject(e.target.value)}
              maxLength={100}
              aria-label="Nom de la matière"
              placeholder="Ex. Chimie, Économie, Histoire…"
              className="mb-3 w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
            />
          )}
          </>
          )}

          <label htmlFor="exam-chapter" className="mb-1 block text-xs font-medium text-slate">
            {source === "subject" ? "Chapitre ou thème (facultatif)" : "Partie du cours à privilégier (facultatif)"}
          </label>
          <input
            id="exam-chapter"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            maxLength={120}
            placeholder="Ex. Dérivées"
            className="mb-3 w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="exam-level" className="mb-1 block text-xs font-medium text-slate">
                Niveau d'études
              </label>
              <select
                id="exam-level"
                value={level}
                onChange={(e) => setLevel(e.target.value as StudyLevel | "")}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              >
                <option value="">Non précisé</option>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exam-difficulty" className="mb-1 block text-xs font-medium text-slate">
                Difficulté
              </label>
              <select
                id="exam-difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              >
                <option value="">Progressive (recommandé)</option>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exam-count" className="mb-1 block text-xs font-medium text-slate">
                Nombre de questions
              </label>
              <select
                id="exam-count"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              >
                {QUESTION_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exam-duration" className="mb-1 block text-xs font-medium text-slate">
                Durée
              </label>
              <select
                id="exam-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full rounded-card border border-mist px-3 py-2 text-sm"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} minutes
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="exam-open" className="mb-1 block text-xs font-medium text-slate">
              Partie B : questions rédigées (réponse écrite ou photo de ta solution)
            </label>
            <select
              id="exam-open"
              value={openCount}
              onChange={(e) => setOpenCount(Number(e.target.value))}
              className="w-full rounded-card border border-mist px-3 py-2 text-sm"
            >
              <option value={0}>Aucune (QCM seulement)</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} question{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="mt-4 text-sm text-clay">{error}</p>}
          <button
            onClick={handleStart}
            disabled={generating}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-card bg-clay py-2.5 text-sm font-medium text-paper hover:bg-clay/90 disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 size={15} className="animate-spin" /> {progress ?? "Génération de l'examen…"}
              </>
            ) : (
              source === "subject" ? "Démarrer l'examen" : "Lire le cours et démarrer l'examen"
            )}
          </button>
        </div>
        {cameraOpen && (
          <CameraCapture
            onDone={(p) => {
              setPages((prev) => [...prev, ...p]);
              setCameraOpen(false);
            }}
            onClose={() => setCameraOpen(false)}
          />
        )}
      </AppShell>
    );
  }

  // Étape 2 — passer l'examen
  const q = questions[current];
  const isLast = current === questions.length - 1;

  return (
    <AppShell active="exams" title={`Examen — ${examSubject}`}>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm text-slate">
          {part === "B" ? `Partie B — ${openQuestions.length} question${openQuestions.length > 1 ? "s" : ""} rédigée${openQuestions.length > 1 ? "s" : ""}` : `Partie A — Question ${current + 1} sur ${questions.length}`}
        </p>
        <ExamTimer minutes={duration} onExpire={handleFinish} />
      </div>
      <p className="mb-5 text-right text-xs text-slate/60">
        L'examen se soumet automatiquement à 00:00.
      </p>
      {error && <p className="mb-4 text-sm text-clay">{error}</p>}

      {part === "B" ? (
        <ExamPartB
          questions={openQuestions}
          drafts={drafts}
          onChange={(i, d) => setDrafts((prev) => prev.map((x, k) => (k === i ? d : x)))}
          onOpenCamera={(i) => setCameraFor(i)}
          onBack={() => setPart("A")}
          onFinish={handleFinish}
          finishing={finishing}
          progress={progress}
        />
      ) : (
      <>
      <QuestionNavigator total={questions.length} current={current} answers={answers} onJump={setCurrent} />
      <div className="rounded-card border border-mist bg-white p-6">
        <p className="font-display text-lg text-ink">{cleanMath(q.question)}</p>
        <div className="mt-5 space-y-3">
          {q.options.map((opt, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-center gap-3 rounded-card border border-mist px-4 py-3 text-sm text-ink hover:border-ink has-[:checked]:border-clay has-[:checked]:bg-clay/5"
            >
              <input
                type="radio"
                name={`q${current}`}
                checked={answers[current] === i}
                onChange={() => selectAnswer(i)}
                className="accent-clay"
              />
              {cleanMath(opt)}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
          className="rounded-card border border-mist px-5 py-2.5 text-sm text-ink hover:border-ink disabled:opacity-40"
        >
          Précédente
        </button>
        {isLast && openQuestions.length > 0 ? (
          <button
            onClick={() => setPart("B")}
            className="rounded-card bg-ink px-5 py-2.5 text-sm text-paper hover:bg-ink/90"
          >
            Passer à la Partie B
          </button>
        ) : isLast ? (
          <button
            onClick={handleFinish}
            disabled={finishing}
            className="rounded-card bg-clay px-5 py-2.5 text-sm text-paper hover:bg-clay/90 disabled:opacity-60"
          >
            {finishing ? "Correction…" : "Terminer l'examen"}
          </button>
        ) : (
          <button
            onClick={() => setCurrent((c) => c + 1)}
            className="rounded-card bg-ink px-5 py-2.5 text-sm text-paper hover:bg-ink/90"
          >
            Question suivante
          </button>
        )}
      </div>
      </>
      )}
      {cameraFor !== null && (
        <CameraCapture
          onDone={(p) => {
            const i = cameraFor;
            setDrafts((prev) => prev.map((d, k) => (k === i ? { ...d, photos: [...d.photos, ...p.map((x) => ({ blob: x.blob, dataUrl: x.dataUrl }))].slice(0, MAX_OPEN_IMAGES) } : d)));
            setCameraFor(null);
          }}
          onClose={() => setCameraFor(null)}
        />
      )}
    </AppShell>
  );
}
