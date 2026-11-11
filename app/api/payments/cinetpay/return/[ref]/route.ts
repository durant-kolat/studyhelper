import { NextRequest } from "next/server";
import { redirectToStatusPage } from "@/lib/billing/redirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retour de l'utilisateur depuis la page de paiement CinetPay. CinetPay peut rappeler cette
// URL en GET comme en POST : on redirige (303) toujours vers la page de suivi.
// Cette URL n'active RIEN — seule la vérification serveur (webhook ou
// /api/payments/verify) peut activer un paiement.
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  return redirectToStatusPage(params.ref);
}

export async function POST(_req: NextRequest, { params }: { params: { ref: string } }) {
  return redirectToStatusPage(params.ref);
}
