import { NextResponse } from "next/server";
import { settlePayment } from "@/lib/billing/settle";
import { safeRef } from "@/lib/billing/redirects";
import { clientIp, hitRateLimit } from "@/lib/http-rate-limit";
import { refFromPaypalEvent, verifyPaypalWebhook } from "@/lib/billing/providers/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notification PayPal. L'authenticité est vérifiée AUPRÈS de PayPal (signature + PAYPAL_WEBHOOK_ID) ; une notification non vérifiée
// est rejetée. Même vérifiée, elle ne sert que de DÉCLENCHEUR : settlePayment() interroge PayPal (et capture si le client a approuvé),
// compare montant / devise / utilisateur à NOTRE base, puis active via apply_payment_success() (atomique, idempotente).
export async function POST(req: Request) {
  const limited = hitRateLimit(`pay-notif:paypal:${clientIp(req)}`, 60, 60_000);
  if (!limited.ok) return NextResponse.json({ error: "Trop de requêtes." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } });

  const event = await req.json().catch(() => null);
  if (!event || !(await verifyPaypalWebhook(req.headers, event))) {
    return NextResponse.json({ error: "Notification non authentifiée." }, { status: 401 });
  }
  const raw = refFromPaypalEvent(event);
  const ref = raw ? safeRef(raw) : null;
  if (!ref) return NextResponse.json({ ok: true, ignored: "no_reference" }); // événement sans lien avec un paiement Study Helper

  const result = await settlePayment(ref);
  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ ok: true, ignored: "unknown_reference" });
    case "rejected":
      return NextResponse.json({ error: "Paiement non conforme." }, { status: 409 });
    case "error":
      return NextResponse.json({ error: "Erreur temporaire, réessai attendu." }, { status: 500 }); // PayPal renverra la notification
    default:
      return NextResponse.json({ ok: true, status: result.payment?.status ?? result.kind });
  }
}
