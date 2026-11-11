// Registre des prestataires : un seul endroit pour passer d'un moyen de paiement (mtn / orange / card / paypal) ou d'un
// identifiant enregistré au bon prestataire.
//   MTN MoMo → API MTN directe · Orange Money → API Orange directe · Visa / Mastercard / PayPal → PayPal
// Anciens prestataires (CamPay, Lygos, Monetbil, CinetPay) : retirés ; leurs paiements restent dans l'historique.

import { providerIdForMethod, type PaymentMethodId, type ProviderId } from "../../payment-methods";
import { mtnProvider } from "./mtn";
import { orangeProvider } from "./orange";
import { paypalProvider } from "./paypal";
import { supportsAutoRenew, type PaymentProvider } from "./types";

const REGISTRY: Record<ProviderId, PaymentProvider> = {
  mtn: mtnProvider,
  orange: orangeProvider,
  paypal: paypalProvider,
};

export function providerForMethod(method: PaymentMethodId): PaymentProvider {
  return REGISTRY[providerIdForMethod(method)];
}

/** Prestataire d'un paiement déjà enregistré ; null pour les ANCIENS (CamPay, Lygos, Monetbil, CinetPay : hors circuit, historique seulement). */
export function providerById(id: string | null | undefined): PaymentProvider | null {
  if (id && Object.prototype.hasOwnProperty.call(REGISTRY, id)) return REGISTRY[id as ProviderId];
  return null;
}

export function allProviders(): PaymentProvider[] {
  return Object.values(REGISTRY);
}

/** Au moins un moyen de paiement configuré offre-t-il un VRAI renouvellement automatique ? */
export function autoRenewAvailable(): boolean {
  return allProviders().some((p) => supportsAutoRenew(p) && p.isConfigured());
}

export { mtnProvider, orangeProvider, paypalProvider };
