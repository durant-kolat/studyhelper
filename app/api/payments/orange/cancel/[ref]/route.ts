import { NextRequest } from "next/server";
import { cancelPendingPayment } from "@/lib/billing/cancel";
import { redirectToStatusPage, safeRef } from "@/lib/billing/redirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le client a choisi « Annuler » sur la page Orange Money (cancel_url). On vérifie d'abord
// auprès d'Orange (s'il a en fait payé, le paiement est activé, pas annulé), puis on
// marque « cancelled » un paiement toujours en attente.
async function handle(ref: string) {
  const ok = safeRef(ref);
  if (ok) await cancelPendingPayment(ok);
  return redirectToStatusPage(ref);
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  return handle(params.ref);
}

export async function POST(_req: NextRequest, { params }: { params: { ref: string } }) {
  return handle(params.ref);
}
