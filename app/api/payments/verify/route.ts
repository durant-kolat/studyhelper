import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { settlePayment } from "@/lib/billing/settle";
import { getPremiumOverview } from "@/lib/billing/premium-service";
import { toPaymentView } from "@/lib/payments-server";
import type { VerifyResult } from "@/lib/billing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Appelée par la page de retour (et la fiche de paiement) : interroge le prestataire CÔTÉ
 * SERVEUR et active Premium si — et seulement si — le paiement est confirmé. Le navigateur
 * ne dit jamais « c'est payé » : il demande une vérification, et reçoit l'état réel.
 * Tant que le paiement est en attente, rien n'est activé.
 */
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

  const result = await settlePayment(ref, { userId });
  if (result.kind === "not_found") return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
  if (!result.payment) return NextResponse.json({ error: "Erreur temporaire." }, { status: 500 });

  const payment = toPaymentView(result.payment);
  let premium: VerifyResult["premium"] = null;
  if (payment.type === "premium" && payment.status === "success") {
    premium = (await getPremiumOverview(userId))?.subscription ?? null;
  }
  // `temporary` : le prestataire n'a pas pu être joint ; on renverra l'état réel au prochain essai.
  return NextResponse.json({ payment, premium, temporary: result.kind === "error" } satisfies VerifyResult & { temporary: boolean });
}
