// Redirections de retour (navigateur) après un paiement chez le prestataire.
// SERVEUR UNIQUEMENT. Ces URL n'activent RIEN : une redirection n'est jamais une preuve
// de paiement. Elles ramènent l'utilisateur sur /payments/return, qui demande au SERVEUR
// de vérifier auprès du prestataire.

import { NextResponse } from "next/server";
import { appUrl } from "./config";

/** Référence autorisée : lettres, chiffres, « _ » et « - » (jamais de caractère piégé). */
export function safeRef(ref: string): string | null {
  return /^[A-Za-z0-9_-]{6,80}$/.test(ref) ? ref : null;
}

export function redirectToStatusPage(ref: string) {
  const ok = safeRef(ref);
  const target = ok ? `${appUrl()}/payments/return?ref=${encodeURIComponent(ok)}` : `${appUrl()}/payments/return`;
  return NextResponse.redirect(target, 303);
}
