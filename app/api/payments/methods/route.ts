import { NextRequest, NextResponse } from "next/server";
import { CHECKOUT_METHODS, PAYMENT_METHODS } from "@/lib/payment-methods";
import { providerForMethod } from "@/lib/billing/providers";
import { DEFAULT_COUNTRY, availableMethods, enabledCountryCodes, getCountry, normalizeCountryCode } from "@/lib/payment-countries";
import { appUrlIsPublicHttps } from "@/lib/billing/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Moyens de paiement RÉELLEMENT disponibles dans un pays : un moyen n'est « available » que si le pays est activé, si l'opérateur
 * existe dans ce pays, si ses identifiants serveur sont configurés et si l'URL publique du site est en https. Aucun secret exposé :
 * seulement des booléens, la devise et le parcours (numéro demandé ou non). Jamais un moyen non opérationnel présenté comme disponible.
 */
export async function GET(req: NextRequest) {
  const country = normalizeCountryCode(req.nextUrl.searchParams.get("country") ?? DEFAULT_COUNTRY);
  if (!country || !getCountry(country) || !enabledCountryCodes().includes(country)) {
    return NextResponse.json({ country, enabled: false, methods: [] });
  }
  const allowed = availableMethods(country);
  const urlOk = appUrlIsPublicHttps();
  const methods = CHECKOUT_METHODS.map((id) => {
    const provider = providerForMethod(id);
    return {
      id,
      available: allowed[id] && urlOk && provider.isConfigured(country),
      currency: provider.currency(country),
      requiresPhone: PAYMENT_METHODS[id].requiresPhone,
      flow: PAYMENT_METHODS[id].flow,
    };
  });
  return NextResponse.json({ country, enabled: true, methods }, { headers: { "Cache-Control": "no-store" } });
}
