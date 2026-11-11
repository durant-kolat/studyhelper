import { NextRequest } from "next/server";
import { redirectToStatusPage } from "@/lib/billing/redirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retour du client depuis la page officielle Orange Money (return_url). N'active RIEN :
// la page de suivi demande au serveur de vérifier le paiement auprès d'Orange.
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  return redirectToStatusPage(params.ref);
}

export async function POST(_req: NextRequest, { params }: { params: { ref: string } }) {
  return redirectToStatusPage(params.ref);
}
