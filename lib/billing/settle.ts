// Règlement d'un paiement, quel que soit le prestataire : vérification AUPRÈS du
// prestataire, contrôle de cohérence, puis activation atomique et idempotente.
// Partagé par les webhooks, la page de retour (/api/payments/verify) et la tâche planifiée.
// SERVEUR UNIQUEMENT.
//
// Règles :
//  - le corps d'une notification ou une redirection ne prouve JAMAIS un paiement :
//    seule la réponse du prestataire à NOTRE interrogation compte ;
//  - le montant, la devise, l'utilisateur et la référence doivent concorder avec NOTRE base ;
//  - un paiement expiré/annulé reste revérifiable : si le client a finalement confirmé
//    chez l'opérateur, Premium est activé (aucun argent encaissé n'est perdu).

import type { ProviderCheck } from "./providers/types";
import { providerById } from "./providers";
import type { PaymentProvider } from "./providers/types";
import {
  applyPaymentSuccess,
  findPaymentByRef,
  isSettled,
  markPaymentStatus,
  rejectPayment,
  type PaymentRow,
} from "../payments-server";

export type SettleKind =
  | "success" // activé à l'instant
  | "already_success" // déjà activé auparavant
  | "pending"
  | "failed"
  | "cancelled"
  | "expired"
  | "rejected" // incohérence (montant, utilisateur…) : jamais activé
  | "unsupported" // ancien prestataire (CamPay, Lygos, Monetbil, CinetPay) : hors circuit, jamais activé ni modifié
  | "not_found"
  | "error"; // prestataire injoignable ou base indisponible : à réessayer

export type SettleResult = { kind: SettleKind; payment: PaymentRow | null };

async function reload(ref: string, fallback: PaymentRow): Promise<PaymentRow> {
  const { payment } = await findPaymentByRef(ref);
  return payment ?? fallback;
}

/**
 * `userId` (facultatif) : si fourni, le paiement doit lui appartenir — sinon « not_found ».
 * `getProvider` : résolution du prestataire (le registre par défaut ; injectable pour les tests
 * et le renouvellement automatique, qui doivent régler avec le même prestataire que l'initiation).
 */
export async function settlePayment(
  ref: string,
  opts: { userId?: string; now?: Date; getProvider?: (id: string | null | undefined) => PaymentProvider | null } = {}
): Promise<SettleResult> {
  const now = opts.now ?? new Date();
  const getProvider = opts.getProvider ?? providerById;
  const { payment, error } = await findPaymentByRef(ref);
  if (error) {
    console.error("[settle] lecture payments :", error);
    return { kind: "error", payment: null };
  }
  if (!payment || (opts.userId && payment.user_id !== opts.userId)) return { kind: "not_found", payment: null };
  if (isSettled(payment)) return { kind: "already_success", payment };

  const provider = getProvider(payment.provider);
  if (!provider) return { kind: "unsupported", payment };
  if (!provider.isConfigured()) {
    console.error(`[settle] prestataire ${provider.id} non configuré : vérification impossible.`);
    return { kind: "error", payment };
  }

  let check: ProviderCheck;
  try {
    check = await provider.check(payment);
  } catch (err) {
    console.error(`[settle] ${provider.id} injoignable :`, err instanceof Error ? err.message : err);
    return { kind: "error", payment };
  }

  // La référence renvoyée par le prestataire (si elle l'est) doit être la nôtre.
  if (check.echoRef !== null && check.echoRef !== payment.provider_ref) {
    await rejectPayment(payment, "ref_mismatch", { expected: payment.provider_ref, received: check.echoRef });
    return { kind: "rejected", payment: await reload(ref, payment) };
  }

  switch (check.outcome) {
    case "success": {
      const expectedCurrency = (payment.currency ?? "").toUpperCase();
      if (check.amount !== null && check.amount !== payment.amount) {
        await rejectPayment(payment, "amount_mismatch", { expected: payment.amount, received: check.amount });
        return { kind: "rejected", payment: await reload(ref, payment) };
      }
      if (check.currency !== null && expectedCurrency && check.currency.toUpperCase() !== expectedCurrency) {
        await rejectPayment(payment, "currency_mismatch", { expected: expectedCurrency, received: check.currency });
        return { kind: "rejected", payment: await reload(ref, payment) };
      }
      if (check.userRef !== null && check.userRef !== payment.user_id) {
        await rejectPayment(payment, "user_mismatch", { expected: payment.user_id, received: check.userRef });
        return { kind: "rejected", payment: await reload(ref, payment) };
      }

      const applied = await applyPaymentSuccess(payment.id, {
        meta: { ...(check.extraMeta ?? {}), amount_unreturned: check.amount === null ? true : undefined },
        paidAmount: check.amount ?? payment.amount,
        providerTxnId: check.providerTxnId,
      });
      if (!applied.ok) {
        console.error(`[settle] activation de ${ref} :`, applied.message);
        if (applied.replay) {
          await rejectPayment(payment, "transaction_reused", { providerTxnId: check.providerTxnId });
          return { kind: "rejected", payment: await reload(ref, payment) };
        }
        return { kind: "error", payment };
      }
      return { kind: applied.applied ? "success" : "already_success", payment: await reload(ref, payment) };
    }

    case "failed":
    case "cancelled":
    case "expired":
      await markPaymentStatus(payment.id, check.outcome, check.reason);
      return { kind: check.outcome, payment: await reload(ref, payment) };

    default: {
      // Toujours en attente chez le prestataire : on marque « expired » le paiement dont la
      // validité est dépassée (il reste revérifiable), sinon on attend.
      if (payment.status === "pending" && payment.expires_at && new Date(payment.expires_at).getTime() < now.getTime()) {
        await markPaymentStatus(payment.id, "expired", "timeout");
        return { kind: "expired", payment: await reload(ref, payment) };
      }
      return { kind: "pending", payment };
    }
  }
}
