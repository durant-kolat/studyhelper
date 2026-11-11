import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini2, hasGemini2Key } from "@/lib/ai/gemini2";
import { resolveLanguage } from "@/lib/ai/language";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { PRACTICE_ACTIONS, PRACTICE_SYSTEM_PROMPT, actionInstruction } from "@/lib/ai/practice";
import { wrapUntrustedData } from "@/lib/study-helper-rules";
import { sanitizeLabel } from "@/lib/assistant-prompt";
import { normalizeMathNotation } from "@/lib/math-normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

const payload = z.object({
  action: z.enum(PRACTICE_ACTIONS),
  message: z.string().trim().max(4000).optional().default(""),
  subject: z.string().trim().max(100).optional().default(""),
  level: z.enum(["debutant", "intermediaire", "avance"]).optional().default("intermediaire"),
  courseId: z.string().uuid().optional(),
  language: z.string().max(10).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) }))
    .max(10)
    .optional()
    .default([]),
});

const LEVEL_LABEL = { debutant: "débutant", intermediaire: "intermédiaire", avance: "avancé" } as const;

/**
 * « Pratique » : servie par Gemini n°2 (Gemini 3.5 Flash-Lite), qui a remplacé OpenAI. Aucun repli
 * silencieux sur un autre moteur : si Gemini n°2 n'est pas configuré ou en panne, l'utilisateur en
 * est informé. La langue de sortie est la langue sélectionnée dans l'application, transmise explicitement.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!hasGemini2Key()) {
    return NextResponse.json({ error: "La Pratique n'est pas encore configurée sur ce serveur.", code: "not_configured" }, { status: 503 });
  }
  const burst = hitRateLimit(`practice:${ownerId}`, 8, 60_000);
  if (!burst.ok) {
    return NextResponse.json({ error: "Trop de demandes. Patiente un instant.", code: "too_many_requests" }, { status: 429, headers: { "Retry-After": String(burst.retryAfterSec) } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide.", code: "invalid_request" }, { status: 400 });
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide.", code: "invalid_request" }, { status: 400 });
  const { action, message, subject, level, courseId, history, language } = parsed.data;
  if (action !== "exercise" && action !== "progress" && message.length < 2 && !courseId) {
    return NextResponse.json({ error: "Écris ta demande ou ta réponse.", code: "empty_message" }, { status: 400 });
  }

  const lang = await resolveLanguage(req, ownerId, language);

  const usage = await checkAndLogUsage(ownerId, "practice");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (usage.status === "quota") {
    return NextResponse.json({ error: "Limite quotidienne de Pratique atteinte.", code: "quota_exceeded", quotaExceeded: true }, { status: 429 });
  }

  try {
    // Cours choisi par l'utilisateur : lu dans SA langue d'origine, jamais modifié. Propriété vérifiée.
    const blocks: { title: string; content: string }[] = [];
    let courseSubject = "";
    if (courseId) {
      const { data: course } = await supabaseAdmin
        .from("courses")
        .select("owner_id, subject, title, content_text")
        .eq("id", courseId)
        .maybeSingle();
      if (!course || course.owner_id !== ownerId) {
        await releaseUsage(ownerId, usage.usageId);
        return NextResponse.json({ error: "Cours introuvable.", code: "not_found" }, { status: 404 });
      }
      courseSubject = sanitizeLabel(course.subject, 100);
      if (course.content_text) blocks.push({ title: `Cours : ${sanitizeLabel(course.title, 120)}`, content: String(course.content_text).slice(0, 8000) });
    }

    if (action === "progress") {
      const { data: results } = await supabaseAdmin
        .from("exam_results")
        .select("subject, score_percent")
        .eq("owner_id", ownerId)
        .order("taken_at", { ascending: false })
        .limit(40);
      const bySubject = new Map<string, number[]>();
      for (const r of (results ?? []) as { subject: string | null; score_percent: number | null }[]) {
        if (!r.subject || r.score_percent === null) continue;
        bySubject.set(r.subject, [...(bySubject.get(r.subject) ?? []), r.score_percent]);
      }
      const summary =
        bySubject.size === 0
          ? "Aucun résultat d'examen ou de quiz enregistré pour le moment."
          : Array.from(bySubject.entries())
              .map(([s, v]) => `${sanitizeLabel(s, 60)} : moyenne ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} % sur ${v.length} résultat(s)`)
              .join("\n");
      blocks.push({ title: "Résultats de l'apprenant", content: summary });
    }

    const subj = sanitizeLabel(subject, 100) || courseSubject || "non précisée";
    const system = `${PRACTICE_SYSTEM_PROMPT}\n\nMatière : ${subj}\nNiveau de l'apprenant : ${LEVEL_LABEL[level]}\n\n${actionInstruction(action)}`;
    const dataBlocks = blocks.length ? `\n\n${blocks.map((b) => wrapUntrustedData(b)).join("\n\n")}` : "";
    const prompt = `${message || "(aucun message : utilise la matière, le niveau et le cours fournis)"}${dataBlocks}`;

    const result = await callGemini2(prompt, system, history.slice(-8), { lang, temperature: 0.5, meter: { ownerId, feature: "practice" } });
    if (!result.ok) {
      console.error("[practice] échec Gemini n°2 :", result.detail);
      await releaseUsage(ownerId, usage.usageId);
      return NextResponse.json({ error: "La Pratique est momentanément indisponible. Réessaie.", code: "ai_unavailable" }, { status: 502 });
    }
    return NextResponse.json({ reply: normalizeMathNotation(result.text.trim()), engine: "gemini2", lang });
  } catch (err) {
    console.error("[practice] erreur inattendue :", err instanceof Error ? err.message : err);
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json({ error: "Une erreur est survenue.", code: "server_error" }, { status: 500 });
  }
}
