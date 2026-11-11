import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { geminiModel, hasGeminiKey } from "@/lib/gemini";
import { geminiGenerate } from "@/lib/ai/gemini-http";
import { normalizeMathJson } from "@/lib/ai/math-text";
import { resolveLanguage } from "@/lib/ai/language";
import { composeSystemInstruction, wrapUntrustedData } from "@/lib/study-helper-rules";
import { languageReminder } from "@/lib/i18n/languages";
import {
  ANSWER_PHOTO_FOLDER, GRADING_SYSTEM, buildGradingData, hasAnswer, noAnswerGrading, parseGrading,
  type GradingResult, type RubricItem,
} from "@/lib/exam-open";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ resultId: z.string().uuid() });
const STALE_GRADING_MS = 180_000;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

type Row = {
  id: string; result_id: string; question_index: number; question: string; expected_answer: string | null; rubric: RubricItem[];
  max_points: number; answer_text: string | null; image_paths: string[]; status: string; points: number | null; feedback: unknown; updated_at: string;
};

/**
 * Correction IA de la Partie B d'un examen DÉJÀ soumis (le résultat QCM est indépendant et déjà enregistré).
 *  - Barème explicite appliqué critère par critère ; total recalculé côté serveur (jamais pris du modèle).
 *  - Idempotent : les réponses déjà corrigées ne sont jamais recorrigées ni débitées de nouveau.
 *  - Une seule correction à la fois par résultat (réclamation atomique) ; une opération = un débit ; tout échec = remboursement.
 *  - Réponse vide : 0 point sans appel IA. Photos relues depuis le bucket privé (dossier de l'élève uniquement).
 */
export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { resultId } = parsed.data;

  const load = async () =>
    ((await supabaseAdmin.from("exam_open_answers").select("*").eq("result_id", resultId).eq("owner_id", ownerId).order("question_index")).data ?? []) as Row[];
  const rows = await load();
  if (rows.length === 0) return NextResponse.json({ items: [] });

  const now = Date.now();
  const todo = rows.filter((r) => r.status === "pending" || r.status === "failed" || (r.status === "grading" && now - Date.parse(r.updated_at) > STALE_GRADING_MS));
  if (todo.length === 0) {
    const inProgress = rows.some((r) => r.status === "grading");
    return NextResponse.json({ items: rows, inProgress });
  }
  if (!hasGeminiKey()) return NextResponse.json({ error: "La correction IA n'est pas configurée sur le serveur. Tes réponses sont enregistrées." }, { status: 503 });

  // 1) Réclamation atomique : seules les lignes encore « à corriger » passent en « grading ».
  const claimed: Row[] = [];
  for (const r of todo) {
    const { data } = await supabaseAdmin
      .from("exam_open_answers")
      .update({ status: "grading", updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("status", r.status)
      .eq("updated_at", r.updated_at)
      .select("id")
      .maybeSingle();
    if (data) claimed.push(r);
  }
  if (claimed.length === 0) return NextResponse.json({ items: await load(), inProgress: true });
  const setStatus = async (ids: string[], status: "pending" | "failed") => {
    if (ids.length) await supabaseAdmin.from("exam_open_answers").update({ status, updated_at: new Date().toISOString() }).in("id", ids);
  };

  // 2) Quota : une correction de Partie B = un débit.
  const usage = await checkAndLogUsage(ownerId, "exam-grading");
  const usageError = usageErrorResponse(usage);
  if (usageError) {
    await setStatus(claimed.map((r) => r.id), "pending");
    return usageError;
  }
  if (!usage.allowed) {
    await setStatus(claimed.map((r) => r.id), "pending");
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne de corrections atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite de corrections atteinte (${usage.limit}/jour). Passe à Premium pour en lancer davantage. Tes réponses restent enregistrées.`,
        quotaExceeded: true,
      },
      { status: 429 },
    );
  }

  // 3) Correction (une requête IA par question ayant une réponse).
  const lang = await resolveLanguage(req, ownerId);
  const system = composeSystemInstruction(GRADING_SYSTEM, lang);
  const key = process.env.GEMINI_API_KEY ?? "";
  const prefix = `${ownerId}/${ANSWER_PHOTO_FOLDER}/`;

  const gradeOne = async (r: Row): Promise<GradingResult | null> => {
    const answer = { text: r.answer_text ?? "", imagePaths: (r.image_paths ?? []).filter((p) => p.startsWith(prefix) && !p.includes("..")) };
    if (!hasAnswer(answer)) return noAnswerGrading(r.rubric);

    const images: { mime_type: string; data: string }[] = [];
    for (const path of answer.imagePaths) {
      const mime = MIME[path.split(".").pop()?.toLowerCase() ?? ""];
      if (!mime) continue;
      const { data: blob } = await supabaseAdmin.storage.from("documents").download(path);
      if (!blob || blob.size > MAX_PHOTO_BYTES) continue;
      images.push({ mime_type: mime, data: Buffer.from(await blob.arrayBuffer()).toString("base64") });
    }
    // Photos annoncées mais illisibles/absentes et aucun texte : on ne note pas « à l'aveugle ».
    if (answer.imagePaths.length > 0 && images.length === 0 && !answer.text) return null;

    const data = wrapUntrustedData({
      title: "Question, barème et réponse de l'élève",
      content: buildGradingData({ question: r.question, expectedAnswer: r.expected_answer ?? "", rubric: r.rubric, maxPoints: r.max_points }, answer.text, images.length),
    });
    const res = await geminiGenerate({
      primaryModel: geminiModel(),
      key,
      body: {
        contents: [{ role: "user", parts: [{ text: `Corrige cette réponse selon le barème.\n\n${data}\n\n${languageReminder(lang)}` }, ...images.map((i) => ({ inline_data: i }))] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2500 },
      },
      timeoutMs: 50_000,
      label: "exam-grading",
      meter: { ownerId, feature: "exam-grading" },
    });
    if (!res.ok) return null;
    const text: string = res.data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return parseGrading(normalizeMathJson(text), r.rubric);
  };

  const results = await Promise.all(claimed.map(async (r) => ({ r, g: await gradeOne(r).catch(() => null) })));
  const failedIds: string[] = [];
  for (const { r, g } of results) {
    if (!g) {
      failedIds.push(r.id);
      continue;
    }
    await supabaseAdmin
      .from("exam_open_answers")
      .update({
        status: "graded",
        points: g.points,
        feedback: { criteria: g.criteria, summary: g.summary, uncertainty: g.uncertainty },
        graded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id);
  }
  await setStatus(failedIds, "failed");
  // Aucune question corrigée : requête échouée = non comptée.
  if (failedIds.length === claimed.length) await releaseUsage(ownerId, usage.usageId);

  const items = await load();
  if (failedIds.length > 0) {
    return NextResponse.json({
      items,
      warning: "Une partie de la correction IA a échoué (service momentanément indisponible ou photo illisible). Les autres notes sont enregistrées ; relance la correction.",
    });
  }
  return NextResponse.json({ items });
}
