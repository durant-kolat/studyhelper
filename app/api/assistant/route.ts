import { PEDAGOGICAL_MISSION } from "@/lib/ai/pedagogical-mission";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import {
  checkAndLogUsage,
  getUsageStatus,
  releaseUsage,
  usageErrorResponse,
} from "@/lib/rate-limit";
import { hasGeminiKey } from "@/lib/gemini";
import { hasGemini2Key } from "@/lib/ai/gemini2";
import { routeAi } from "@/lib/ai/router";
import { runAi } from "@/lib/ai/run";
import { appKnowledgeBlock, shouldInjectAppKnowledge } from "@/lib/ai/app-knowledge";
import { resolveLanguage } from "@/lib/ai/language";
import { buildUserTurnWithContext } from "@/lib/study-helper-rules";
import { normalizeMathNotation } from "@/lib/math-normalize";
import { assistantPayloadSchema, parseOrError } from "@/lib/validate";
import { buildLearnerContext } from "@/lib/learner-context";
import {
  SYSTEM_PROMPT,
  buildContextBlock,
  buildUserTurn,
  difficultyLine,
  extractEvaluation,
  CourseForPrompt,
  ResultRow,
} from "@/lib/assistant-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET — état du compteur du jour, SANS rien consommer. C'est ce que
 * l'interface affiche (« Questions restantes aujourd'hui : 8/10 ») : la
 * valeur vient du serveur, jamais d'un calcul du navigateur.
 * Si la lecture est impossible, `usage` vaut null et l'assistant reste
 * parfaitement utilisable (simplement sans compteur).
 */
export async function GET(req: NextRequest) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }
  const usage = await getUsageStatus(ownerId, "assistant");
  return NextResponse.json({ usage });
}

