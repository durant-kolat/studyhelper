// Budget de consommation IA par utilisateur et par période — logique PURE, sans dépendance.
// Distinct du nombre de séances (quotas) : ici on borne la consommation réelle (tokens) renvoyée par l'API.
//
// Valeurs par défaut = RECOMMANDATIONS DE DÉPART, pas des décisions commerciales : elles sont réglables par
// variables d'environnement, `0` désactive le plafond de la période. À ajuster avec les mesures réelles de
// la table ai_cost_log. Aucun plafond MONÉTAIRE n'est imposé : le coût n'est estimé que si les tarifs
// (GEMINI_PRICE_INPUT_PER_MTOK / GEMINI_PRICE_OUTPUT_PER_MTOK, en devise de ton choix) sont renseignés.

export type BudgetConfig = {
  dailyFree: number;
  dailyPremium: number;
  monthlyFree: number;
  monthlyPremium: number;
};

export const DEFAULT_BUDGET: BudgetConfig = {
  dailyFree: 80_000,
  dailyPremium: 600_000,
  monthlyFree: 800_000,
  monthlyPremium: 8_000_000,
};

type Env = Record<string, string | undefined>;

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function readBudgetConfig(env: Env = process.env): BudgetConfig {
  return {
    dailyFree: num(env.AI_TOKEN_BUDGET_DAILY_FREE, DEFAULT_BUDGET.dailyFree),
    dailyPremium: num(env.AI_TOKEN_BUDGET_DAILY_PREMIUM, DEFAULT_BUDGET.dailyPremium),
    monthlyFree: num(env.AI_TOKEN_BUDGET_MONTHLY_FREE, DEFAULT_BUDGET.monthlyFree),
    monthlyPremium: num(env.AI_TOKEN_BUDGET_MONTHLY_PREMIUM, DEFAULT_BUDGET.monthlyPremium),
  };
}

export type BudgetUsage = { dayTokens: number; monthTokens: number };
export type BudgetDecision = {
  allowed: boolean;
  /** Période qui a bloqué (si allowed = false). */
  period?: "day" | "month";
  dayLimit: number;
  monthLimit: number;
};

export function evaluateBudget(cfg: BudgetConfig, isPremium: boolean, used: BudgetUsage): BudgetDecision {
  const dayLimit = isPremium ? cfg.dailyPremium : cfg.dailyFree;
  const monthLimit = isPremium ? cfg.monthlyPremium : cfg.monthlyFree;
  if (dayLimit > 0 && used.dayTokens >= dayLimit) return { allowed: false, period: "day", dayLimit, monthLimit };
  if (monthLimit > 0 && used.monthTokens >= monthLimit) return { allowed: false, period: "month", dayLimit, monthLimit };
  return { allowed: true, dayLimit, monthLimit };
}

/** Coût estimé d'un appel, ou null si les tarifs ne sont pas configurés (jamais de prix inventé). */
export function estimateCost(
  usage: { promptTokens: number; outputTokens: number },
  env: Env = process.env
): number | null {
  const pin = Number(env.GEMINI_PRICE_INPUT_PER_MTOK);
  const pout = Number(env.GEMINI_PRICE_OUTPUT_PER_MTOK);
  if (!env.GEMINI_PRICE_INPUT_PER_MTOK || !env.GEMINI_PRICE_OUTPUT_PER_MTOK) return null;
  if (!Number.isFinite(pin) || !Number.isFinite(pout) || pin < 0 || pout < 0) return null;
  return (usage.promptTokens * pin + usage.outputTokens * pout) / 1_000_000;
}
