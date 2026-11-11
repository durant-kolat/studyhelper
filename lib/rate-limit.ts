import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";

import { FREE_LIMITS, PREMIUM_LIMITS, type UsageKind } from "./quota-limits";
import { freeLimit, premiumLimit } from "./quota-config";
import { budgetExceededResponse, checkAiBudget } from "./ai-cost";
import type { BudgetDecision } from "./tutor/budget";

// Les limites vivent dans lib/quota-limits.ts (partagées avec l'affichage du navigateur).
export { FREE_LIMITS, PREMIUM_LIMITS };
export type { UsageKind };

/**
 * Résultat d'une vérification de quota. Trois cas DISTINCTS — c'est
 * le point clé : une panne de la vérification elle-même ("error") ne doit
 * JAMAIS être présentée à l'utilisateur comme « limite atteinte », ni
 * déclencher une demande de passer Premium.
 *
 *  - "ok"    : la question est autorisée ET déjà comptabilisée (usageId
 *              sert à la rembourser si l'appel IA échoue ensuite).
 *  - "quota" : la limite du jour est réellement atteinte.
 *  - "error" : impossible de vérifier (fonction SQL absente, base
 *              injoignable…). Refus par prudence, mais message neutre.
 */
export type UsageCheck =
  | {
      status: "ok";
      allowed: true;
      isPremium: boolean;
      limit: number;
      used: number;
      remaining: number;
      usageId: string | null;
    }
  | {
      status: "quota";
      allowed: false;
      isPremium: boolean;
      limit: number;
      used: number;
      remaining: 0;
      usageId: null;
    }
  | {
      // Budget de TOKENS (consommation réelle, toutes fonctions IA confondues) épuisé : la séance a été remboursée.
      status: "budget";
      allowed: false;
      isPremium: boolean;
      limit: number;
      used: number;
      remaining: 0;
      usageId: null;
      budget: BudgetDecision;
    }
  | {
      status: "error";
      allowed: false;
      isPremium: false;
      limit: 0;
      used: 0;
      remaining: 0;
      usageId: null;
    };

/**
 * Limite du jour lue dans la ligne renvoyée par la base. Si la fonction SQL de la base réelle ne renvoie pas
 * `usage_limit` (ancienne migration, colonne renommée), `Number(undefined)` valait NaN → « null » une fois
 * sérialisé en JSON (« 3 / null utilisées · null restante »). On retombe alors sur les limites de
 * lib/quota-limits.ts, qui sont de toute façon celles envoyées à la fonction SQL.
 */
function limitFromRow(row: { usage_limit?: unknown }, kind: UsageKind, isPremium: boolean): number {
  const n = Number(row.usage_limit);
  if (row.usage_limit !== null && row.usage_limit !== undefined && Number.isFinite(n)) return n;
  console.warn(`[quota] usage_limit absent de la réponse SQL (${kind}) : limites par défaut utilisées. Migration V1.3 appliquée ?`);
  return isPremium ? premiumLimit(kind) : freeLimit(kind);
}

/**
 * Vérifie la limite du jour (jour LOCAL de l'utilisateur, selon son
 * fuseau — voir migration V1.3) et journalise l'usage en un seul appel
 * RPC atomique. Le compteur est décidé ici, côté serveur : le
 * navigateur n'a aucun moyen de le contourner ni de l'influencer.
 */
export async function checkAndLogUsage(
  ownerId: string,
  kind: UsageKind
): Promise<UsageCheck> {
  const { data, error } = await supabaseAdmin.rpc("check_and_log_usage", {
    p_owner_id: ownerId,
    p_action: kind,
    p_free_limit: freeLimit(kind),
    p_premium_limit: premiumLimit(kind),
  });

  if (error || !data || data.length === 0) {
    console.error(
      `[quota] check_and_log_usage a échoué (${kind}) :`,
      error?.message ?? "aucune ligne renvoyée — migration V1.3 appliquée ?"
    );
    return {
      status: "error",
      allowed: false,
      isPremium: false,
      limit: 0,
      used: 0,
      remaining: 0,
      usageId: null,
    };
  }

  const row = data[0];
  const isPremium = Boolean(row.is_premium);
  const limit = limitFromRow(row, kind, isPremium);

  if (!row.allowed) {
    return {
      status: "quota",
      allowed: false,
      isPremium,
      limit,
      used: Number.isFinite(Number(row.used)) && row.used != null ? Number(row.used) : limit,
      remaining: 0,
      usageId: null,
    };
  }

  const used = Number.isFinite(Number(row.used)) ? Number(row.used) : 0;
  const usageId = (row.usage_id as string | null) ?? null;

  // Garde-fou central (toutes les fonctions IA) : budget de tokens par jour / par mois, selon Gratuit ou Premium.
  // Désactivable avec AI_BUDGET_GLOBAL=off. Lecture impossible → on autorise (le quota de séances reste la barrière).
  if (process.env.AI_BUDGET_GLOBAL !== "off") {
    const budget = await checkAiBudget(ownerId);
    if (!budget.allowed) {
      await releaseUsage(ownerId, usageId); // pas de double débit : la séance n'a pas eu lieu
      return { status: "budget", allowed: false, isPremium, limit, used, remaining: 0, usageId: null, budget };
    }
  }

  return {
    status: "ok",
    allowed: true,
    isPremium,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    usageId,
  };
}

/**
 * Lecture seule : où en est l'utilisateur aujourd'hui ? Ne consomme rien.
 * Renvoie null si la lecture est impossible (l'appelant n'affiche alors
 * simplement pas de compteur — l'assistant reste utilisable).
 */
export async function getUsageStatus(ownerId: string, kind: UsageKind) {
  const { data, error } = await supabaseAdmin.rpc("get_usage_status", {
    p_owner_id: ownerId,
    p_action: kind,
    p_free_limit: freeLimit(kind),
    p_premium_limit: premiumLimit(kind),
  });

  if (error || !data || data.length === 0) {
    console.error(
      `[quota] get_usage_status a échoué (${kind}) :`,
      error?.message ?? "aucune ligne renvoyée"
    );
    return null;
  }

  const row = data[0];
  const isPremium = Boolean(row.is_premium);
  const limit = limitFromRow(row, kind, isPremium);
  const used = Number.isFinite(Number(row.used)) ? Number(row.used) : 0;
  return {
    isPremium,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Rembourse une question comptabilisée mais jamais traitée (échec de
 * l'API IA, réponse illisible, erreur serveur…). Silencieux en cas
 * d'échec : au pire l'utilisateur perd une question, jamais l'inverse.
 */
export async function releaseUsage(
  ownerId: string,
  usageId: string | null | undefined
) {
  if (!usageId) return;
  const { error } = await supabaseAdmin.rpc("release_usage", {
    p_owner_id: ownerId,
    p_usage_id: usageId,
  });
  if (error) {
    console.error("[quota] release_usage a échoué :", error.message);
  }
}

/**
 * À appeler juste après checkAndLogUsage : si la vérification elle-même
 * est tombée en panne, renvoie une réponse 503 NEUTRE (sans mention de
 * Premium ni de « limite atteinte ») ; sinon renvoie null.
 */
export function usageErrorResponse(usage: UsageCheck) {
  if (usage.status === "budget") return budgetExceededResponse(usage.budget);
  if (usage.status !== "error") return null;
  return NextResponse.json(
    {
      error:
        "Le compteur de questions est momentanément indisponible. Réessaie dans un instant — cette tentative n'est pas comptée.",
      code: "quota_unavailable",
    },
    { status: 503 }
  );
}
