// Suivi de la consommation Gemini + budget par utilisateur. SERVEUR UNIQUEMENT.
// La logique de décision est dans lib/tutor/budget.ts (pure, testée) ; ici : accès base.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";
import { geminiModel, type GeminiUsage } from "./gemini";
import { evaluateBudget, estimateCost, readBudgetConfig, type BudgetDecision } from "./tutor/budget";

/**
 * Vérifie le budget AVANT un appel coûteux. Si la lecture échoue (table absente, base injoignable), on
 * AUTORISE (fail-open) : une panne du suivi ne doit pas bloquer l'élève — le quota de séances reste la barrière.
 */
export async function checkAiBudget(ownerId: string): Promise<BudgetDecision & { checked: boolean }> {
  const cfg = readBudgetConfig();
  const { data, error } = await supabaseAdmin.rpc("ai_budget_usage", { p_owner_id: ownerId });
  if (error || !data || data.length === 0) {
    console.error("[ai-cost] ai_budget_usage indisponible (migration V2.3 appliquée ?) :", error?.message ?? "aucune ligne");
    return { allowed: true, dayLimit: 0, monthLimit: 0, checked: false };
  }
  const row = data[0] as { is_premium: boolean; day_tokens: number | string; month_tokens: number | string };
  const decision = evaluateBudget(cfg, Boolean(row.is_premium), {
    dayTokens: Number(row.day_tokens) || 0,
    monthTokens: Number(row.month_tokens) || 0,
  });
  return { ...decision, checked: true };
}

/** Enregistre un appel Gemini (jamais bloquant : une erreur d'écriture est seulement journalisée). */
export async function recordAiCost(
  ownerId: string,
  feature: string,
  usage: GeminiUsage | undefined,
  status: "ok" | "error",
  model?: string
): Promise<void> {
  try {
    const cost = usage ? estimateCost(usage) : null;
    const { error } = await supabaseAdmin.from("ai_cost_log").insert({
      owner_id: ownerId,
      feature,
      model: model ?? geminiModel(),
      prompt_tokens: usage?.promptTokens ?? null,
      output_tokens: usage?.outputTokens ?? null,
      total_tokens: usage?.totalTokens ?? null,
      est_cost: cost,
      status,
    });
    if (error) console.error("[ai-cost] écriture impossible :", error.message);
  } catch (err) {
    console.error("[ai-cost] écriture impossible :", err instanceof Error ? err.message : err);
  }
}

/** Réponse 429 claire : seules les NOUVELLES opérations IA sont bloquées ; documents et progression restent intacts. */
export function budgetExceededResponse(decision: BudgetDecision) {
  return NextResponse.json(
    {
      error:
        decision.period === "month"
          ? "Tu as atteint ta limite d'utilisation de l'IA pour ce mois. Tes documents et ta progression sont conservés ; tu pourras reprendre quand la limite sera renouvelée."
          : "Tu as atteint ta limite d'utilisation de l'IA pour aujourd'hui. Tes documents et ta progression sont conservés ; tu pourras reprendre demain.",
      code: "budget_exceeded",
      period: decision.period,
    },
    { status: 429 }
  );
}
