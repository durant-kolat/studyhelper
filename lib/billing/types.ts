// Types partagés (serveur + navigateur) de la facturation Premium.
// Ne contient AUCUN champ sensible : ce sont exactement les formes renvoyées
// par les routes /api/payments/* et /api/premium/*.

import type { PremiumBaseStatus, SubscriptionStatus, Term } from "../premium";
import type { PaymentMethodId, ProviderId } from "../payment-methods";

/** Statuts d'une transaction. */
export type PaymentStatus = "pending" | "success" | "failed" | "cancelled" | "expired";

export const FINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = ["success", "failed", "cancelled", "expired"];

export type PaymentView = {
  /** Référence de transaction Study Helper (unique, créée côté serveur AVANT le paiement). */
  ref: string;
  type: "premium" | "tutoring" | "group_access" | string;
  status: PaymentStatus;
  provider: string | null;
  method: string | null;
  methodLabel: string;
  plan: string | null;
  durationDays: number | null;
  /** Montant demandé (fixé par le serveur). */
  amount: number;
  /** Montant réellement payé, confirmé par le prestataire (null tant que non confirmé). */
  paidAmount: number | null;
  currency: string;
  createdAt: string;
  /** Date de confirmation du paiement (activation). */
  paidAt: string | null;
  /** Fin de validité d'un paiement en attente. */
  expiresAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** true = ce paiement a PROLONGÉ un Premium encore actif. */
  renewal: boolean;
  /** Identifiant de transaction côté prestataire (opérateur). */
  providerTxnId: string | null;
  failureReason: string | null;
  /** Numéro masqué auquel la demande MTN a été envoyée (ex. « 6•• ••• •56 »). */
  payerMasked: string | null;
  /** Le flux : push (confirmation sur le téléphone) ou redirect (page du prestataire). */
  flow: "push" | "redirect" | null;
};

export type PremiumSummary = {
  /** Statut d'abonnement : active · expiring_soon · expired · none · pending · failed · cancelled. */
  status: SubscriptionStatus;
  /** Statut d'après les seules dates (sans tenir compte d'une tentative de paiement récente). */
  baseStatus: PremiumBaseStatus;
  isActive: boolean;
  isUnlimited: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  plan: Term | null;
};

export type PlanOffer = {
  id: Term;
  label: string;
  price: number;
  durationDays: number;
  currency: string;
};

export type PremiumOverview = {
  now: string;
  accountType: string;
  subscription: PremiumSummary;
  /** Paiement Premium en attente de confirmation (non expiré), s'il y en a un. */
  pendingPayment: PaymentView | null;
  plans: PlanOffer[];
  /** Jours avant expiration où une notification est envoyée. */
  reminderDays: number[];
  autoRenew: {
    /** Au moins un moyen de paiement proposé supporte officiellement le renouvellement automatique. */
    available: boolean;
    enabled: boolean;
    method: string | null;
    nextAttemptAt: string | null;
  };
  /** Dernières transactions Premium (réussies ou non), les plus récentes d'abord. */
  history: PaymentView[];
};

export type StartPaymentResult = {
  ref: string;
  flow: "push" | "redirect";
  /** Adresse de la page de paiement du prestataire (flux « redirect » uniquement). */
  paymentUrl: string | null;
  provider: ProviderId;
  method: PaymentMethodId;
  amount: number;
  durationDays: number | null;
  expiresAt: string | null;
};

export type VerifyResult = {
  payment: PaymentView;
  premium: PremiumSummary | null;
};
