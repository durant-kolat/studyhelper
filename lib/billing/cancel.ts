// Annulation d'un paiement en attente. SERVEUR UNIQUEMENT.
// On re-vérifie TOUJOURS auprès du prestataire avant d'annuler : si le client a
// finalement confirmé chez l'opérateur, le paiement est activé, pas annulé.
// Annuler localement ne peut pas retirer une demande déjà envoyée sur le téléphone du
// client : si elle est confirmée plus tard, la vérification serveur l'activera quand même
// (aucun argent encaissé n'est perdu).

import { findPaymentByRef, markPaymentStatus, type PaymentRow } from "../payments-server";
import { settlePayment } from "./settle";

export type CancelResult =
  | { kind: "cancelled" | "unchanged" | "already_paid"; payment: PaymentRow | null }
  | { kind: "not_found"; payment: null };

export async function cancelPendingPayment(ref: string, opts: { userId?: string } = {}): Promise<CancelResult> {
  const settled = await settlePayment(ref, opts);
  if (settled.kind === "not_found" || !settled.payment) return { kind: "not_found", payment: null };
  if (settled.kind === "success" || settled.kind === "already_success") {
    return { kind: "already_paid", payment: settled.payment };
  }
  if (settled.payment.status !== "pending") return { kind: "unchanged", payment: settled.payment };

  await markPaymentStatus(settled.payment.id, "cancelled", "user_cancelled");
  const { payment } = await findPaymentByRef(ref);
  return { kind: "cancelled", payment: payment ?? settled.payment };
}
