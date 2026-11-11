// Import d'un cours depuis la page Examens (fichier, caméra) et liste de la bibliothèque. NAVIGATEUR (Supabase + RLS).
// Même chemin que « Mes cours » : fichier dans le bucket PRIVÉ « documents », ligne dans `courses`, puis analyse (lecture du texte).
import { supabase } from "./supabase";
import { imagesToPdf, ocrImages } from "./capture";
import type { CapturedPage } from "@/components/CameraCapture";

export const MAX_COURSE_FILE_BYTES = 15 * 1024 * 1024; // cohérent avec le bucket Supabase et la page « Mes cours »
export const COURSE_FILE_ACCEPT = ".pdf,.txt,.pptx,.docx,image/*";

export type LibraryCourse = { id: string; title: string; subject: string; created_at: string; status: string | null };

/** Envoie le fichier, crée le cours, renvoie son id. Lève une Error au message lisible. */
export async function createCourseFromBlob(blob: Blob, fileName: string, subject: string, contentText: string | null): Promise<string> {
  if (blob.size > MAX_COURSE_FILE_BYTES) throw new Error("Fichier trop volumineux (15 Mo maximum).");
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Session expirée : reconnecte-toi.");
  const userId = userData.user.id;
  const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${userId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage.from("documents").upload(path, blob);
  if (uploadError) throw new Error(uploadError.message);

  const baseRow = {
    owner_id: userId,
    title: fileName.replace(/\.[^.]+$/, "").slice(0, 120) || "Cours",
    subject,
    file_path: path,
    key_notions: [], // NOT NULL en base : vide tant que l'analyse n'a pas eu lieu
    questions: [],
    status: "pending",
  };
  let res = await supabase.from("courses").insert((contentText ? { ...baseRow, content_text: contentText } : baseRow) as never).select("id").single();
  if (res.error && contentText) res = await supabase.from("courses").insert(baseRow).select("id").single();
  if (res.error || !res.data) throw new Error(res.error?.message ?? "Impossible d'enregistrer le cours.");
  return res.data.id as string;
}

/** Pages filmées → lecture du texte (OCR dans le navigateur) → un seul document (JPEG ou PDF) → cours. */
export async function createCourseFromCamera(pages: CapturedPage[], subject: string, onProgress?: (msg: string) => void): Promise<string> {
  if (pages.length === 0) throw new Error("Filme au moins une page de ton cours.");
  onProgress?.("Lecture du texte des photos…");
  const text = await ocrImages(pages.map((p) => p.blob));
  const readable = text.trim().length >= 20 ? text : null;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
  const name = `Cours caméra ${stamp}`;
  onProgress?.("Préparation du document…");
  if (pages.length === 1) return createCourseFromBlob(pages[0].blob, `${name}.jpg`, subject, readable);
  const pdf = await imagesToPdf(pages);
  if (pdf.size > MAX_COURSE_FILE_BYTES) throw new Error("Document trop volumineux (15 Mo maximum) : filme moins de pages à la fois.");
  return createCourseFromBlob(pdf, `${name}.pdf`, subject, readable);
}

/** Cours de l'élève (RLS : uniquement les siens), les plus récents d'abord. */
export async function listLibraryCourses(): Promise<LibraryCourse[]> {
  const { data } = await supabase.from("courses").select("id, title, subject, created_at, status").order("created_at", { ascending: false }).limit(100);
  return (data as LibraryCourse[] | null) ?? [];
}
