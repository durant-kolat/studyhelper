import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAuthenticatedUserId } from "@/lib/auth-server";
import { PAYMENT_COLUMNS, toPaymentView, type PaymentRow } from "@/lib/payments-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historique des paiements de l'utilisateur CONNECTÉ (filtre user_id côté serveur) : date, moyen, montant, statut. Anciens prestataires inclus. */
export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  // Les paiements « en attente » dont le délai est dépassé sont d'abord marqués expirés (jamais activés).
  await supabaseAdmin.rpc("expire_stale_payments", { p_user_id: userId });
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Historique indisponible." }, { status: 500 });
  return NextResponse.json({ payments: ((data ?? []) as unknown as PaymentRow[]).map(toPaymentView) });
}
