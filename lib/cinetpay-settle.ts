// Règlement d'un paiement CinetPay : vérification auprès de CinetPay, contrôle
// des montants, puis activation atomique et idempotente. Partagé par le webhook
// (notify_url) et par la vérification déclenchée au retour de l'utilisateur.
// SERVEUR UNIQUEMENT.

import { checkCinetPayTransaction, CINETPAY_CURRENCY, evaluateCinetPay } from "./cinetpay";
import {
  completePayment,
  findPaymentByRef,
  isSettled,
  markPaymentFailed,
  rejectPayment,
} from "./payments-server";

export type SettleResult =
  | { kind: "completed"; activated: boolean }
  | { kind: "already_completed" }
  | { kind: "failed" }
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "not_found" }
  | { kind: "error" };

/**
 * `userId` (facultatif) : quand la vérification est demandée par un utilisateur
 * connecté, le paiement doit lui appartenir — sinon « not_found ».
 */
export async function settleCinetPayPayment(
  transactionId: string,
  userId?: string
): Promise<SettleResult> {
  const { payment, error } = await findPaymentByRef(transactionId);
  if (error) {
    console.error("[cinetpay] lecture payments :", error);
    return { kind: "error" };
  }
  if (!payment || payment.provider !== "cinetpay") return { kind: "not_found" };
  if (userId && payment.user_id !== userId) return { kind: "not_found" };
  if (isSettled(payment)) return { kind: "already_completed" };

  // La vérité vient de CinetPay, jamais du corps de la notification.
  let check;
  try {
    check = await checkCinetPayTransaction(payment.provider_ref);
  } catch (err) {
    console.error("[cinetpay] vérification indisponible :", err instanceof Error ? err.message : err);
    return { kind: "error" };
  }

  const verdict = evaluateCinetPay(check, {
    amount: payment.amount,
    currency: payment.currency ?? CINETPAY_CURRENCY,
    userId: payment.user_id,
  });

  if (verdict.kind === "pending") return { kind: "pending" };
  if (verdict.kind === "failed") {
    await markPaymentFailed(payment.id);
    return { kind: "failed" };
  }
  if (verdict.kind === "reject") {
    console.error(`[cinetpay] paiement ${payment.provider_ref} refusé : ${verdict.reason}`, verdict.detail);
    await rejectPayment(payment, verdict.reason, verdict.detail);
    return { kind: "rejected" };
  }

  const result = await completePayment(payment.id, {
    cinetpay_operator_id: verdict.operatorId,
    cinetpay_payment_method: verdict.paymentMethod,
  });
  if (!result.ok) {
    console.error(`[cinetpay] activation de ${payment.provider_ref} :`, result.message);
    return result.replay ? { kind: "rejected" } : { kind: "error" };
  }
  return { kind: "completed", activated: result.activated };
}
