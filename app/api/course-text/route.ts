import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { extractText } from "@/lib/extract-text";

export const runtime = "nodejs";
export const maxDuration = 60;

// Prépare le texte d'un document de la bibliothèque pour « Écouter », le professeur IA et l'appel en direct.
// Aucun appel Gemini, aucun quota d'analyse consommé : extraction locale (PDF/Word/PowerPoint/texte/OCR).
// Le texte est enregistré dans courses.content_text (comme le fait l'analyse) ; si le texte existe déjà, il est
// renvoyé tel quel. L'analyse IA, le statut et les autres champs du cours ne sont pas modifiés.

const MIN_TEXT = 20;
const inFlight = new Set<string>();

export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return NextResponse.json({ error: "Non authentifié.", code: "unauthenticated" }, { status: 401 });

  const burst = hitRateLimit(`course-text:${ownerId}`, 8, 60_000);
  if (!burst.ok) {
    return NextResponse.json(
      { error: "Trop de demandes. Patiente un instant.", code: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSec) } }
    );
  }

  const parsed = z.object({ courseId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide.", code: "invalid_request" }, { status: 400 });
  const { courseId } = parsed.data;

  let { data, error: lookupError } = await supabaseAdmin.from("courses").select("owner_id, file_path, content_text").eq("id", courseId).maybeSingle();
  if (lookupError && /content_text/.test(lookupError.message)) {
    // Colonne content_text absente (migration v1.7 pas encore exécutée) : on lit sans elle, l'extraction fonctionne quand même.
    console.error("[course-text] colonne content_text absente : exécute supabase/migration-v2.4-content-text.sql dans Supabase.");
    const retry = await supabaseAdmin.from("courses").select("owner_id, file_path").eq("id", courseId).maybeSingle();
    data = retry.data ? { ...retry.data, content_text: null } : retry.data;
    lookupError = retry.error;
  }
  if (lookupError) {
    console.error("[course-text] lecture du cours impossible :", lookupError.message);
    return NextResponse.json({ error: "Lecture du cours impossible.", code: "server_error" }, { status: 500 });
  }
  const course = data as { owner_id: string; file_path: string | null; content_text: string | null } | null;
  if (!course || course.owner_id !== ownerId) return NextResponse.json({ error: "Cours introuvable.", code: "not_found" }, { status: 404 });

  if (course.content_text && course.content_text.trim().length >= MIN_TEXT) {
    return NextResponse.json({ text: course.content_text, extracted: false });
  }
  if (!course.file_path) return NextResponse.json({ error: "Aucun fichier.", code: "no_text" }, { status: 422 });
  if (inFlight.has(courseId)) return NextResponse.json({ error: "Extraction déjà en cours.", code: "busy" }, { status: 409 });

  inFlight.add(courseId);
  try {
    let text: string | null = null;
    try {
      text = await extractText(course.file_path);
    } catch (e) {
      console.error("[course-text] extraction impossible :", e instanceof Error ? e.message : e);
    }
    if (!text || text.trim().length < MIN_TEXT) {
      return NextResponse.json(
        { error: "Impossible de lire le texte de ce document (PDF scanné, image illisible ou ancien format .doc/.ppt).", code: "no_text" },
        { status: 422 }
      );
    }
    const { error } = await supabaseAdmin.from("courses").update({ content_text: text }).eq("id", courseId).eq("owner_id", ownerId);
    if (error) console.error("[course-text] enregistrement impossible :", error.message); // le texte est quand même renvoyé
    return NextResponse.json({ text, extracted: true });
  } finally {
    inFlight.delete(courseId);
  }
}
