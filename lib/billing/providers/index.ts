// Registre des prestataires : un seul endroit pour passer d'un moyen de paiement
// ou d'un identifiant enregistré au bon prestataire.
//   Notch Pay → API Notch Pay directe (MTN MoMo + Orange Money + carte via Notch Pay)
// Anciens prestataires (MTN direct, Orange direct, PayPal, CamPay, Lygos, Monetbil, CinetPay) : retirés ;
// leurs paiements restent dans l'historique.

import { providerIdForMethod, type PaymentMethodId, type ProviderId } from "../../payment-methods";
import { notchpayProvider } from "./notchpay";
import { supportsAutoRenew, type PaymentProvider } from "./types";

const REGISTRY: Record<ProviderId, PaymentProvider> = {
  notchpay: notchpayProvider,
};

export function providerForMethod(method: PaymentMethodId): PaymentProvider {
  return REGISTRY[providerIdForMethod(method)];
}

/** Prestataire d'un paiement déjà enregistré ; null pour les ANCIENS (MTN direct, Orange direct, PayPal, CamPay, Lygos, Monetbil, CinetPay : hors circuit, historique seulement). */
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

export { notchpayProvider };
