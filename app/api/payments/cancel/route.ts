import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { cancelPendingPayment } from "@/lib/billing/cancel";
import { toPaymentView } from "@/lib/payments-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Annule un paiement EN ATTENTE de l'utilisateur (jamais un paiement déjà confirmé). */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  let ref = "";
  try {
    const body = (await req.json()) as { ref?: unknown };
    ref = typeof body.ref === "string" ? body.ref.trim() : "";
  } catch {
    /* corps absent */
  }
  if (!ref) return NextResponse.json({ error: "Référence manquante." }, { status: 400 });

  const result = await cancelPendingPayment(ref, { userId });
  if (result.kind === "not_found" || !result.payment) {
    return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
  }
  const payment = toPaymentView(result.payment);
  if (result.kind === "already_paid") {
    return NextResponse.json(
      { error: "Ce paiement est déjà confirmé : il ne peut plus être annulé.", code: "already_paid", payment },
      { status: 409 }
    );
  }
  return NextResponse.json({ payment });
}
