import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { checkAndLogUsage, getUsageStatus, releaseUsage, usageErrorResponse, type UsageKind } from "@/lib/rate-limit";
import { callGemini, hasGeminiKey, type GeminiUsage } from "@/lib/gemini";
import { resolveLanguage } from "@/lib/ai/language";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { wrapUntrustedData } from "@/lib/study-helper-rules";
import { sanitizeLabel } from "@/lib/assistant-prompt";
import { normalizeMathNotation } from "@/lib/math-normalize";
import { checkAiBudget, recordAiCost, budgetExceededResponse } from "@/lib/ai-cost";
import { splitIntoParagraphs, DEFAULT_PARAGRAPH_LIMITS } from "@/lib/tutor/paragraphs";
import {
  attemptsAfter,
  parseEval,
  parseFinal,
  parseTeach,
  shouldAdvance,
  REFORMULATE_AFTER_ATTEMPTS,
} from "@/lib/tutor/parse";
import { ANSWER_SYSTEM, ASK_SYSTEM, FINAL_SYSTEM, TEACH_OTHER_SYSTEM, TEACH_SYSTEM } from "@/lib/tutor/prompts";
import type { LangCode } from "@/lib/i18n/languages";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------------------------
// Professeur IA : enseigne un cours de la bibliothèque paragraphe par paragraphe.
//  • Même service Gemini (callGemini), même modèle, même clé que le reste de l'application.
//  • La PROGRESSION (paragraphe, question en cours, tentatives) vit en base, côté serveur : le client
//    ne peut ni se donner « paragraphe suivant » ni falsifier la question évaluée.
//  • Une séance = 1 unité de quota « tutor » (comptée au démarrage d'une NOUVELLE séance uniquement) ;
//    reprendre une séance ne coûte aucun essai. Les appels IA d'une séance sont bornés par un plafond
//    de tours et par le budget de consommation (tokens réels), indépendants du quota.
//  • Seul le paragraphe étudié (+ titre, matière, notions à revoir) est envoyé à Gemini — jamais le cours entier.
// ---------------------------------------------------------------------------------------------

const intEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const limits = () => ({
  maxDocChars: intEnv("TUTOR_MAX_DOC_CHARS", DEFAULT_PARAGRAPH_LIMITS.maxDocChars),
  maxParagraphs: intEnv("TUTOR_MAX_PARAGRAPHS", DEFAULT_PARAGRAPH_LIMITS.maxParagraphs),
});
const maxTurns = () => intEnv("TUTOR_MAX_TURNS_PER_SESSION", 150);

const id = z.string().uuid();
const payload = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), courseId: id }),
  z.object({ action: z.literal("start"), courseId: id, mode: z.enum(["new", "resume"]), sessionId: id.optional(), language: z.string().max(10).optional() }),
  z.object({ action: z.literal("teach"), sessionId: id, variant: z.enum(["first", "other"]).default("first"), language: z.string().max(10).optional() }),
  z.object({ action: z.literal("answer"), sessionId: id, answer: z.string().trim().min(1).max(2000), via: z.enum(["text", "voice"]).default("text"), language: z.string().max(10).optional() }),
  z.object({
    action: z.literal("ask"),
    sessionId: id,
    question: z.string().trim().min(1).max(1000),
    via: z.enum(["text", "voice"]).default("text"),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(800) })).max(4).optional().default([]),
    language: z.string().max(10).optional(),
  }),
  z.object({ action: z.literal("goto"), sessionId: id, index: z.number().int().min(0).max(1000) }),
  z.object({ action: z.literal("skip"), sessionId: id }),
  z.object({ action: z.literal("pause"), sessionId: id, status: z.enum(["paused", "stopped"]) }),
  z.object({ action: z.literal("voice_start"), sessionId: id }),
  z.object({ action: z.literal("finish"), sessionId: id, language: z.string().max(10).optional() }),
]);

