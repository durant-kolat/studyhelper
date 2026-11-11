import { handleProviderNotification } from "@/lib/billing/notification-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notification Lygos (carte Mastercard) : sert uniquement de déclencheur ; la vérification serveur
// auprès de Lygos (statut réel de la commande) décide (voir notification-handler).
const OPTS = { name: "lygos", refKeys: ["order_id", "orderId"] };

export async function GET(req: Request) {
  return handleProviderNotification(req, OPTS);
}

export async function POST(req: Request) {
  return handleProviderNotification(req, OPTS);
}
