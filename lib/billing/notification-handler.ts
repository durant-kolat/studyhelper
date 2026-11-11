// Traitement commun des notifications de prestataire (MTN, Orange). SERVEUR UNIQUEMENT.
//
// Une notification n'est JAMAIS une preuve de paiement : elle sert uniquement de déclencheur.
// On en extrait NOTRE référence, puis settlePayment() interroge le prestataire et compare
// montant / devise / utilisateur à NOTRE base avant toute activation (atomique et idempotente).

import { NextResponse } from "next/server";
import { settlePayment } from "./settle";
import { safeRef } from "./redirects";
import { clientIp, hitRateLimit } from "../http-rate-limit";
import { readNotificationParams } from "../payments-server";

export async function handleProviderNotification(
  req: Request,
  opts: {
    name: string;
    refKeys: string[];
    /** Prestataire dont la notification ne contient pas NOTRE référence (ex. Orange : notif_token) : retrouve la référence en base. */
    resolveRef?: (params: Record<string, string>) => Promise<string | null>;
  }
): Promise<NextResponse> {
  const limited = hitRateLimit(`pay-notif:${opts.name}:${clientIp(req)}`, 60, 60_000);
  if (!limited.ok) return NextResponse.json({ error: "Trop de requêtes." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } });

  // Paramètres : query string (GET) + corps (POST, JSON ou formulaire), la query ayant la priorité.
  const params: Record<string, string> = {};
  try {
    if (req.method === "POST" || req.method === "PUT") Object.assign(params, await readNotificationParams(req));
  } catch {
    /* corps illisible : on tente la query string */
  }
  new URL(req.url).searchParams.forEach((v, k) => {
    params[k] = v;
  });

  let ref: string | null = null;
  for (const key of opts.refKeys) {
    const candidate = params[key] ? safeRef(params[key]) : null;
    if (candidate) {
      ref = candidate;
      break;
    }
  }
  if (!ref && opts.resolveRef) {
    const resolved = await opts.resolveRef(params).catch(() => null);
    ref = resolved ? safeRef(resolved) : null;
  }
  if (!ref) return NextResponse.json({ error: "Référence manquante." }, { status: 400 });

  const result = await settlePayment(ref);
  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ error: "Paiement introuvable." }, { status: 404 });
    case "rejected":
      return NextResponse.json({ error: "Paiement non conforme." }, { status: 409 });
    case "error":
      // 5xx : le prestataire rappellera la notification, rien n'est perdu ni activé à moitié.
      return NextResponse.json({ error: "Erreur temporaire, réessai attendu." }, { status: 500 });
    default:
      return NextResponse.json({ ok: true, status: result.payment?.status ?? result.kind });
  }
}