export async function POST(req: NextRequest) {
  if (!hasGeminiKey()) {
    console.error("[assistant] GEMINI_API_KEY absente côté serveur.");
    return NextResponse.json(
      {
        error: "Le service IA n'est pas encore configuré. Réessaie plus tard.",
        code: "not_configured",
      },
      { status: 500 }
    );
  }

  // L'id de l'utilisateur vient UNIQUEMENT du jeton de session vérifié —
  // jamais du corps de la requête.
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const parsed = parseOrError(assistantPayloadSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { message, history, mode, difficulty, subject, chapter, courseId, count, language } =
    parsed.data;

  // Cours sélectionné : vérifié AVANT de toucher au quota, pour qu'une
  // requête invalide ne consomme jamais une question.
  let selectedCourse: CourseForPrompt | null = null;
  if (courseId) {
    // content_text (texte original) vient de la migration v1.7 : si elle n'est
    // pas encore passée, on relit sans cette colonne plutôt que d'échouer.
    let { data: course, error: courseError } = await supabaseAdmin
      .from("courses")
      .select("id, owner_id, title, subject, summary, key_notions, questions, content_text")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) {
      ({ data: course } = await supabaseAdmin
        .from("courses")
        .select("id, owner_id, title, subject, summary, key_notions, questions")
        .eq("id", courseId)
        .maybeSingle());
    }

    if (!course || course.owner_id !== ownerId) {
      return NextResponse.json(
        { error: "Cours introuvable.", code: "course_not_found" },
        { status: 404 }
      );
    }
    selectedCourse = {
      id: course.id,
      title: course.title,
      subject: course.subject,
      summary: course.summary,
      key_points: (course.key_notions as string[] | null) ?? [],
      questions:
        (course.questions as { question: string; answer: string }[] | null) ?? [],
      content: (course as { content_text?: string | null }).content_text ?? null,
    };
  }

  // Quota — décidé ici, côté serveur (jour local de l'utilisateur).
  const usage = await checkAndLogUsage(ownerId, "assistant");

  const usageError = usageErrorResponse(usage);
  if (usageError) return usageError;

  if (usage.status === "quota") {
    return NextResponse.json(
      {
        error: usage.isPremium
          ? `Ta limite quotidienne (${usage.limit} questions) est atteinte. Elle sera renouvelée demain.`
          : "Ta limite gratuite quotidienne est atteinte. Tu pourras continuer lorsque ton quota sera renouvelé ou utiliser les fonctionnalités Premium disponibles.",
        code: "quota_exceeded",
        quotaExceeded: true,
        usage: {
          isPremium: usage.isPremium,
          limit: usage.limit,
          used: usage.used,
          remaining: 0,
        },
      },
      { status: 429 }
    );
  }

  // À partir d'ici la question est comptabilisée : toute panne technique
  // doit la REMBOURSER (releaseUsage) avant de répondre.
  try {
    const [profileRes, resultsRes, coursesRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("account_type")
        .eq("id", ownerId)
        .maybeSingle(),
      supabaseAdmin
        .from("exam_results")
        .select("subject, score_percent")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("courses")
        .select("id, title, subject, summary, key_notions")
        .eq("owner_id", ownerId)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    // Un échec de lecture du contexte n'est pas bloquant : l'assistant
    // répond alors sans personnalisation (et le dit, cf. prompt) plutôt
    // que de tomber en panne.
    if (profileRes.error || resultsRes.error || coursesRes.error) {
      console.error(
        "[assistant] contexte partiel :",
        profileRes.error?.message ??
          resultsRes.error?.message ??
          coursesRes.error?.message
      );
    }

    const contextBlock = buildContextBlock({
      accountType: (profileRes.data?.account_type as string | null) ?? null,
      results: (resultsRes.data as ResultRow[] | null) ?? [],
      courses: (
        (coursesRes.data ?? []) as (Omit<CourseForPrompt, "key_points"> & {
          key_notions: string[] | null;
        })[]
      ).map((c) => ({
        ...c,
        key_points: (c.key_notions as string[] | null) ?? [],
      })),
      selectedCourse,
    });

    // Séparation stricte (cahier des charges §8) :
    //   SYSTEM INSTRUCTIONS  = SYSTEM_PROMPT + difficulté (texte du serveur uniquement)
    //   STUDY HELPER RULES   = ajoutées par callGemini() à CHAQUE appel
    //   COURSE/DOCUMENT CONTEXT = données non fiables, dans le message utilisateur
    //   USER QUESTION        = la demande, juste après
    // Le contenu des cours n'entre donc JAMAIS dans les instructions système.
    // Langue : celle actuellement sélectionnée dans l'application (prioritaire sur la langue de la question,
    // du cours ou de l'historique) ; les deux Gemini y répondent toujours.
    const lang = await resolveLanguage(req, ownerId, language);

    // ROUTEUR IA : pratique → Gemini n°2 ; fonctions existantes → Gemini n°1 ; les deux si la demande l'exige.
    const decision = routeAi({ mode, message }, hasGemini2Key());
    // Questions sur l'application : on injecte la vraie base de connaissances (aucune fonction inventée).
    const appHelp = decision.domain === "app_help" || shouldInjectAppKnowledge(message);
    // Personnalisation contrôlée par l'élève (désactivable) : profil renseigné + difficultés mesurées sur ses vrais résultats.
    const learnerBlock = await buildLearnerContext(ownerId);
    const systemInstruction = `${SYSTEM_PROMPT}\n\n${PEDAGOGICAL_MISSION}\n\n${difficultyLine(difficulty)}${learnerBlock ? `\n\n${learnerBlock}` : ""}${appHelp ? `\n\n${appKnowledgeBlock(lang)}` : ""}`;

    const request = buildUserTurn({
      mode,
      message,
      difficulty,
      subject,
      chapter,
      count,
      hasSelectedCourse: selectedCourse !== null,
    });
    const userTurn = buildUserTurnWithContext(
      [{ title: "Profil, résultats et cours de l'utilisateur", content: contextBlock }],
      request
    );

    const result = await runAi({
      engine: decision.engine,
      prompt: userTurn,
      systemInstruction,
      history: history.slice(-12),
      lang,
      temperature: 0.6,
      meter: { ownerId, feature: "assistant" },
    });

    if (!result.ok) {
      console.error("[assistant] échec IA :", result.detail);
      await releaseUsage(ownerId, usage.usageId);
      return NextResponse.json(
        {
          error:
            "L'assistant IA est momentanément indisponible. Ta question n'a pas été comptée — réessaie dans un instant.",
          code: "ai_unavailable",
        },
        { status: 502 }
      );
    }

    const extracted = extractEvaluation(result.text);
    const evaluation = extracted.evaluation;
    // Notation lisible (sqrt(2) / \\sqrt{2} → √2), blocs de code intacts.
    const text = normalizeMathNotation(extracted.text);
    if (!text) {
      await releaseUsage(ownerId, usage.usageId);
      return NextResponse.json(
        {
          error:
            "L'assistant n'a pas pu générer de réponse. Ta question n'a pas été comptée — reformule ou réessaie.",
          code: "ai_unavailable",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      reply: text,
      evaluation,
      engine: result.engineUsed,
      language: lang,
      usage: {
        isPremium: usage.isPremium,
        limit: usage.limit,
        used: usage.used,
        remaining: usage.remaining,
      },
    });
  } catch (err) {
    console.error("[assistant] erreur inattendue :", err);
    await releaseUsage(ownerId, usage.usageId);
    return NextResponse.json(
      {
        error:
          "Une erreur est survenue. Ta question n'a pas été comptée — réessaie dans un instant.",
        code: "server_error",
      },
      { status: 500 }
    );
  }
}
