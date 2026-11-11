"use client";

import { useRef } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { cleanMath } from "@/lib/math-clean";
import { toJpeg } from "@/lib/capture";
import { MAX_OPEN_IMAGES, MAX_OPEN_TEXT, type OpenQuestionClient } from "@/lib/exam-open";

export type OpenDraft = { text: string; photos: { blob: Blob; dataUrl: string }[] };

/**
 * Partie B de l'examen : questions rédigées. « text » → zone de texte ; « diagram » → l'élève fait son schéma / sa résolution
 * sur papier et en envoie une photo (caméra ou galerie). Les photos ne quittent l'appareil qu'à la soumission.
 */
export default function ExamPartB({
  questions,
  drafts,
  onChange,
  onOpenCamera,
  onBack,
  onFinish,
  finishing,
  progress,
}: {
  questions: OpenQuestionClient[];
  drafts: OpenDraft[];
  onChange: (index: number, draft: OpenDraft) => void;
  onOpenCamera: (index: number) => void;
  onBack: () => void;
  onFinish: () => void;
  finishing: boolean;
  progress: string | null;
}) {
  const fileInputs = useRef<(HTMLInputElement | null)[]>([]);

  async function addFiles(index: number, files: FileList | null) {
    if (!files) return;
    const draft = drafts[index];
    const room = MAX_OPEN_IMAGES - draft.photos.length;
    const added: OpenDraft["photos"] = [];
    for (const f of Array.from(files).slice(0, Math.max(0, room))) {
      try {
        const { blob, dataUrl } = await toJpeg(f, 1600, 0.82);
        added.push({ blob, dataUrl });
      } catch {
        /* image illisible : ignorée */
      }
    }
    if (added.length) onChange(index, { ...draft, photos: [...draft.photos, ...added] });
  }

  return (
    <div>
      <p className="mb-3 rounded-card bg-mist2 px-3 py-2 text-xs text-slate">
        Partie B — questions rédigées. Elles sont corrigées par l&apos;IA selon un barème : la note est indicative, elle s&apos;ajoute à ta note de QCM
        (calculée séparément par le serveur).
      </p>
      <div className="space-y-4">
        {questions.map((q, i) => {
          const d = drafts[i] ?? { text: "", photos: [] };
          return (
            <div key={i} className="rounded-card border border-mist bg-white p-5">
              <p className="text-xs font-medium text-slate">
                Question B{i + 1} — {q.maxPoints} point{q.maxPoints > 1 ? "s" : ""}
              </p>
              <p className="mt-1 font-display text-base text-ink">{cleanMath(q.question)}</p>

              {q.type === "text" ? (
                <>
                  <textarea
                    aria-label={`Réponse à la question B${i + 1}`}
                    rows={6}
                    maxLength={MAX_OPEN_TEXT}
                    value={d.text}
                    onChange={(e) => onChange(i, { ...d, text: e.target.value })}
                    placeholder="Écris ta réponse ici…"
                    className="mt-3 w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                  <p className="mt-1 text-right text-xs text-slate/60">{d.text.length} / {MAX_OPEN_TEXT}</p>
                </>
              ) : (
                <div className="mt-3">
                  <p className="text-xs text-slate">
                    Fais ton schéma ou ta résolution sur une feuille, puis envoie-en une photo bien cadrée et bien éclairée ({MAX_OPEN_IMAGES} photos maximum).
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={d.photos.length >= MAX_OPEN_IMAGES} onClick={() => onOpenCamera(i)} className="flex items-center gap-2 rounded-card bg-mist2 px-3 py-2 text-sm text-ink disabled:opacity-50">
                      <Camera size={15} /> Prendre une photo
                    </button>
                    <button type="button" disabled={d.photos.length >= MAX_OPEN_IMAGES} onClick={() => fileInputs.current[i]?.click()} className="flex items-center gap-2 rounded-card border border-mist px-3 py-2 text-sm text-ink disabled:opacity-50">
                      <ImagePlus size={15} /> Choisir dans la galerie
                    </button>
                    <input
                      ref={(el) => {
                        fileInputs.current[i] = el;
                      }}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      aria-label={`Photo de la solution de la question B${i + 1}`}
                      onChange={(e) => {
                        void addFiles(i, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {d.photos.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {d.photos.map((p, n) => (
                        <div key={n} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.dataUrl} alt={`Photo ${n + 1} de ta solution`} className="h-24 w-24 rounded-card border border-mist object-cover" />
                          <button
                            type="button"
                            aria-label={`Retirer la photo ${n + 1}`}
                            onClick={() => onChange(i, { ...d, photos: d.photos.filter((_, k) => k !== n) })}
                            className="absolute -right-2 -top-2 rounded-full bg-ink p-1 text-paper"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    aria-label={`Explication facultative de la question B${i + 1}`}
                    rows={2}
                    maxLength={1000}
                    value={d.text}
                    onChange={(e) => onChange(i, { ...d, text: e.target.value })}
                    placeholder="Explication ou précision (facultatif)"
                    className="mt-3 w-full rounded-card border border-mist px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-between">
        <button type="button" onClick={onBack} disabled={finishing} className="rounded-card border border-mist px-5 py-2.5 text-sm text-ink hover:border-ink disabled:opacity-40">
          Retour aux QCM
        </button>
        <button type="button" onClick={onFinish} disabled={finishing} className="flex items-center gap-2 rounded-card bg-clay px-5 py-2.5 text-sm text-paper hover:bg-clay/90 disabled:opacity-60">
          {finishing ? (
            <>
              <Loader2 size={15} className="animate-spin" /> {progress ?? "Correction…"}
            </>
          ) : (
            "Terminer l'examen"
          )}
        </button>
      </div>
    </div>
  );
}
