// Offre Premium : plans, durées, statut et dates — partagés entre le serveur
// (montant et durée réellement facturés, toujours recalculés côté serveur) et le
// navigateur (affichage). Ne contient aucun secret.
//
// Premium inclut l'accès aux groupes d'étude (aucun paiement séparé).

export type Term = "mensuel" | "trimestriel" | "annuel";

export const TERMS: readonly Term[] = ["mensuel", "trimestriel", "annuel"];

/**
 * Durée de validité de chaque plan, en JOURS. Valeurs par défaut : le serveur peut les
 * remplacer par les variables PREMIUM_DAYS_MENSUEL / _TRIMESTRIEL / _ANNUEL
 * (voir lib/billing/config.ts). La durée vendue est figée sur chaque paiement
 * (payments.duration_days) : changer la configuration n'affecte pas les paiements passés.
 */
export const DEFAULT_PLAN_DAYS: Record<Term, number> = {
  mensuel: 30,
  trimestriel: 90,
  annuel: 365,
};

/** @deprecated conservé pour compatibilité : l'activation se fait désormais en jours. */
export const TERM_MONTHS: Record<Term, number> = { mensuel: 1, trimestriel: 3, annuel: 12 };

const STANDARD: Partial<Record<Term, number>> = { mensuel: 2500, trimestriel: 7000, annuel: 29500 };

/** Tarifs (FCFA) par type de compte. `entreprise` : sur devis, pas d'auto-souscription. */
export const PREMIUM_PRICES: Record<string, Partial<Record<Term, number>>> = {
  eleve_primaire: STANDARD,
  eleve_secondaire: STANDARD,
  etudiant: STANDARD,
  formation_pro: STANDARD,
  enseignant: { mensuel: 3000 },
};

export function isTerm(value: unknown): value is Term {
  return typeof value === "string" && (TERMS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Tarifs dans d'AUTRES devises : jamais convertis automatiquement (un prix est une décision commerciale).
//   XAF et XOF (francs CFA) : même valeur (parité fixe avec l'euro) → mêmes montants que le tarif de base.
//   Autres devises (GHS, UGX, ZAR…) : tableau JSON NON secret NEXT_PUBLIC_PREMIUM_PRICES_JSON, lu par le serveur ET par l'interface :
//   {"GHS":{"standard":{"mensuel":25,"trimestriel":70,"annuel":280},"enseignant":{"mensuel":30}}}
//   Devise absente du tableau → le pays n'est pas payable (« tarif non défini »), jamais de prix inventé.
// ---------------------------------------------------------------------------
export type PriceTable = Record<string, { standard?: Partial<Record<Term, number>>; enseignant?: Partial<Record<Term, number>> }>;

const validPrices = (v: unknown): Partial<Record<Term, number>> | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const out: Partial<Record<Term, number>> = {};
  for (const term of TERMS) {
    const n = (v as Record<string, unknown>)[term];
    if (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 10_000_000) out[term] = n;
  }
  return Object.keys(out).length ? out : undefined;
};

export function parsePriceTable(raw: string | null | undefined): PriceTable {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const table: PriceTable = {};
    for (const [cur, v] of Object.entries(data ?? {})) {
      if (!/^[A-Z]{3}$/.test(cur) || !v || typeof v !== "object") continue;
      const standard = validPrices((v as Record<string, unknown>).standard);
      const enseignant = validPrices((v as Record<string, unknown>).enseignant);
      if (standard || enseignant) table[cur] = { ...(standard ? { standard } : {}), ...(enseignant ? { enseignant } : {}) };
    }
    return table;
  } catch {
    return {};
  }
}

const ENV_PRICE_TABLE = parsePriceTable(process.env.NEXT_PUBLIC_PREMIUM_PRICES_JSON);

/** Prix d'un plan dans une devise, ou null (devise non tarifée, plan inexistant pour ce profil). */
export function premiumPriceFor(accountType: string, term: unknown, currency: string, table: PriceTable = ENV_PRICE_TABLE): number | null {
  if (!isTerm(term) || !PREMIUM_PRICES[accountType]) return null;
  if (currency === "XAF" || currency === "XOF") return premiumPrice(accountType, term);
  const row = table[currency];
  return (accountType === "enseignant" ? row?.enseignant?.[term] : row?.standard?.[term]) ?? null;
}

/** Prix (FCFA) d'un plan pour un type de compte, ou null s'il n'existe pas. */
export function premiumPrice(accountType: string, term: unknown): number | null {
  if (!isTerm(term)) return null;
  return PREMIUM_PRICES[accountType]?.[term] ?? null;
}

/**
 * Premium ACTIF = statut « premium » ET date d'expiration absente ou future.
 * Même règle que la fonction SQL user_is_premium() : la vérité reste côté base.
 */
export function isPremiumActive(
  status: string | null | undefined,
  expiresAt: string | null | undefined
): boolean {
  if (status !== "premium") return false;
  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}

// ---------------------------------------------------------------------------
// Statut de l'abonnement
// ---------------------------------------------------------------------------

/** Nombre de jours avant l'expiration à partir duquel Premium est « expiring_soon ». */
export const EXPIRING_SOON_DAYS = 7;

/** Statuts calculés à partir des dates. */
export type PremiumBaseStatus = "active" | "expiring_soon" | "expired" | "none";

/**
 * Statuts d'abonnement affichables :
 *   active · expiring_soon · expired · none   (d'après les dates)
 *   pending · failed · cancelled              (d'après la dernière tentative de paiement,
 *                                              uniquement si Premium n'est pas actif)
 */
export type SubscriptionStatus = PremiumBaseStatus | "pending" | "failed" | "cancelled";

export type PremiumState = {
  status: PremiumBaseStatus;
  isActive: boolean;
  /** Premium accordé sans date de fin (ex. par un administrateur). */
  isUnlimited: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  /** Jours restants (arrondi au supérieur), null si pas actif ou sans expiration. */
  daysRemaining: number | null;
};

const DAY_MS = 86_400_000;

export function getPremiumState(
  input: { status?: string | null; expiresAt?: string | null; startedAt?: string | null },
  now: Date = new Date()
): PremiumState {
  const premiumFlag = input.status === "premium";
  const expiresMs = input.expiresAt ? new Date(input.expiresAt).getTime() : NaN;
  const hasExpiry = Number.isFinite(expiresMs);
  const nowMs = now.getTime();
  const base = { startedAt: input.startedAt ?? null, expiresAt: input.expiresAt ?? null };

  if (premiumFlag && !hasExpiry) {
    return { ...base, status: "active", isActive: true, isUnlimited: true, daysRemaining: null };
  }
  if (premiumFlag && hasExpiry && expiresMs > nowMs) {
    const daysRemaining = Math.max(1, Math.ceil((expiresMs - nowMs) / DAY_MS));
    return {
      ...base,
      status: daysRemaining <= EXPIRING_SOON_DAYS ? "expiring_soon" : "active",
      isActive: true,
      isUnlimited: false,
      daysRemaining,
    };
  }
  if (hasExpiry && expiresMs <= nowMs) {
    return { ...base, status: "expired", isActive: false, isUnlimited: false, daysRemaining: null };
  }
  return { ...base, status: "none", isActive: false, isUnlimited: false, daysRemaining: null };
}

/** « 12/11/2026 » (jour/mois/année) ou « — » si la date est absente. */
export function formatDateFr(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone });
}

/** Titre d'un plan : « Premium — 30 jours ». */
export function planTitle(days: number): string {
  return `Premium — ${days} jour${days > 1 ? "s" : ""}`;
}
