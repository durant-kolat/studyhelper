import { handleProviderNotification } from "@/lib/billing/notification-handler";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notification Orange Money : { status, notif_token, txnid }. Elle ne contient PAS notre référence : on la retrouve grâce
// au notif_token (secret renvoyé par Orange à l'initiation, conservé côté serveur). Un jeton inconnu ne correspond à aucun
// paiement → rejeté. Le contenu n'est jamais cru : la vérification serveur (transactionstatus) décide.
async function resolveRef(params: Record<string, string>): Promise<string | null> {
  const token = params.notif_token;
  if (!token || token.length < 8 || token.length > 200) return null;
  const { data } = await supabaseAdmin
    .from("payments")
    .select("provider_ref")
    .eq("provider", "orange")
    .eq("meta->>orange_notif_token", token)
    .maybeSingle();
  return (data?.provider_ref as string | undefined) ?? null;
}

const OPTS = { name: "orange", refKeys: ["order_id"], resolveRef };

export async function POST(req: Request) {
  return handleProviderNotification(req, OPTS);
}
export async function GET(req: Request) {
  return handleProviderNotification(req, OPTS);
}
