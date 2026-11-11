import { handleProviderNotification } from "@/lib/billing/notification-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Notification MTN MoMo (callback de « Request To Pay », envoyé en PUT). Elle n'est JAMAIS crue : elle ne sert qu'à
// déclencher la vérification serveur auprès de MTN (voir notification-handler / settle). MTN renvoie notre
// référence dans « externalId ».
const OPTS = { name: "mtn", refKeys: ["externalId", "referenceId"] };

export async function PUT(req: Request) {
  return handleProviderNotification(req, OPTS);
}
export async function POST(req: Request) {
  return handleProviderNotification(req, OPTS);
}
export async function GET(req: Request) {
  return handleProviderNotification(req, OPTS);
}
