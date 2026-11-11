import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey, geminiModel } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { wrapUntrustedData } from "@/lib/study-helper-rules";
import { ANALYSIS_SYSTEM, buildAnalysisData, collectMistakes, parseAnalysis, type GradedQ } from "@/lib/exam-analysis";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ resultId: z.string().uuid(), regenerate: z.boolean().optional() });
const STALE_PENDING_MS = 120_000;

/**
 * Analyse pédagogique IA d'un examen DÉJÀ corrigé. La note (calculée par /api/exams/submit) n'est jamais touchée.
 *  - Idempotent : une analyse déjà faite est renvoyée sans appel IA et sans débit (sauf regenerate: true = nouvelle opération voulue).
 *  - Une seule analyse à la fois par résultat (verrou « pending » atomique) → pas de double débit si l'élève clique deux fois.
 *  - Appel échoué → crédit remboursé, verrou relâché, résultat toujours consultable.
 *  - Seules les questions FAUSSES ou sans réponse sont envoyées au modèle.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { resultId, regenerate } = parsed.data;

  const { data: result } = await supabaseAdmin
    .from("exam_results")
    .select("id, questions, answers")
    .eq("id", resultId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!result) return NextResponse.json({ error: "Résultat introuvable." }, { status: 404 });

  const mistakes = collectMistakes(result.questions as GradedQ[] | null, result.answers as number[] | null);
  if (mistakes.length === 0) return NextResponse.json({ analysis: [], noMistakes: true, cached: false });

  const { data: existing } = await supabaseAdmin
    .from("exam_analyses")
    .select("id, status, analysis, updated_at")
    .eq("result_id", resultId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existing?.status === "done" && existing.analysis && !regenerate) {
    return NextResponse.json({ analysis: existing.analysis, cached: true });
  }
  if (existing?.status === "pending" && Date.now() - Date.parse(existing.updated_at) < STALE_PENDING_MS) {
    return NextResponse.json({ error: "Une analyse est déjà en cours pour cet examen. Patiente quelques secondes.", code: "in_progress" }, { status: 409 });
  }

  if (!hasGeminiKey()) return NextResponse.json({ error: "L'analyse IA n'est pas configurée sur le serveur. Ta note reste disponible." }, { status: 503 });

  // 1) Verrou atomique (insertion unique, ou mise à jour conditionnée à l'état lu).
  let rowId: string | null = null;
  if (!existing) {
    const { data, error } = await supabaseAdmin
      .from("exam_analyses")
      .insert({ result_id: resultId, owner_id: ownerId, status: "pending" })
      .select("id")
      .single();
    if (error || !data) return NextResponse.json({ error: "Une analyse est déjà en cours pour cet examen.", code: "in_progress" }, { status: 409 });
    rowId = data.id;
  } else {
    const { data } = await supabaseAdmin
      .from("exam_analyses")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("updated_at", existing.updated_at)
      .select("id")
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "Une analyse est déjà en cours pour cet examen.", code: "in_progress" }, { status: 409 });
    rowId = data.id;
  }

  const revert = async () => {
    if (!existing) await supabaseAdmin.from("exam_analyses").delete().eq("id", rowId!);
    else await supabaseAdmin.from("exam_analyses").update({ status: existing.status, updated_at: new Date().toISOString() }).eq("id", rowId!);
  };

  // 2) Quota (une opération = un débit).
  const usage = await checkAndLogUsage(ownerId, "exam-analysis");
  const usageError = usageErrorResponse(usage);
  if (usageError) {
    await revert();
    return usageError;
  }
  if (!usage.allowed) {
    await revert();
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Limite quotidienne d'analyses atteinte (${usage.limit}/jour).`
          : `Limite quotidienne gratuite d'analyses atteinte (${usage.limit}/jour). Passe à Premium pour en lancer davantage. Ta note reste disponible.`,
        quotaExceeded: true,
      },
      { status: 429 },
    );
  }

  // 3) Appel IA.
  const lang = await resolveLanguage(req, ownerId);
  const data = wrapUntrustedData({ title: "Questions ratées de l'examen", content: buildAnalysisData(mistakes) });
  const ai = await callGemini(`Analyse ces questions ratées.\n\n${data}`, ANALYSIS_SYSTEM, true, [], { lang, timeoutMs: 50_000, maxOutputTokens: 6000, meter: { ownerId, feature: "exam-analysis" } });

  const items = ai.ok ? parseAnalysis(ai.text, mistakes.map((m) => m.index)) : null;
  if (!ai.ok || !items) {
    await releaseUsage(ownerId, usage.usageId); // requête échouée = non comptée
    if (!existing) await supabaseAdmin.from("exam_analyses").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", rowId!);
    else await revert();
    return NextResponse.json(
      { error: "L'analyse IA est momentanément indisponible. Ta note et les corrections restent affichées ; réessaie dans un instant (cette tentative n'est pas comptée)." },
      { status: 502 },
    );
  }

  await supabaseAdmin
    .from("exam_analyses")
    .update({ status: "done", analysis: items, model: geminiModel(), updated_at: new Date().toISOString() })
    .eq("id", rowId!);
  return NextResponse.json({ analysis: items, cached: false });
}
