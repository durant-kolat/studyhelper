import { NextRequest, NextResponse } from "next/server";
import { settlePayment } from "@/lib/billing/settle";
import { safeRef } from "@/lib/billing/redirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Callback MTN MoMo (X-Callback-Url de la demande RequestToPay). MTN n'y joint aucune
 * signature : cette requête n'est qu'un DÉCLENCHEUR. On retrouve le paiement grâce à
 * `externalId` (= notre référence), puis on interroge MTN nous-mêmes
 * (GET requesttopay/{ref}) : seul son statut officiel compte, jamais le corps reçu.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  }

  const raw = typeof body.externalId === "string" ? body.externalId : typeof body.referenceId === "string" ? body.referenceId : "";
  const ref = safeRef(raw);
  if (!ref) return NextResponse.json({ error: "Référence manquante ou invalide." }, { status: 400 });

  const result = await settlePayment(ref);
  if (result.kind === "not_found") return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
  if (result.kind === "error") return NextResponse.json({ error: "Erreur temporaire, réessai attendu." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