type SessionRow = {
  id: string;
  owner_id: string;
  course_id: string;
  status: "active" | "paused" | "stopped" | "completed";
  paragraph_index: number;
  max_index: number;
  paragraph_count: number;
  attempts: number;
  current_question: string | null;
  turns: number;
  voice_counted: boolean;
  summary_used: boolean;
  weak_notions: string[] | null;
  final_result: unknown;
  last_activity_at: string;
};

const err = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, code, ...extra }, { status });

// Anti double-clic / double requête sur la même séance (par instance serveur ; le client désactive aussi ses boutons).
const inFlight = new Set<string>();

async function loadSession(sessionId: string, ownerId: string): Promise<SessionRow | null> {
  const { data } = await supabaseAdmin.from("tutor_sessions").select("*").eq("id", sessionId).eq("owner_id", ownerId).maybeSingle();
  return (data as SessionRow | null) ?? null;
}

async function loadCourse(courseId: string, ownerId: string) {
  const { data } = await supabaseAdmin
    .from("courses")
    .select("owner_id, title, subject, content_text")
    .eq("id", courseId)
    .maybeSingle();
  const c = data as { owner_id: string; title: string; subject: string; content_text: string | null } | null;
  if (!c || c.owner_id !== ownerId) return null;
  const { paragraphs, truncated } = splitIntoParagraphs(c.content_text ?? "", limits());
  return { title: c.title, subject: c.subject, paragraphs, truncated };
}

function stateOf(s: SessionRow, paragraphs: string[], truncated = false) {
  const index = Math.min(s.paragraph_index, Math.max(0, paragraphs.length - 1));
  return {
    sessionId: s.id,
    status: s.status,
    index,
    count: paragraphs.length,
    maxIndex: s.max_index,
    paragraph: paragraphs[index] ?? "",
    truncated,
    currentQuestion: s.current_question,
    attempts: s.attempts,
    voiceCounted: s.voice_counted,
    done: s.status === "completed",
  };
}

async function touch(sessionId: string, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("tutor_sessions")
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) console.error("[tutor] mise à jour de séance impossible :", error.message);
  return !error;
}

type Gate = { ok: true } | { ok: false; res: NextResponse };

/** Garde-fous communs avant TOUT appel Gemini : séance modifiable, plafond de tours, budget de consommation. */
async function gateAi(s: SessionRow, ownerId: string): Promise<Gate> {
  if (s.status === "stopped") return { ok: false, res: err(409, "session_stopped", "Cette séance est arrêtée. Reprends-la pour continuer.") };
  if (s.turns >= maxTurns()) {
    return { ok: false, res: err(429, "session_turn_limit", "Cette séance a atteint sa longueur maximale. Termine-la ou commence une nouvelle séance.") };
  }
  const budget = await checkAiBudget(ownerId);
  if (!budget.allowed) return { ok: false, res: budgetExceededResponse(budget) };
  return { ok: true };
}

async function runGemini(
  ownerId: string,
  feature: string,
  prompt: string,
  system: string,
  lang: LangCode,
  opts: { json: boolean; maxOutputTokens: number; history?: { role: "user" | "assistant"; content: string }[] }
) {
  const r = await callGemini(prompt, system, opts.json, opts.history ?? [], { lang, temperature: 0.4, maxOutputTokens: opts.maxOutputTokens });
  const usage: GeminiUsage | undefined = r.ok ? r.usage : undefined;
  await recordAiCost(ownerId, feature, usage, r.ok ? "ok" : "error");
  return r;
}

const AI_DOWN = () => err(502, "ai_unavailable", "Le professeur est momentanément indisponible. Réessaie dans un instant — rien n'est perdu.");

