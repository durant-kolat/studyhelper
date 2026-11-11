import { NextRequest, NextResponse } from "next/server";
import {
  MONETBIL_CURRENCY,
  checkMonetbilPayment,
  evaluateNotification,
  isMonetbilConfigured,
  verifyMonetbilSignature,
} from "@/lib/monetbil";
import {
  completePayment,
  findPaymentByRef,
  isSettled,
  markPaymentFailed,
  readNotificationParams,
  rejectPayment,
} from "@/lib/payments-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Monetbil attend un 200 avec un corps « received » une fois la notification prise en compte.
const received = () => new Response("received", { status: 200 });

/**
 * Notification Monetbil (Widget v2.1) — HÉRITAGE.
 * Aucun NOUVEAU paiement ne passe plus par Monetbil depuis la V2.0 (MTN MoMo et Orange Money
 * utilisent les API officielles des opérateurs). Cette route reste uniquement pour confirmer
 * les paiements Monetbil créés AVANT la V2.0 et encore « pending ». À supprimer (avec
 * lib/monetbil.ts) dès qu'il n'en reste plus.
 * Aucune valeur de la requête n'est crue sur parole ; Premium (ou la réservation)
 * n'est activé qu'après, dans l'ordre :
 *   1. signature valide (Service Secret, serveur uniquement)
 *   2. transaction connue de NOTRE base (payment_ref) et pas déjà activée
 *   3. statut confirmé côté serveur par Monetbil (checkPayment)
 *   4. montant, devise, utilisateur et transaction concordants avec notre base
 *   5. activation ATOMIQUE et IDEMPOTENTE (fonction SQL apply_payment_success) :
 *      un même paiement ne peut jamais être activé deux fois.
 */
export async function POST(req: NextRequest) {
  if (!isMonetbilConfigured()) {
    console.error("[webhook] MONETBIL_SERVICE_KEY / MONETBIL_SERVICE_SECRET manquants.");
    return NextResponse.json({ error: "Paiement non configuré." }, { status: 503 });
  }

  // Monetbil envoie du form-urlencoded : on garde TOUS les champs tels quels,
  // car la signature couvre chacun d'eux.
  let params: Record<string, string>;
  try {
    params = await readNotificationParams(req);
  } catch {
    return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  }

  // 1) Signature
  if (!verifyMonetbilSignature(params)) {
    console.warn("[webhook] signature Monetbil invalide — notification ignorée.");
    return NextResponse.json({ error: "Signature invalide." }, { status: 403 });
  }

  const paymentRef = params.payment_ref;
  if (!paymentRef) return NextResponse.json({ error: "payment_ref manquant." }, { status: 400 });

  // 2) Paiement connu, et pas déjà activé ?
  const { payment, error: lookupError } = await findPaymentByRef(paymentRef);
  if (lookupError) {
    console.error("[webhook] lecture payments :", lookupError);
    return NextResponse.json({ error: "Erreur temporaire." }, { status: 500 });
  }
  if (!payment) return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
  if (payment.provider && payment.provider !== "monetbil") {
    // Une notification Monetbil ne peut pas régler un paiement CinetPay.
    return NextResponse.json({ error: "Paiement non conforme." }, { status: 409 });
  }
  if (isSettled(payment)) return received(); // idempotent

  // 3) Statut confirmé par Monetbil. Injoignable → 502 : Monetbil réessaiera plus tard.
  let check;
  try {
    check = await checkMonetbilPayment(params.transaction_id ?? "");
  } catch (err) {
    console.error("[webhook] checkPayment :", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Vérification indisponible." }, { status: 502 });
  }

  // 4) Montant / devise / utilisateur / transaction / statut
  const verdict = evaluateNotification(
    params,
    { amount: payment.amount, currency: payment.currency ?? MONETBIL_CURRENCY, userId: payment.user_id },
    check
  );

  if (verdict.kind === "pending") return received(); // statut intermédiaire : on attend le prochain appel

  if (verdict.kind === "failed") {
    await markPaymentFailed(payment.id);
    return received();
  }

  if (verdict.kind === "reject") {
    console.error(`[webhook] paiement ${paymentRef} refusé : ${verdict.reason}`, verdict.detail);
    await rejectPayment(payment, verdict.reason, verdict.detail);
    return NextResponse.json({ error: "Paiement non conforme." }, { status: 409 });
  }

  // 5) Activation atomique + idempotente (verrou de ligne, index unique anti-rejeu de la
  //    transaction Monetbil, `activated_at`). En cas d'échec rien n'est activé à moitié :
  //    on répond 500 et Monetbil rappellera le webhook.
  const result = await completePayment(payment.id, {
    monetbil_transaction_id: verdict.transactionId,
    monetbil_fee: params.fee ?? null,
    monetbil_operator: params.mobile_operator_name ?? params.operator ?? null,
  });
  if (!result.ok) {
    console.error(`[webhook] activation de ${paymentRef} :`, result.message);
    return NextResponse.json(
      { error: result.replay ? "Transaction déjà utilisée." : "Activation échouée, réessai attendu." },
      { status: result.replay ? 409 : 500 }
    );
  }

  return received();
}
