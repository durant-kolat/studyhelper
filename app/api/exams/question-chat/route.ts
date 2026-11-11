import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, releaseUsage, usageErrorResponse } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { wrapUntrustedData } from "@/lib/study-helper-rules";
import {
  CHAT_ACTIONS, CHAT_ACTION_IDS, CHAT_HISTORY_SENT, CHAT_SYSTEM, MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_MESSAGES_KEPT,
  buildChatContext, sanitizeChatMessages, type AnalysisItem, type GradedQ, type MistakeItem,
} from "@/lib/exam-analysis";
import { OPEN_CHAT_SYSTEM, buildOpenChatContext, chatIndexFor } from "@/lib/exam-open";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z
  .object({
    resultId: z.string().uuid(),
    questionIndex: z.number().int().min(0).max(200),
    // « B » = question rédigée de la Partie B (sinon QCM de la Partie A).
    part: z.enum(["A", "B"]).optional(),
    action: z.enum(CHAT_ACTION_IDS as [string, ...string[]]).optional(),
    message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS).optional(),
  })
  .refine((v) => Boolean(v.action) !== Boolean(v.message), { message: "Fournis soit une action, soit un message." });

/**
 * Chat privé sous une question corrigée. Le contexte (énoncé, réponse de l'élève, corrigé, barème, explication précédente)
 * est relu EN BASE côté serveur : le client n'envoie jamais le corrigé et ne recopie rien. Un utilisateur ne peut ouvrir
 * que ses propres résultats (filtre owner_id) ; les messages sont lisibles par lui seul (RLS).
 */
export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide (message vide ou trop long)." }, { status: 400 });
  const { resultId, questionIndex, action, message } = parsed.data;
  const part = parsed.data.part ?? "A";
  const chatIndex = chatIndexFor(part, questionIndex); // Partie B : index décalé dans la même table

  if (!hasGeminiKey()) return NextResponse.json({ error: "Le chat IA n'est pas configuré sur le serveur." }, { status: 503 });

  let contextBlock: string;
  let system = CHAT_SYSTEM;
  if (part === "B") {
    const { data: row } = await supabaseAdmin
      .from("exam_open_answers")
      .select("question, expected_answer, max_points, answer_text, image_paths, status, points, rubric, feedback")
      .eq("result_id", resultId)
      .eq("owner_id", ownerId)
      .eq("question_index", questionIndex)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Question introuvable." }, { status: 404 });
    contextBlock = wrapUntrustedData({ title: "Question rédigée corrigée (Partie B)", content: buildOpenChatContext(row) });
    system = OPEN_CHAT_SYSTEM;
  } else {
    const { data: result } = await supabaseAdmin
      .from("exam_results")
      .select("id, questions, answers")
      .eq("id", resultId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    const questions = result?.questions as GradedQ[] | null | undefined;
    const q = questions?.[questionIndex];
    if (!result || !q) return NextResponse.json({ error: "Question introuvable." }, { status: 404 });

    const rawGiven = (result.answers as number[] | null)?.[questionIndex];
    const item: MistakeItem = { index: questionIndex, question: q.question, options: q.options, given: Number.isInteger(rawGiven) ? (rawGiven as number) : -1, correctIndex: q.correctIndex, method: q.method };

    const { data: analysisRow } = await supabaseAdmin.from("exam_analyses").select("analysis").eq("result_id", resultId).eq("owner_id", ownerId).eq("status", "done").maybeSingle();
    const previous = (Array.isArray(analysisRow?.analysis) ? (analysisRow!.analysis as AnalysisItem[]) : []).find((a) => a.index === questionIndex) ?? null;

    contextBlock = wrapUntrustedData({ title: "Question corrigée", content: buildChatContext(item, previous) });
  }

  const { data: chatRow } = await supabaseAdmin.from("exam_question_chats").select("messages").eq("result_id", resultId).eq("question_index", chatIndex).eq("owner_id", ownerId).maybeSingle();
  const history = sanitizeChatMessages(chatRow?.messages);

  const usage = await checkAndLogUsage(ownerId, "exam-chat");
  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;
  if (!usage.allowed) {
    return NextResponse.json(
      { error: usage.isPremium ? `Limite quotidienne de messages atteinte (${usage.limit}/jour).` : `Limite quotidienne gratuite de messages atteinte (${usage.limit}/jour). Passe à Premium pour continuer.`, quotaExceeded: true },
      { status: 429 },
    );
  }

  const userText = action ? CHAT_ACTIONS[action as keyof typeof CHAT_ACTIONS].label : (message as string);
  const instruction = action ? CHAT_ACTIONS[action as keyof typeof CHAT_ACTIONS].instruction : (message as string);
  const lang = await resolveLanguage(req, ownerId);

  const ai = await callGemini(`${contextBlock}\n\nDemande de l'élève : ${instruction}`, system, false, history.slice(-CHAT_HISTORY_SENT), { lang, timeoutMs: 45_000, maxOutputTokens: 1500, meter: { ownerId, feature: "exam-chat" } });
  if (!ai.ok || !ai.text.trim()) {
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json({ error: "Le tuteur IA est momentanément indisponible. Réessaie dans un instant (message non compté)." }, { status: 502 });
  }

  const messages = [...history, { role: "user" as const, content: userText }, { role: "assistant" as const, content: ai.text.trim() }].slice(-MAX_CHAT_MESSAGES_KEPT);
  await supabaseAdmin
    .from("exam_question_chats")
    .upsert({ result_id: resultId, owner_id: ownerId, question_index: chatIndex, messages, updated_at: new Date().toISOString() }, { onConflict: "result_id,question_index" });
  return NextResponse.json({ reply: ai.text.trim(), messages });
}