export async function POST(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return err(401, "unauthenticated", "Non authentifié.");
  if (!hasGeminiKey()) return err(503, "not_configured", "Le professeur IA n'est pas encore configuré sur ce serveur.");

  const burst = hitRateLimit(`tutor:${ownerId}`, 20, 60_000);
  if (!burst.ok) {
    return NextResponse.json(
      { error: "Trop de demandes. Patiente un instant.", code: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSec) } }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, "invalid_request", "Requête invalide.");
  }
  const parsed = payload.safeParse(raw);
  if (!parsed.success) return err(400, "invalid_request", "Demande invalide.");
  const body = parsed.data;

  try {
    // ------------------------------------------------------------------ status (aucun coût)
    if (body.action === "status") {
      const { data } = await supabaseAdmin
        .from("tutor_sessions")
        .select("id, status, paragraph_index, paragraph_count, last_activity_at")
        .eq("owner_id", ownerId)
        .eq("course_id", body.courseId)
        .in("status", ["active", "paused", "stopped"])
        .order("last_activity_at", { ascending: false })
        .limit(1);
      const row = (data as { id: string; status: string; paragraph_index: number; paragraph_count: number; last_activity_at: string }[] | null)?.[0] ?? null;
      const quota = await getUsageStatus(ownerId, "tutor");
      return NextResponse.json({
        resumable: row ? { sessionId: row.id, index: row.paragraph_index, count: row.paragraph_count, lastActivityAt: row.last_activity_at } : null,
        quota,
      });
    }

    // ------------------------------------------------------------------ start
    if (body.action === "start") {
      const course = await loadCourse(body.courseId, ownerId);
      if (!course) return err(404, "not_found", "Cours introuvable.");
      if (course.paragraphs.length === 0) {
        return err(422, "no_text", "Le texte de ce document n'est pas disponible. Analyse d'abord le document depuis « Mes cours », puis réessaie.");
      }

      if (body.mode === "resume") {
        if (!body.sessionId) return err(400, "invalid_request", "Séance à reprendre manquante.");
        const s = await loadSession(body.sessionId, ownerId);
        if (!s || s.course_id !== body.courseId) return err(404, "not_found", "Séance introuvable.");
        if (s.status === "completed") return err(409, "session_completed", "Cette séance est terminée.");
        await touch(s.id, { status: "active" }); // reprendre ne coûte aucun essai
        return NextResponse.json({ state: stateOf({ ...s, status: "active" }, course.paragraphs, course.truncated), title: course.title });
      }

      // Nouvelle séance : budget → quota (comptage unique) → création.
      const budget = await checkAiBudget(ownerId);
      if (!budget.allowed) return budgetExceededResponse(budget);
      const usage = await checkAndLogUsage(ownerId, "tutor");
      const usageError = usageErrorResponse(usage);
      if (usageError) return usageError;
      if (usage.status === "quota") {
        return err(429, "quota_exceeded", "Limite quotidienne de séances avec le professeur IA atteinte.", {
          quotaExceeded: true,
          limit: usage.limit,
          isPremium: usage.isPremium,
        });
      }
      const lang = await resolveLanguage(req, ownerId, body.language);
      // Une seule séance « ouverte » par cours : les anciennes passent à « arrêtée » (rien n'est supprimé).
      await supabaseAdmin
        .from("tutor_sessions")
        .update({ status: "stopped" })
        .eq("owner_id", ownerId)
        .eq("course_id", body.courseId)
        .in("status", ["active", "paused"]);
      const { data: created, error } = await supabaseAdmin
        .from("tutor_sessions")
        .insert({ owner_id: ownerId, course_id: body.courseId, paragraph_count: course.paragraphs.length, language: lang })
        .select("*")
        .single();
      if (error || !created) {
        console.error("[tutor] création de séance impossible :", error?.message);
        await releaseUsage(ownerId, usage.usageId); // aucune séance créée → aucun essai perdu
        return err(500, "server_error", "Impossible de démarrer la séance. Cet essai n'est pas compté.");
      }
      return NextResponse.json({
        state: stateOf(created as SessionRow, course.paragraphs, course.truncated),
        title: course.title,
        quota: { limit: usage.limit, used: usage.used, remaining: usage.remaining },
      });
    }

    // Toutes les autres actions concernent une séance existante dont l'utilisateur est propriétaire.
    const s = await loadSession(body.sessionId, ownerId);
    if (!s) return err(404, "not_found", "Séance introuvable.");

    // ------------------------------------------------------------------ pause / arrêt (aucun coût)
    if (body.action === "pause") {
      if (s.status === "completed") return NextResponse.json({ ok: true });
      await touch(s.id, { status: body.status });
      return NextResponse.json({ ok: true });
    }

    const course = await loadCourse(s.course_id, ownerId);
    if (!course || course.paragraphs.length === 0) return err(404, "not_found", "Cours introuvable.");
    const paragraphs = course.paragraphs;

    // ------------------------------------------------------------------ voice_start : séance vocale comptée UNE fois
    if (body.action === "voice_start") {
      if (s.voice_counted) return NextResponse.json({ ok: true, alreadyCounted: true });
      const usage = await checkAndLogUsage(ownerId, "voice-session");
      const usageError = usageErrorResponse(usage);
      if (usageError) return usageError;
      if (usage.status === "quota") {
        return err(429, "quota_exceeded", "Limite quotidienne de séances vocales atteinte. Tu peux continuer par écrit.", {
          quotaExceeded: true,
          kind: "voice-session",
          limit: usage.limit,
          isPremium: usage.isPremium,
        });
      }
      const ok = await touch(s.id, { voice_counted: true });
      if (!ok) {
        await releaseUsage(ownerId, usage.usageId);
        return err(500, "server_error", "Impossible d'activer le mode vocal. Cet essai n'est pas compté.");
      }
      return NextResponse.json({ ok: true });
    }

    // ------------------------------------------------------------------ goto / skip (aucun appel IA)
    if (body.action === "goto") {
      if (s.status === "completed") return err(409, "session_completed", "Cette séance est terminée.");
      const target = Math.min(body.index, s.max_index, paragraphs.length - 1);
      await touch(s.id, { paragraph_index: target, current_question: null, attempts: 0, status: "active" });
      return NextResponse.json({ state: stateOf({ ...s, paragraph_index: target, current_question: null, attempts: 0, status: "active" }, paragraphs, course.truncated) });
    }

    if (body.action === "skip") {
      // Choix EXPLICITE de l'élève (jamais automatique) : la notion est notée « à revoir ».
      if (s.status === "completed") return err(409, "session_completed", "Cette séance est terminée.");
      const weak = [...(s.weak_notions ?? [])];
      if (s.current_question && weak.length < 12) weak.push(sanitizeLabel(s.current_question, 120));
      const next = s.paragraph_index + 1;
      const done = next >= paragraphs.length;
      const patch = done
        ? { status: "completed", current_question: null, attempts: 0, weak_notions: weak }
        : { paragraph_index: next, max_index: Math.max(s.max_index, next), current_question: null, attempts: 0, weak_notions: weak };
      await touch(s.id, patch);
      return NextResponse.json({ state: stateOf({ ...s, ...patch } as SessionRow, paragraphs, course.truncated) });
    }

    // ------------------------------------------------------------------ actions avec appel Gemini
    if (s.status === "completed" && body.action !== "finish") return err(409, "session_completed", "Cette séance est terminée.");
    const lang = await resolveLanguage(req, ownerId, "language" in body ? body.language : undefined);
    if (inFlight.has(s.id)) return err(409, "busy", "Une demande est déjà en cours pour cette séance.");
    inFlight.add(s.id);
    try {
      const idx = Math.min(s.paragraph_index, paragraphs.length - 1);
      const para = paragraphs[idx];
      const header = `Cours : ${sanitizeLabel(course.title, 120)} · Matière : ${sanitizeLabel(course.subject, 80)} · Paragraphe ${idx + 1}/${paragraphs.length}`;
      const weakLine = (s.weak_notions ?? []).length ? `\nNotions déjà jugées difficiles : ${(s.weak_notions ?? []).slice(-5).map((w) => sanitizeLabel(w, 100)).join(" | ")}` : "";

      // ---- teach (première explication ou « autre explication »)
      if (body.action === "teach") {
        const gate = await gateAi(s, ownerId);
        if (!gate.ok) return gate.res;
        const other = body.variant === "other";
        const prompt = `${header}${weakLine}\n\n${wrapUntrustedData({ title: "Paragraphe du cours", content: para })}${
          other && s.current_question ? `\n\nQuestion posée précédemment : ${sanitizeLabel(s.current_question, 300)}` : ""
        }\n\n${other ? "Donne une autre explication de ce paragraphe." : "Explique ce paragraphe puis pose ta question."}`;
        const r = await runGemini(ownerId, other ? "tutor-reexplain" : "tutor-teach", prompt, other ? TEACH_OTHER_SYSTEM : TEACH_SYSTEM, lang, { json: true, maxOutputTokens: 1500 });
        if (!r.ok) {
          console.error("[tutor] teach : échec Gemini :", r.detail);
          return AI_DOWN();
        }
        const out = parseTeach(r.text);
        if (!out) {
          console.error("[tutor] teach : réponse illisible.");
          return AI_DOWN();
        }
        await touch(s.id, { current_question: out.question, turns: s.turns + 1, attempts: other ? s.attempts : 0, status: "active" });
        return NextResponse.json({
          explanation: normalizeMathNotation(out.explanation),
          question: normalizeMathNotation(out.question),
          paragraphLang: out.paragraphLang,
          state: stateOf({ ...s, current_question: out.question, attempts: other ? s.attempts : 0, status: "active" }, paragraphs, course.truncated),
        });
      }

      // ---- answer (évaluation pédagogique ; le serveur décide de l'avancement)
      if (body.action === "answer") {
        if (body.via === "voice" && !s.voice_counted) {
          return err(403, "voice_not_started", "Le mode vocal n'est pas activé pour cette séance.");
        }
        if (!s.current_question) return err(409, "no_question", "Aucune question en attente. Demande d'abord l'explication du paragraphe.");
        const gate = await gateAi(s, ownerId);
        if (!gate.ok) return gate.res;
        const prompt = `${header}\nTentatives précédentes non réussies sur ce paragraphe : ${s.attempts}\n\n${wrapUntrustedData({ title: "Paragraphe du cours", content: para })}\n\nQuestion posée à l'élève : ${sanitizeLabel(s.current_question, 400)}\n\n${wrapUntrustedData({ title: "Réponse de l'élève", content: body.answer })}\n\nÉvalue la réponse de l'élève.`;
        const r = await runGemini(ownerId, "tutor-answer", prompt, ANSWER_SYSTEM, lang, { json: true, maxOutputTokens: 1200 });
        if (!r.ok) {
          console.error("[tutor] answer : échec Gemini :", r.detail);
          return AI_DOWN();
        }
        const ev = parseEval(r.text);
        if (!ev) {
          console.error("[tutor] answer : réponse illisible.");
          return AI_DOWN();
        }
        const attempts = attemptsAfter(s.attempts, ev.verdict);
        const advance = shouldAdvance(ev.verdict);
        const weak = [...(s.weak_notions ?? [])];
        if (!advance && attempts >= REFORMULATE_AFTER_ATTEMPTS && s.attempts < REFORMULATE_AFTER_ATTEMPTS && weak.length < 12) {
          weak.push(sanitizeLabel(s.current_question, 120));
        }
        let patch: Record<string, unknown>;
        if (advance) {
          const next = s.paragraph_index + 1;
          patch =
            next >= paragraphs.length
              ? { status: "completed", current_question: null, attempts: 0, turns: s.turns + 1 }
              : { paragraph_index: next, max_index: Math.max(s.max_index, next), current_question: null, attempts: 0, turns: s.turns + 1 };
        } else {
          patch = { attempts, turns: s.turns + 1, weak_notions: weak, ...(ev.nextQuestion ? { current_question: ev.nextQuestion } : {}) };
        }
        await touch(s.id, patch);
        return NextResponse.json({
          verdict: ev.verdict,
          feedback: normalizeMathNotation(ev.feedback),
          example: normalizeMathNotation(ev.example),
          advanced: advance,
          reformulated: !advance && s.attempts >= REFORMULATE_AFTER_ATTEMPTS,
          state: stateOf({ ...s, ...patch } as SessionRow, paragraphs, course.truncated),
        });
      }

      // ---- ask (question libre : la position dans le cours ne change pas)
      if (body.action === "ask") {
        if (body.via === "voice" && !s.voice_counted) {
          return err(403, "voice_not_started", "Le mode vocal n'est pas activé pour cette séance.");
        }
        const gate = await gateAi(s, ownerId);
        if (!gate.ok) return gate.res;
        const prompt = `${header}\n\n${wrapUntrustedData({ title: "Paragraphe en cours", content: para })}\n\n${wrapUntrustedData({ title: "Question de l'élève", content: body.question })}`;
        const r = await runGemini(ownerId, "tutor-ask", prompt, ASK_SYSTEM, lang, { json: false, maxOutputTokens: 900, history: body.history.slice(-4) });
        if (!r.ok) {
          console.error("[tutor] ask : échec Gemini :", r.detail);
          return AI_DOWN();
        }
        await touch(s.id, { turns: s.turns + 1 });
        return NextResponse.json({ reply: normalizeMathNotation(r.text.trim()), state: stateOf(s, paragraphs, course.truncated) });
      }

      // ---- finish (résumé, notions essentielles, mini-test) : compte 1 « summary », mis en cache
      if (body.action === "finish") {
        if (s.status !== "completed") return err(409, "not_finished", "Termine d'abord le cours pour obtenir le résumé.");
        if (s.final_result) return NextResponse.json({ final: s.final_result, cached: true });
        const gate = await gateAi(s, ownerId);
        if (!gate.ok) return gate.res;
        const usage = await checkAndLogUsage(ownerId, "summary" satisfies UsageKind);
        const usageError = usageErrorResponse(usage);
        if (usageError) return usageError;
        if (usage.status === "quota") {
          return err(429, "quota_exceeded", "Limite quotidienne de résumés atteinte.", { quotaExceeded: true, kind: "summary", limit: usage.limit, isPremium: usage.isPremium });
        }
        // Contexte compact : début de chaque paragraphe (jamais le cours intégral).
        const outline = paragraphs.map((p, i) => `${i + 1}. ${p.replace(/\s+/g, " ").slice(0, 220)}`).join("\n");
        const weak = (s.weak_notions ?? []).map((w) => sanitizeLabel(w, 100)).join(" | ");
        const prompt = `Cours : ${sanitizeLabel(course.title, 120)} · Matière : ${sanitizeLabel(course.subject, 80)}\n\n${wrapUntrustedData({ title: "Plan du cours (début de chaque paragraphe)", content: outline })}\n\nNotions à revoir : ${weak || "aucune"}\n\nProduis la synthèse.`;
        const r = await runGemini(ownerId, "tutor-final", prompt, FINAL_SYSTEM, lang, { json: true, maxOutputTokens: 1800 });
        const fin = r.ok ? parseFinal(r.text) : null;
        if (!r.ok || !fin) {
          console.error("[tutor] finish : échec :", r.ok ? "réponse illisible" : r.detail);
          await releaseUsage(ownerId, usage.usageId); // échec technique → l'essai est rendu
          return AI_DOWN();
        }
        const result = {
          summary: normalizeMathNotation(fin.summary),
          keyNotions: fin.keyNotions.map(normalizeMathNotation),
          quiz: fin.quiz.map((q) => ({ question: normalizeMathNotation(q.question), answer: normalizeMathNotation(q.answer) })),
          weakNotions: s.weak_notions ?? [],
        };
        await touch(s.id, { final_result: result, summary_used: true, turns: s.turns + 1 });
        return NextResponse.json({ final: result, cached: false });
      }

      return err(400, "invalid_request", "Action inconnue.");
    } finally {
      inFlight.delete(s.id);
    }
  } catch (e) {
    console.error("[tutor] erreur inattendue :", e instanceof Error ? e.message : e);
    return err(500, "server_error", "Une erreur est survenue.");
  }
}
