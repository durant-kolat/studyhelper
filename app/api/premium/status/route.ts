import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { getPremiumOverview } from "@/lib/billing/premium-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * État Premium de l'utilisateur connecté : statut, date d'expiration, jours restants,
 * paiement en attente, offres (prix et durées TELS QUE LE SERVEUR LES FACTURERA) et
 * historique des paiements/renouvellements. Aucune donnée sensible n'est renvoyée.
 */
export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const overview = await getPremiumOverview(userId);
  if (!overview) return NextResponse.json({ error: "Profil introuvable." }, { status: 404 });
  return NextResponse.json(overview);
}
