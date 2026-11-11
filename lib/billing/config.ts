// Configuration serveur de la facturation Premium : plans, durées, URL publique.
// SERVEUR UNIQUEMENT. Les montants et durées vendus viennent TOUJOURS d'ici,
// jamais du navigateur.

import { DEFAULT_PLAN_DAYS, PREMIUM_PRICES, TERMS, planTitle, type Term } from "../premium";
import type { PlanOffer } from "./types";

/** Devise de facturation (FCFA CEMAC). */
export const BILLING_CURRENCY = "XAF";

/**
 * Durée d'un plan en jours. Configurable : PREMIUM_DAYS_MENSUEL, PREMIUM_DAYS_TRIMESTRIEL,
 * PREMIUM_DAYS_ANNUEL (entier entre 1 et 3660). Sinon valeurs par défaut (30 / 90 / 365).
 */
export function planDurationDays(term: Term): number {
  const raw = Number(process.env[`PREMIUM_DAYS_${term.toUpperCase()}`]);
  return Number.isInteger(raw) && raw >= 1 && raw <= 3660 ? raw : DEFAULT_PLAN_DAYS[term];
}

/** Offres Premium disponibles pour un type de compte (prix + durée, tels que le serveur les facturera). */
export function planOffersFor(accountType: string): PlanOffer[] {
  const prices = PREMIUM_PRICES[accountType] ?? {};
  const offers: PlanOffer[] = [];
  for (const term of TERMS) {
    const price = prices[term];
    if (!price) continue;
    const durationDays = planDurationDays(term);
    offers.push({ id: term, label: planTitle(durationDays), price, durationDays, currency: BILLING_CURRENCY });
  }
  return offers;
}

/** URL publique de l'application (https en production : les prestataires doivent la joindre). */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function appUrlIsPublicHttps(): boolean {
  return process.env.NODE_ENV !== "production" || appUrl().startsWith("https://");
}
