// Contrat commun des prestataires de paiement : MTN MoMo (direct), Orange Money (direct), PayPal (PayPal + cartes Visa / Mastercard).
// SERVEUR UNIQUEMENT. Chaque prestataire traduit sa propre API vers ces formes :
// le reste de l'application (initiation, webhooks, vérification, cron) ne connaît
// que ce contrat.

import type { PaymentMethodId, ProviderId } from "../../payment-methods";

/** Résultat NORMALISÉ d'une vérification faite auprès du prestataire. */
export type ProviderOutcome = "success" | "failed" | "cancelled" | "expired" | "pending";

export type ProviderCheck = {
  outcome: ProviderOutcome;
  /** Montant réellement encaissé selon le prestataire (null s'il ne le renvoie pas). */
  amount: number | null;
  currency: string | null;
  /** Identifiant de la transaction côté opérateur (preuve, support). */
  providerTxnId: string | null;
  reason: string | null;
  /** Notre référence telle que le prestataire la renvoie (si elle l'est) : doit être identique. */
  echoRef: string | null;
  /** Identifiant utilisateur renvoyé par le prestataire (si renvoyé) : doit être identique. */
  userRef: string | null;
  extraMeta?: Record<string, unknown>;
};

export type ProviderPaymentContext = {
  /** provider_ref : référence unique créée par NOTRE serveur avant le paiement. */
  ref: string;
  amount: number;
  currency: string;
  description: string;
  userId: string;
  customerName: string;
  customerEmail: string | null;
  /** Numéro mobile (9 chiffres), uniquement pour les moyens qui le demandent (MTN). */
  phone: string | null;
  /** Pays du paiement (ISO 3166-1 alpha-2) : choisit les identifiants opérateur et la devise. */
  country: string;
  /** Moyen choisi (ex. « card » ouvre le formulaire carte de PayPal, « paypal » la connexion au compte). */
  method: PaymentMethodId;
  urls: { notify: string; return: string; cancel: string };
};

export type InitResult =
  | { ok: true; flow: "redirect"; url: string; meta?: Record<string, unknown> }
  | { ok: true; flow: "push"; meta?: Record<string, unknown> }
  | { ok: false; error: string; code?: "payment_unavailable" | "invalid_amount" };

export type PaymentForCheck = {
  provider_ref: string;
  amount: number;
  currency: string | null;
  meta: Record<string, unknown> | null;
};

export interface PaymentProvider {
  id: ProviderId;
  /**
   * Renouvellement automatique : true UNIQUEMENT si le prestataire l'offre officiellement
   * (prélèvement récurrent / tokenisation) ET qu'il est implémenté ici (voir recurring.ts).
   * Jamais simulé : sinon le renouvellement reste manuel.
   */
  capabilities: { autoRenew: boolean };
  /** Devise attendue par le prestataire (ex. XAF). */
  currency(country?: string): string;
  /** Durée de validité d'un paiement en attente (minutes). */
  pendingTtlMinutes: number;
  isConfigured(country?: string): boolean;
  /** Message affiché quand le prestataire n'est pas configuré. */
  unavailableMessage: string;
  newReference(): string;
  initiate(ctx: ProviderPaymentContext): Promise<InitResult>;
  /** Interroge le prestataire. LÈVE une erreur s'il est injoignable (→ réessai ultérieur). */
  check(payment: PaymentForCheck): Promise<ProviderCheck>;
}

/** Prestataire qui sait réellement prélever un client ayant accepté un renouvellement automatique. */
export interface RecurringCapableProvider extends PaymentProvider {
  capabilities: { autoRenew: true };
  chargeRecurring(args: {
    mandateRef: string;
    ref: string;
    amount: number;
    currency: string;
    description: string;
    userId: string;
  }): Promise<{ ok: true } | { ok: false; error: string; permanent?: boolean }>;
}

export function supportsAutoRenew(p: PaymentProvider): p is RecurringCapableProvider {
  return p.capabilities.autoRenew === true && typeof (p as Partial<RecurringCapableProvider>).chargeRecurring === "function";
}
