import { handleProviderNotification } from "@/lib/billing/notification-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notification CamPay (Mobile Money) : CamPay appelle cette URL (GET) quand l'état d'une transaction change.
// Le contenu n'est jamais cru : la vérification serveur auprès de CamPay décide (voir notification-handler).
const OPTS = { name: "campay", refKeys: ["external_reference"] };

export async function GET(req: Request) {
  return handleProviderNotification(req, OPTS);
}

export async function POST(req: Request) {
  return handleProviderNotification(req, OPTS);
}
