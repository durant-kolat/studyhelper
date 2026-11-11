import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { autoRenewAvailable } from "@/lib/billing/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Renouvellement automatique.
 *  - DÉSACTIVER : toujours possible (efface la référence de prélèvement et la prochaine tentative).
 *  - ACTIVER    : seulement si un prestataire offre réellement un prélèvement récurrent officiel.
 *                 Ce n'est le cas d'aucun moyen de paiement actuel (MTN MoMo, Orange Money,
 *                 Visa / Mastercard / PayPal) : on le dit clairement au lieu de le simuler, et
 *                 l'utilisateur renouvelle manuellement (rappels 7 j, 3 j et le jour J).
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  let enabled: unknown;
  try {
    enabled = ((await req.json()) as { enabled?: unknown }).enabled;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "Paramètre « enabled » manquant." }, { status: 400 });

  if (enabled) {
    if (!autoRenewAvailable()) {
      return NextResponse.json(
        {
          error:
            "Le renouvellement automatique n'est pas encore disponible avec MTN MoMo, Orange Money, Visa / Mastercard ni PayPal : aucun prélèvement récurrent n'est implémenté. Renouvelle manuellement — nous te prévenons 7 jours avant, 3 jours avant et le jour de l'expiration.",
          code: "auto_renew_unavailable",
        },
        { status: 409 }
      );
    }
    // Un prestataire le supporte : l'activation exige SON parcours de consentement (création
    // du mandat/jeton chez lui), à brancher dans ce prestataire — jamais simulée ici.
    return NextResponse.json(
      { error: "L'activation passe par le parcours de consentement du prestataire (non branché).", code: "mandate_flow_required" },
      { status: 501 }
    );
  }

  const { error } = await supabaseAdmin
    .from("premium_autorenew")
    .update({ enabled: false, mandate_ref: null, next_attempt_at: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) {
    console.error("[premium/auto-renew] désactivation :", error.message);
    return NextResponse.json({ error: "Impossible de désactiver pour le moment." }, { status: 500 });
  }
  return NextResponse.json({ enabled: false });
}
