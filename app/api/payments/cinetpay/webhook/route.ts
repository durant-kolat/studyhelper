import { NextRequest, NextResponse } from "next/server";
import { settlePayment } from "@/lib/billing/settle";
import { isCinetPayConfigured, isOwnSiteId, verifyCinetPayToken } from "@/lib/cinetpay";
import { readNotificationParams } from "@/lib/payments-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CinetPay exige que cette URL réponde 200 aux requêtes GET (simple « ping » de disponibilité,
// aucune donnée n'est envoyée en GET) et aux requêtes POST.
export async function GET() {
  return new Response("ok", { status: 200 });
}

/**
 * Notification CinetPay (Mastercard). CinetPay n'envoie JAMAIS le statut en clair : la
 * notification ne sert que de déclencheur. On vérifie donc toujours auprès de CinetPay
 * (/v2/payment/check), puis montant / devise / utilisateur, avant l'activation atomique
 * et idempotente.
 *   1. jeton HMAC `x-token` (si CINETPAY_SECRET_KEY est définie)
 *   2. cpm_site_id = notre service ; cpm_trans_id = paiement connu de NOTRE base
 *   3. vérification serveur → CinetPay, puis comparaison avec NOTRE base
 */
export async function POST(req: NextRequest) {
  if (!isCinetPayConfigured()) {
    console.error("[cinetpay/webhook] CINETPAY_API_KEY / CINETPAY_SITE_ID manquants.");
    return NextResponse.json({ error: "Paiement non configuré." }, { status: 503 });
  }

  let params: Record<string, string>;
  try {
    params = await readNotificationParams(req);
  } catch {
    return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  }

  const token = verifyCinetPayToken(params, req.headers.get("x-token"));
  if (token === "invalid") {
    console.warn("[cinetpay/webhook] x-token invalide — notification ignorée.");
    return NextResponse.json({ error: "Jeton invalide." }, { status: 403 });
  }
  if (token === "skipped") {
    console.warn("[cinetpay/webhook] CINETPAY_SECRET_KEY absente : jeton HMAC non vérifié (la vérification serveur reste appliquée).");
  }

  if (!isOwnSiteId(params.cpm_site_id)) {
    return NextResponse.json({ error: "Service inconnu." }, { status: 403 });
  }
  const transactionId = params.cpm_trans_id;
  if (!transactionId) return NextResponse.json({ error: "cpm_trans_id manquant." }, { status: 400 });

  const result = await settlePayment(transactionId);
  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
    case "rejected":
      return NextResponse.json({ error: "Paiement non conforme." }, { status: 409 });
    case "error":
      // 5xx : CinetPay rappellera la notification, rien n'est perdu ni activé à moitié.
      return NextResponse.json({ error: "Erreur temporaire, réessai attendu." }, { status: 500 });
    default:
      return new Response("OK", { status: 200 });
  }
}
